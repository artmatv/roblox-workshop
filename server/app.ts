import { ExternalReviewProvider } from "./external-reviewer.js";
import { insideWorkspace } from "./agent-studio-mcp.js";
import { readFileSync } from "node:fs";
import { projectNameSchema } from "../shared/project-naming.js";
import { EFFORT_POLICY_VERSION } from "../shared/effort-policy.js";
import express from "express";
import { randomBytes } from "node:crypto";
import {
  sameSecret,
  browserSession,
  issueBrowserSession,
  browserCookieName,
  BROWSER_SESSION_MS,
} from "./browser-session.js";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Engine } from "./engine.js";
import { GAME_LANGUAGE_POLICY } from "./game-localization.js";
import { developmentStatus } from "./development-status.js";
import type { ResultReview } from "./orchestrator.js";
import {
  stylePresetLibrary,
  presetReferencePath,
  UI_STYLE_SKILL,
} from "./style-presets.js";
import { Store, id, hash, safePath } from "./store.js";
import { Vault } from "./vault.js";
import { Adapters } from "./adapters.js";
import { createBackup } from "./backup.js";
import { OpenAIProvider, providerConfigSchema } from "./providers.js";
import { importSkill, pinSkill } from "./skills.js";
import { families } from "./catalog.js";
import { balance } from "./budget.js";
import { normalizeLimits, PINNED_CODEX } from "./codex.js";
import {
  addReferenceImage,
  ownerReference,
  referenceImages,
  removeReferenceImage,
  saveReferencePrompt,
} from "./owner-references.js";
import {
  type Command,
  type StudioConnection,
  type Project,
  type Task,
  type Version,
  type StylePackage,
  type Skill,
  type Release,
  manifestSchema,
  now,
} from "../shared/domain.js";
import { currentMilestone } from "../shared/production-plan.js";
import { checkIdea } from "./idea-lab.js";
import { validIdeaPicks, type Idea } from "../shared/idea-lab.js";
const token = () => randomBytes(32).toString("hex");
// Latest visual verdicts for the current production milestone (the plan view
// shows them per item); accepted milestones need none.
export function latestPlanReview(store: Store, p: Project, tasks: Task[]) {
  const milestone = p.productionPlan
    ? currentMilestone(p.productionPlan, p.productionProgress)
    : undefined;
  if (!milestone) return null;
  const ids = new Set(
    tasks.filter((t) => t.milestoneId === milestone.id).map((t) => t.id),
  );
  const review = store
    .all<any>("nativeVisualReview")
    .filter(
      (r) => ids.has(r.taskId) && r.startedAt && Array.isArray(r.checklist),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .at(-1);
  return review
    ? {
        milestoneId: milestone.id,
        taskId: review.taskId,
        attempt: review.attempt,
        status: review.status,
        at: review.startedAt,
        checklist: review.checklist.map((c: any) => ({
          itemId: c.itemId,
          status: c.status,
          note: c.note,
        })),
        quality: review.quality || [],
      }
    : null;
}
// Scene manifests hold every instance with its source (megabytes per
// snapshot); the project view lists them by count and compares versions on the
// server.
function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function equals(a: string, b: string) {
  return sameSecret(a, b);
}
export function createApp(
  store: Store,
  engine: Engine,
  authToken: string,
  options: { port: number; appRoot: string },
) {
  const app = express(),
    vault = new Vault(store),
    adapters = new Adapters(store, vault),
    externalReviewer = new ExternalReviewProvider(store, vault);
  const activeExternalReviews = new Set<string>();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (
      !["127.0.0.1", "localhost", "[::1]"].some(
        (h) => host === h + ":" + options.port,
      )
    )
      return res.status(403).json({ error: "Недопустимый Host" });
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== `http://127.0.0.1:${options.port}` &&
      origin !== `http://localhost:${options.port}`
    )
      return res.status(403).json({ error: "Недопустимый источник запроса" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: "12mb" }));
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      version: "0.1.0",
      effortPolicyVersion: EFFORT_POLICY_VERSION,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const bearer = equals(
      req.headers.authorization?.replace(/^Bearer /, "") || "",
      authToken,
    );
    const session =
      req.headers["sec-fetch-site"] !== "cross-site"
        ? browserSession(req.headers.cookie, authToken, options.port)
        : null;
    if (!bearer && !session)
      return res.status(401).json({
        error: "Не удалось восстановить личный доступ к мастерской",
        code: "DASHBOARD_SESSION_REQUIRED",
      });
    if (!session || session.expiresAt - Date.now() < BROWSER_SESSION_MS / 4)
      res.cookie(
        browserCookieName(options.port),
        issueBrowserSession(authToken, options.port),
        {
          httpOnly: true,
          sameSite: "strict",
          path: "/api",
          maxAge: BROWSER_SESSION_MS,
        },
      );
    next();
  });
  app.get("/api/state", (_req, res) =>
    res.json({
      projects: store.all("project"),
      studios: store.all("studio"),
      families,
      uiStyles: stylePresetLibrary(store),
      skills: store.all("skill"),
      gameLanguage: GAME_LANGUAGE_POLICY,
      codex: {
        backend: engine.codex.backend,
        connected: engine.codex.ready,
        version: engine.codex.version,
        pinnedVersion: PINNED_CODEX,
        account: engine.account,
        models: engine.models,
        error: engine.accountError,
        quota: normalizeLimits(engine.quota),
        rawQuota: engine.quota,
        quotaAt: engine.quotaAt,
        stale: engine.quotaStale,
      },
      backups: store.all("backup"),
      providerPricing:
        store.get<any>("setting", "openai-pricing")?.value || null,
      providerOperations: store.all("providerOperation"),
      externalReviewer: externalReviewer.status(),
      finance: {
        balances: store.all("manualBalance"),
        costs: store.all("costSync"),
        grants: store.all("grant"),
        secrets: [
          "openai-generation",
          "openai-admin",
          "roblox-analytics",
          "roblox-publish",
          "roblox-assets",
        ].map((id) => ({ id, configured: vault.has(id) })),
        automaticBalance: "unavailable",
        billingUrl:
          "https://platform.openai.com/settings/organization/billing/overview",
      },
      trendRanking: adapters.trendRanking(),
    }),
  );
  app.get("/api/projects/:id/version-diff", (req, res) => {
    const versions = engine.versions(req.params.id);
    const a = versions.find((v) => v.id === req.query.from),
      b = versions.find((v) => v.id === req.query.to);
    if (!a || !b) throw new Error("Версия не найдена");
    const before = new Map(a.manifest.instances.map((i) => [i.path, i])),
      after = new Map(b.manifest.instances.map((i) => [i.path, i]));
    const changes = [...new Set([...before.keys(), ...after.keys()])]
      .sort()
      .filter((k) => stable(before.get(k)) !== stable(after.get(k)))
      .map((path) => ({
        path,
        before: before.get(path) ?? null,
        after: after.get(path) ?? null,
      }));
    res.json({ changes });
  });
  app.get("/api/projects/:id", (req, res) => {
    const p = engine.project(req.params.id);
    // Tasks, versions and commands carry whole scene snapshots that the
    // dashboard never shows; SQLite drops them before they are parsed.
    const versions = store
      .allWithoutInstances<Version>("version", ["$.manifest"])
      .filter((v) => v.projectId === p.id)
      .sort((a, b) => b.revision - a.revision);
    const head = versions.find((v) => v.revision === p.revision);
    const current = head && store.get<Version>("version", head.id);
    const tasks = store
      .allWithoutInstances<Task>("task", ["$.result"])
      .filter((t) => t.projectId === p.id);
    res.json({
      project: p,
      nativeSession: engine.native.session(p.id),
      uiStyles: stylePresetLibrary(store, p.skillPins[UI_STYLE_SKILL]),
      gameLanguage: GAME_LANGUAGE_POLICY,
      development: developmentStatus(store, p, current),
      tasks,
      planReview: latestPlanReview(store, p, tasks),
      resultReviews: store
        .all<ResultReview>("resultReview")
        .filter((r) => r.projectId === p.id),
      versions,
      budget: balance(store, p),
      styles: engine.currentStyles(p.id),
      styleHistory: store
        .all<StylePackage>("style")
        .filter((s) => s.projectId === p.id && s.supersededAt),
      research: store.all<any>("research").filter((r) => r.projectId === p.id),
      ownerReference: {
        ...ownerReference(store, p.id),
        images: referenceImages(store, p.id),
        capture: engine.capture.status(p.id),
      },
      feedback: store.all<any>("feedback").filter((r) => r.projectId === p.id),
      commands: store
        .allWithoutInstances<any>("command", ["$.result", "$.payload.manifest"])
        .filter((r) => r.projectId === p.id),
      metrics: store.all<any>("metric").filter((r) => r.projectId === p.id),
      releases: store.all<any>("release").filter((r) => r.projectId === p.id),
      events: store.events(p.id),
      recommendations: adapters.recommendations(p.id),
      assets: current?.manifest.data.assets || [],
      blockers: engine.releaseBlockers(p, current),
    });
  });
  app.post("/api/projects", (req, res) =>
    res.json(
      engine.createProject(
        z
          .object({
            name: projectNameSchema,
            genre: z.string().min(2).max(100).optional(),
            goal: z.string().min(3).max(5000).optional(),
            specification: z
              .string()
              .min(1)
              .max(200_000)
              .refine((text) => !!text.trim(), "Спецификация пуста")
              .optional(),
          })
          .superRefine((data, ctx) => {
            if (!data.specification) {
              if (!data.genre)
                ctx.addIssue({
                  code: "custom",
                  path: ["genre"],
                  message: "Укажите направление",
                });
              if (!data.goal)
                ctx.addIssue({
                  code: "custom",
                  path: ["goal"],
                  message: "Укажите идею и ограничения",
                });
            }
          })
          .parse(req.body),
      ),
    ),
  );
  app.post("/api/attachments", (req, res) => {
    const b = z
      .object({
        dataBase64: z.string().max(7_000_000),
        mime: z.enum(["image/png", "image/jpeg"]),
      })
      .parse(req.body);
    const bytes = Buffer.from(b.dataBase64, "base64");
    const valid =
      b.mime === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid || bytes.length > 5_000_000)
      throw new Error("Нужен PNG/JPEG не более 5 МБ");
    const file = `feedbackImages/${id()}.${b.mime === "image/png" ? "png" : "jpg"}`;
    store.file(file, bytes);
    res.json({ file });
  });
  app.patch("/api/projects/:id", (req, res) =>
    res.json(engine.updateProject(req.params.id, req.body)),
  );
  app.delete("/api/projects/:id", (req, res) => {
    const project = store.get<any>("project", req.params.id);
    if (!project) return res.json({ ok: true });
    const body = z
      .object({
        confirmation: z.string(),
        deleteFiles: z.boolean().default(false),
      })
      .parse(req.body);
    if (body.confirmation !== project.name)
      return res
        .status(400)
        .json({ error: "Введите точное название проекта для подтверждения" });
    if (engine.activeFor(project.id))
      return res.status(409).json({
        error:
          "Проект занят активной работой. Дождитесь её завершения и повторите удаление.",
      });
    if (engine.namingRequests.has(project.id))
      return res.status(409).json({
        error:
          "Для проекта ещё подбираются названия. Дождитесь завершения запроса и повторите удаление.",
      });
    if (
      engine
        .tasks(project.id)
        .some((task) =>
          ["running", "reviewing", "verifying"].includes(task.status),
        )
    )
      return res.status(409).json({
        error:
          "У проекта есть выполняющиеся задачи. Отмените их через управление проектом или дождитесь завершения.",
      });
    const session = engine.native.session(project.id);
    if (
      session &&
      ["starting", "queued", "working", "checkpoint"].includes(session.status)
    )
      return res.status(409).json({
        error:
          "У проекта есть активная нативная сессия. Дождитесь её остановки и повторите удаление.",
      });
    if (
      store
        .all<any>("skillValidationContext")
        .some((ctx) => ctx.projectId === project.id)
    )
      return res.status(409).json({
        error:
          "У проекта есть контекст проверки навыка. Завершите или отмените проверку и повторите удаление.",
      });
    if (
      store
        .all<any>("command")
        .some(
          (command) =>
            command.projectId === project.id &&
            ["queued", "sent", "uncertain"].includes(command.status),
        )
    )
      return res.status(409).json({
        error:
          "Сначала отмените или сверьте команды Studio, затем повторите удаление.",
      });
    if (
      store
        .all<any>("release")
        .some(
          (release) =>
            release.projectId === project.id && release.status === "publishing",
        )
    )
      return res.status(409).json({
        error:
          "Публикация проекта ещё выполняется. Дождитесь завершения и повторите удаление.",
      });
    const studios = store
      .all<any>("studio")
      .filter((studio) => studio.projectId === project.id);
    if (body.deleteFiles) {
      const taskIds = store
        .all<any>("task")
        .filter((task) => task.projectId === project.id)
        .map((task) => task.id);
      const reviewIds = store
        .all<any>("resultReview")
        .filter((record) => record.projectId === project.id)
        .map((record) => record.id);
      const styleIds = store
        .all<any>("style")
        .filter((record) => record.projectId === project.id)
        .map((record) => record.id);
      const commandIds = store
        .all<any>("command")
        .filter((record) => record.projectId === project.id)
        .map((record) => record.id);
      const targets = [
        `projects/${project.id}`,
        `naming/${project.id}`,
        `references/${project.id}`,
      ];
      for (const taskId of taskIds)
        targets.push(
          `tasks/${taskId}`,
          `providers/${taskId}`,
          `native-runs/${taskId}`,
          `motion-work/${taskId}`,
        );
      for (const reviewId of reviewIds) targets.push(`reviews/${reviewId}`);
      for (const styleId of styleIds) targets.push(`styles/${styleId}`);
      for (const commandId of commandIds)
        targets.push(`captures/${commandId}.png`);
      const feedbackImages = new Set<string>();
      const collect = (value: any) => {
        if (
          typeof value === "string" &&
          /^feedbackImages\/[a-f0-9-]+\.(png|jpg)$/.test(value)
        )
          feedbackImages.add(value);
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === "object")
          Object.values(value).forEach(collect);
      };
      for (const kind of ["feedback", "research", "style"])
        for (const row of store
          .all<any>(kind)
          .filter((r) => r.projectId === project.id))
          collect(row);
      for (const path of feedbackImages) {
        const shared = store
          .all<any>("feedback")
          .concat(store.all<any>("research"), store.all<any>("style"))
          .some(
            (row) =>
              row.projectId !== project.id &&
              JSON.stringify(row).includes(JSON.stringify(path)),
          );
        if (!shared) targets.push(path);
      }
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (
        !uuid.test(project.id) ||
        [...taskIds, ...reviewIds, ...styleIds, ...commandIds].some(
          (value) => !uuid.test(value),
        )
      )
        return res.status(400).json({
          error:
            "Идентификатор проекта или связанной записи небезопасен; файлы не удалены.",
        });
      const preflight = (path: string) => {
        const info = lstatSync(path, { throwIfNoEntry: false });
        if (!info) return;
        if (info.isSymbolicLink())
          throw new Error("Обнаружена символическая ссылка");
        if (info.isDirectory())
          for (const name of readdirSync(path)) preflight(resolve(path, name));
      };
      let cleanupStarted = false;
      try {
        const paths = targets.map((path) => safePath(store.root, path));
        paths.forEach(preflight);
        cleanupStarted = true;
        for (const path of paths)
          if (lstatSync(path, { throwIfNoEntry: false }))
            rmSync(path, { recursive: true, force: true });
      } catch {
        return res.status(400).json({
          error: cleanupStarted
            ? "Очистка файлов не завершена. Проект сохранён; часть файлов могла быть удалена. Устраните проблему и повторите."
            : "Файлы не удалены: найдена небезопасная или недоступная папка. Проект сохранён; устраните проблему и повторите.",
        });
      }
    }
    store.deleteProjectRecords(project.id, () => {
      for (const studio of studios) {
        studio.projectId = null;
        store.put("studio", studio);
      }
    });
    return res.json({ ok: true });
  });
  app.get("/api/ideas", (_req, res) =>
    res.json(
      store
        .all<Idea>("idea")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12),
    ),
  );
  app.post("/api/ideas", async (req, res) =>
    res.json(
      await engine.developIdea(
        z
          .object({ verb: z.string(), article: z.string(), noun: z.string() })
          .parse(req.body.words),
      ),
    ),
  );
  const idea = (key: string) => {
    const found = store.get<Idea>("idea", key);
    if (!found) throw new Error("Идея не найдена");
    return found;
  };
  app.patch("/api/ideas/:id", (req, res) => {
    const saved = idea(req.params.id);
    saved.picks = validIdeaPicks(req.body.picks);
    saved.updatedAt = now();
    store.put("idea", saved);
    res.json(saved);
  });
  app.post("/api/ideas/:id/check", async (req, res) =>
    res.json(await checkIdea(store, idea(req.params.id))),
  );
  app.post("/api/projects/:id/name-suggestions", async (req, res) => {
    res.json(await engine.suggestProjectNames(req.params.id));
  });
  app.post("/api/projects/:id/develop", async (req, res) => {
    const p = engine.project(req.params.id),
      text = z.string().min(3).max(20000).optional().parse(req.body.text);
    const current = engine
      .tasks(p.id)
      .find(
        (t) =>
          t.kind === "studio-development" &&
          !t.validationProfile &&
          t.status === "running",
      );
    res.json(
      current && text
        ? await engine.native.steer(
            current,
            text,
            req.body.acceptance !== false,
          )
        : engine.native.start(p, text, req.body.acceptance !== false),
    );
  });
  app.post("/api/projects/:id/skills/validate", (req, res) => {
    res.json(engine.native.startSkillValidation(engine.project(req.params.id)));
  });
  app.post("/api/projects/:id/skills/validate-motion", (req, res) => {
    if (Object.keys(req.body || {}).length)
      throw new Error(
        "Запрос проверки motion не принимает пользовательский prompt",
      );
    res.json(
      engine.native.startSkillValidation(
        engine.project(req.params.id),
        "sypho-motion",
      ),
    );
  });
  app.post("/api/projects/:id/repair-production", (req, res) => {
    res.json(engine.repairProduction(req.params.id));
  });
  app.post("/api/projects/:id/phase", (req, res) => {
    engine.startPhase(req.params.id, z.string().parse(req.body.phase));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/specification/review", async (req, res) => {
    res.json(await engine.reviewExistingSpecification(req.params.id));
  });
  app.post("/api/projects/:id/prototype", (req, res) =>
    res.json(engine.prototype(req.params.id)),
  );
  app.post("/api/projects/:id/owner-references/images", (req, res) => {
    engine.project(req.params.id);
    res.json(addReferenceImage(store, req.params.id, req.body));
  });
  app.delete("/api/projects/:id/owner-references/images/:name", (req, res) => {
    engine.project(req.params.id);
    removeReferenceImage(store, req.params.id, req.params.name);
    res.json({ ok: true });
  });
  app.patch("/api/projects/:id/owner-references", (req, res) => {
    engine.project(req.params.id);
    res.json(saveReferencePrompt(store, req.params.id, req.body?.prompt));
  });
  app.post("/api/projects/:id/owner-references/capture", (req, res) => {
    engine.project(req.params.id);
    const action = z.enum(["start", "stop"]).parse(req.body?.action);
    res.json(
      action === "start"
        ? engine.capture.start(req.params.id)
        : engine.capture.stop(req.params.id),
    );
  });
  app.post("/api/projects/:id/owner-references/brief", async (req, res) =>
    res.json(await engine.buildReferenceBrief(req.params.id)),
  );
  app.post("/api/projects/:id/references", (req, res) => {
    engine.project(req.params.id);
    const sources = z
      .array(
        z.object({
          game: z.string(),
          author: z.string(),
          url: z.url(),
          checkedAt: z.iso.datetime(),
          device: z.string(),
          screen: z.string(),
          observations: z.string(),
          confidence: z.string(),
        }),
      )
      .min(1)
      .max(30)
      .parse(req.body.sources);
    const images = z
      .array(z.string().regex(/^feedbackImages\/[a-f0-9-]+\.(png|jpg)$/))
      .max(5)
      .parse(req.body.images || []);
    const record = {
      id: id(),
      projectId: req.params.id,
      createdAt: now(),
      summary: "Проверенные точки входа и визуальные материалы для оформления",
      sources,
      images,
    };
    store.put("research", record);
    store.event(req.params.id, "references.saved", { count: sources.length });
    res.json({ id: record.id, count: sources.length });
  });
  app.post("/api/projects/:id/approve", (req, res) => {
    engine.approve(req.params.id, z.string().parse(req.body.name));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/control", (req, res) => {
    engine.control(
      req.params.id,
      z.enum(["pause", "resume", "cancel"]).parse(req.body.action),
    );
    res.json({ ok: true });
  });
  app.post("/api/tasks/:id/effort", (req, res) =>
    res.json(engine.configureTaskEffort(req.params.id, req.body)),
  );
  app.post("/api/tasks/:id/review-saved-integration", async (req, res) => {
    res.json(
      await engine.reviewSavedIntegrationPatch(
        req.params.id,
        z.string().parse(req.body.reviewId),
      ),
    );
  });
  app.post("/api/tasks/:id/retry", (req, res) =>
    res.json(engine.retryTask(req.params.id)),
  );
  app.post("/api/projects/:id/feedback", (req, res) =>
    res.json(engine.feedback(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/phone", (req, res) => {
    engine.phone(req.params.id, req.body);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/styles/preview", (req, res) =>
    res.json(
      engine.stylePreview(
        req.params.id,
        req.body.styleId ? z.string().parse(req.body.styleId) : undefined,
      ),
    ),
  );
  app.post("/api/projects/:id/styles/revise", (req, res) =>
    res.json(
      engine.reviseStyles(
        req.params.id,
        z.string().min(10).max(20000).parse(req.body.text),
      ),
    ),
  );
  app.post("/api/projects/:id/styles/prepare", (req, res) =>
    res.json(
      engine.stylePreview(
        req.params.id,
        z.string().parse(req.body.styleId),
        true,
      ),
    ),
  );
  app.post("/api/projects/:id/styles/:styleId/apply-prepared", (req, res) =>
    res.json(engine.applyPreparedStyle(req.params.id, req.params.styleId)),
  );
  app.post("/api/projects/:id/styles/:styleId/patch", (req, res) => {
    const body = z
      .object({
        baseTaskId: z.string(),
        baseHash: z.string().length(64),
        reason: z.string().min(10).max(10000),
        manifest: manifestSchema,
      })
      .parse(req.body);
    res.json(
      engine.patchPreparedStyle(
        req.params.id,
        req.params.styleId,
        body.baseTaskId,
        body.baseHash,
        body.manifest,
        body.reason,
      ),
    );
  });
  app.post("/api/projects/:id/styles/render", (req, res) =>
    res.json(engine.refreshStyleConcepts(req.params.id)),
  );
  app.post("/api/projects/:id/styles/preset", (req, res) => {
    const body = z
      .object({ presetId: z.string().min(1).max(80) })
      .parse(req.body);
    res.json(engine.selectStylePreset(req.params.id, body.presetId));
  });
  app.get("/api/style-presets/:id/reference", (req, res) => {
    const pin = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .parse(req.query.pin);
    const path = presetReferencePath(store, req.params.id, pin);
    if (!path)
      return res.status(404).json({ error: "Исходный пример недоступен" });
    res.sendFile(path, { dotfiles: "allow" });
  });
  app.post("/api/projects/:id/styles/reset", (req, res) =>
    res.json(engine.resetStylePreview(req.params.id)),
  );
  app.post("/api/projects/:id/styles/:styleId/retest", (req, res) =>
    res.json(engine.retestStyle(req.params.id, req.params.styleId)),
  );
  app.post("/api/projects/:id/studio/unbind", (req, res) => {
    engine.unbindStudio(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/styles/:styleId/images", (req, res) => {
    const s = store.get<StylePackage>("style", req.params.styleId);
    if (!s || s.projectId !== req.params.id || s.supersededAt)
      throw new Error("Пакет не принадлежит текущим вариантам проекта");
    const b = z
      .object({
        file: z.string().regex(/^feedbackImages\/[a-f0-9-]+\.(png|jpg)$/),
        screen: z.enum(["hud", "shop", "inventory", "menu"]),
        device: z.enum(["desktop", "mobile"]),
        source: z.literal("Roblox Studio MCP"),
        capturedAt: z.iso.datetime(),
      })
      .parse(req.body);
    if (!existsSync(safePath(store.root, b.file)))
      throw new Error("Файл изображения не найден");
    s.previews = s.previews.filter(
      (p) => !(p.screen === b.screen && p.device === b.device),
    );
    s.previews.push({
      screen: b.screen,
      device: b.device,
      file: b.file,
      kind: "studio",
    });
    store.put("style", s);
    store.event(s.projectId, "style.capture.saved", {
      styleId: s.id,
      ...b,
      previewTaskId: s.previewTaskId,
    });
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/restore", (req, res) =>
    res.json(
      engine.restore(req.params.id, z.string().parse(req.body.versionId)),
    ),
  );
  app.post("/api/projects/:id/extension", (req, res) => {
    const p = engine.project(req.params.id);
    const text = z.string().min(10).parse(req.body.scope);
    const f = engine.feedback(p.id, {
      text: `Расширение контента. Сначала подготовь объём, оценку и миграции сохранений: ${text}`,
      target: "extension",
    });
    f.status = "awaiting_specification";
    store.put("feedback", f);
    engine.task(p, {
      title: "План расширения и миграции",
      role: "designer",
      kind: "specification",
      instructions: `Подготовь следующую редакцию спецификации, миграцию, новые проверки и оценку расширения: ${text}. Не начинай разработку до согласования новой спецификации и бюджета. dataJson {specification:string,estimate:string}.`,
    });
    delete p.approvals.specification;
    delete p.approvals.budget;
    p.budget.approved = false;
    p.stage = "specification";
    engine.setExecution(p, "running");
    res.json(f);
  });
  app.post("/api/projects/:id/studio", (req, res) => {
    engine.bindStudio(req.params.id, z.string().parse(req.body.studioId));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/commands", (req, res) => {
    const p = engine.project(req.params.id);
    const operation = z
      .enum(["snapshot", "test", "capture", "import"])
      .parse(req.body.operation);
    const t = engine.task(p, {
      title: operation,
      role: "qa",
      kind: "manual-check",
      provider: "studio",
      instructions: operation,
      status: "verifying",
    });
    res.json(
      engine.queue(
        p,
        t,
        operation,
        operation === "test"
          ? {
              versionId: engine
                .versions(p.id)
                .find((v) => v.revision === p.revision)?.id,
              checks: p.requiredChecks,
              players: 2,
            }
          : req.body.payload || {},
      ),
    );
  });
  app.post("/api/commands/:id/reconcile", (req, res) => {
    const c = store.get<Command>("command", req.params.id);
    if (!c || c.status !== "uncertain")
      throw new Error("Команда не ожидает сверки");
    if (req.body.action === "mark-failed") {
      c.status = "failed";
      c.result = {
        error: "Пользователь подтвердил, что операция не завершена",
      };
      store.put("command", c);
      res.json(c);
    } else
      throw new Error(
        "Сначала переподключите плагин: он повторно отправит сохранённый результат. Если его нет, подтвердите неуспех после осмотра Studio.",
      );
  });
  app.post("/api/releases/:id/publish", async (req, res) =>
    res.json(await adapters.publish(engine, req.params.id)),
  );
  app.post("/api/projects/:id/releases/approve", (req, res) =>
    res.json(
      engine.approveRelease(
        req.params.id,
        z.array(z.string()).parse(req.body.acceptedMinorIssues),
      ),
    ),
  );
  app.post("/api/projects/:id/metrics/csv", (req, res) => {
    engine.project(req.params.id);
    res.json(
      adapters.importCsv(
        req.params.id,
        z.string().max(1_000_000).parse(req.body.csv),
        req.body.releaseId || null,
      ),
    );
  });
  app.post("/api/projects/:id/metrics/sync", async (req, res) =>
    res.json(
      await adapters.analytics(
        engine.project(req.params.id),
        z.iso.datetime().parse(req.body.start),
        z.iso.datetime().parse(req.body.end),
        req.body.releaseId || null,
      ),
    ),
  );
  app.post("/api/trends", async (req, res) =>
    res.json(
      await adapters.research(z.array(z.string()).parse(req.body.universeIds)),
    ),
  );
  app.post("/api/account/refresh", async (_req, res) => {
    await engine.refreshAccount();
    res.json({ ok: true });
  });
  app.post("/api/account/login", async (req, res) =>
    res.json(await engine.codex.login(req.body?.method === "device")),
  );
  app.post("/api/account/logout", async (_req, res) => {
    for (const p of store.all<any>("project")) engine.control(p.id, "pause");
    await engine.codex.request("account/logout", {});
    engine.account = null;
    engine.quota = null;
    engine.quotaStale = true;
    res.json({ ok: true });
  });
  app.post("/api/secrets", async (req, res) => {
    const b = z
      .object({
        key: z.enum([
          "openai-generation",
          "openai-admin",
          "roblox-analytics",
          "roblox-publish",
          "roblox-assets",
        ]),
        value: z.string().min(10).max(4096),
      })
      .parse(req.body);
    await vault.set(b.key, b.value);
    res.json({ ok: true });
  });
  app.delete("/api/secrets/:key", (req, res) => {
    vault.delete(req.params.key);
    res.json({ ok: true });
  });
  app.post("/api/finance/manual", (req, res) => {
    const b = z
      .object({
        organization: z.string().min(1),
        currency: z.literal("USD"),
        amount: z.number().nonnegative(),
        confirmedAt: z.iso.datetime(),
      })
      .parse(req.body);
    store.put("manualBalance", {
      id: b.organization,
      ...b,
      source: "Вручную подтверждено пользователем",
      status: "manual",
      savedAt: now(),
    });
    res.json({ ok: true });
  });
  app.post("/api/finance/grants", (req, res) => {
    const b = z
      .object({
        organization: z.string().min(1),
        type: z.string().min(1),
        remaining: z.number().nonnegative().nullable(),
        expiresAt: z.iso.datetime().nullable(),
        nextGrantAt: z.iso.datetime().nullable(),
        eligibleForResponses: z.boolean().nullable(),
        source: z.string().min(1),
      })
      .parse(req.body);
    res.json(
      store.put("grant", {
        id: id(),
        ...b,
        verifiedAt: now(),
        status: "manual",
      }),
    );
  });
  app.post("/api/finance/costs", async (req, res) => {
    const b = z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        organization: z.string(),
        project: z.string(),
      })
      .parse(req.body);
    res.json(await adapters.costs(b.start, b.end, b.organization, b.project));
  });
  app.post("/api/skills/import", (req, res) =>
    res.json(importSkill(store, req.body)),
  );
  app.post("/api/projects/:id/skills/pin", (req, res) => {
    pinSkill(
      store,
      engine.project(req.params.id),
      z.string().parse(req.body.skillId),
    );
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/studio/adopt", (req, res) =>
    res.json(
      engine.adoptSnapshot(req.params.id, z.string().parse(req.body.commandId)),
    ),
  );
  app.get("/api/external-reviewer", (_req, res) =>
    res.json(externalReviewer.status()),
  );
  app.post("/api/external-reviewer", async (req, res) =>
    res.json(await externalReviewer.configure(req.body)),
  );
  app.post("/api/external-reviewer/models", async (_req, res) =>
    res.json(await externalReviewer.refreshModels()),
  );
  app.delete("/api/external-reviewer/key", async (_req, res) =>
    res.json(
      await externalReviewer.configure({ removeKey: true, enabled: false }),
    ),
  );
  // Authorises a call from the running developer's workshop MCP by its
  // per-attempt capability token; sends the error response itself on failure.
  const nativeTaskAccess = (req: any, res: any, taskId: string) => {
    const task = store.get<Task>("task", taskId);
    const capability = store.get<any>("nativeCapability", taskId);
    const suppliedToken = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    // The turn may be extended by raising the project timeout after it started.
    const expiresAt =
      task && capability
        ? Math.max(
            capability.expiresAt,
            Date.parse(task.startedAt || "") +
              engine.project(task.projectId).settings.timeoutMinutes * 60000 +
              60000 || 0,
          )
        : 0;
    if (
      !task ||
      !capability ||
      !equals(hash(suppliedToken), capability.hash) ||
      expiresAt < Date.now()
    ) {
      res.status(403).json({ error: "Нет доступа к независимой проверке" });
      return null;
    }
    const project = engine.project(task.projectId);
    if (
      task.kind !== "studio-development" ||
      task.status !== "running" ||
      project.execution !== "running" ||
      project.studioId !== capability.studioId
    ) {
      res.status(409).json({ error: "Работа остановлена или Studio отвязана" });
      return null;
    }
    const session = engine.native.session(project.id);
    if (!session || session.taskId !== task.id) {
      res.status(409).json({ error: "Задача больше не активна" });
      return null;
    }
    return { task, project, session, capability };
  };
  app.post("/native/check-delivery", (req, res) => {
    const input = z.object({ taskId: z.string() }).strict().parse(req.body);
    const access = nativeTaskAccess(req, res, input.taskId);
    if (!access) return;
    const result = engine.native.inspectDelivery(access.project, access.task);
    res.json({
      ok: !result.blocker && !result.problems.length,
      blocker: result.blocker,
      problems: result.problems,
    });
  });
  app.post("/native/visual-preview", async (req, res) => {
    const input = z.object({ taskId: z.string() }).strict().parse(req.body);
    const access = nativeTaskAccess(req, res, input.taskId);
    if (!access) return;
    res.json(
      await engine.native.previewVisualReview(access.project, access.task),
    );
  });
  app.post("/native/external-review", async (req, res) => {
    const input = z
      .object({
        taskId: z.string(),
        instruction: z.string().min(3).max(20000),
        files: z.array(z.string()).max(8),
      })
      .strict()
      .parse(req.body);
    const access = nativeTaskAccess(req, res, input.taskId);
    if (!access) return;
    const { task, project, session, capability } = access;
    const files: Record<string, string | null> = {};
    let bytes = 0;
    for (const file of input.files) {
      if (
        !/\.(luau|lua|svg|md|json)$/i.test(file) ||
        /(?:^|\/)(?:\.codex|\.agents)(?:\/|$)/i.test(file)
      )
        throw new Error(
          "Для проверки нужны выбранные исходники или документы проекта",
        );
      const path = insideWorkspace(session.workspace, file);
      const content = readFileSync(path, "utf8");
      bytes += Buffer.byteLength(content);
      if (bytes > 250000)
        throw new Error(
          "Выбранный контекст превышает 250 КБ; сократите список файлов",
        );
      files[file] = content;
    }
    const selectedModel = externalReviewer.status().model;
    const idempotency = hash({
      taskId: task.id,
      attempt: task.attempt,
      model: selectedModel,
      instruction: input.instruction,
      files,
    });
    const previous = store.get<any>("nativeExternalReview", idempotency);
    if (previous?.result) return res.json(previous.result);
    const reviews = store
      .all<any>("nativeExternalReview")
      .filter(
        (review) =>
          review.taskId === task.id && review.attempt === task.attempt,
      );
    const selectedModelFailed = reviews.some(
      (review) =>
        review.status === "failed" &&
        (review.model === selectedModel ||
          (!review.model &&
            review.error?.includes("Результат запроса неизвестен"))),
    );
    if (selectedModelFailed)
      return res.status(409).json({
        error:
          "Проверка этой моделью уже завершилась ошибкой в текущей попытке; автоматический повтор отключён",
      });
    if (previous || activeExternalReviews.has(task.id))
      return res.status(409).json({
        error:
          "Эта проверка уже запускалась или другая ещё идёт; автоматический повтор отключён",
      });
    const controller = new AbortController();
    const leaseTimer = setInterval(() => {
      const currentTask = store.get<Task>("task", task.id);
      const currentProject = engine.project(project.id);
      if (
        currentTask?.status !== "running" ||
        currentProject.execution !== "running" ||
        currentProject.studioId !== capability.studioId
      )
        controller.abort(new Error("Работа остановлена"));
    }, 1000);
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    store.put("nativeExternalReview", {
      id: idempotency,
      taskId: task.id,
      attempt: task.attempt,
      model: selectedModel,
      status: "running",
    });
    activeExternalReviews.add(task.id);
    try {
      const result = await externalReviewer.review(
        project.id,
        input.instruction,
        files,
        controller.signal,
      );
      store.put("nativeExternalReview", {
        id: idempotency,
        taskId: task.id,
        attempt: task.attempt,
        model: result.model || selectedModel,
        status: "completed",
        result,
      });
      res.json(result);
    } catch (error) {
      store.put("nativeExternalReview", {
        id: idempotency,
        taskId: task.id,
        attempt: task.attempt,
        model: selectedModel,
        status: "failed",
        error: (error as Error).message.slice(0, 2000),
      });
      throw error;
    } finally {
      clearInterval(leaseTimer);
      activeExternalReviews.delete(task.id);
    }
  });
  app.post("/api/providers/pricing", (req, res) =>
    res.json(
      store.put("setting", {
        id: "openai-pricing",
        value: providerConfigSchema.parse(req.body),
      }),
    ),
  );
  app.post("/api/projects/:id/generate", async (req, res) => {
    const input = z
      .object({
        operation: z.enum(["responses", "image", "speech"]),
        prompt: z.string().min(1).max(50000),
        maxOutputTokens: z.number().int().min(1).max(16000).optional(),
      })
      .parse(req.body);
    res.json(
      await new OpenAIProvider(store, vault).generate(
        engine.project(req.params.id),
        input,
      ),
    );
  });
  app.post("/api/skills/:id/toggle", (req, res) => {
    const s = store.get<Skill>("skill", req.params.id);
    if (!s) throw new Error("Навык не найден");
    s.status = req.body.enabled
      ? s.instructions
        ? "installed"
        : "discovered"
      : "disabled";
    store.put("skill", s);
    res.json(s);
  });
  app.post("/api/skills/:id/verify", (req, res) => {
    const s = store.get<Skill>("skill", req.params.id);
    if (!s) throw new Error("Навык не найден");
    const caps = store
      .all<StudioConnection>("studio")
      .flatMap((s) => s.capabilities);
    const missing = s.capabilities.filter((c) => !caps.includes(c));
    s.status = !s.instructions || missing.length ? "incompatible" : "connected";
    s.checkedAt = now();
    store.put("skill", s);
    res.json({ skill: s, missing });
  });
  app.get("/api/events", (req, res) =>
    res.json(
      store.events(
        req.query.projectId as string | undefined,
        Number(req.query.after || 0),
      ),
    ),
  );
  app.get("/api/files", (req, res) => {
    const p = safePath(store.root, z.string().parse(req.query.path));
    if (!existsSync(p))
      return res.status(404).json({ error: "Файл отсутствует" });
    if (/\.(?:svg|html)$/i.test(p)) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    res.sendFile(p);
  });
  app.get("/api/plugin", (_req, res) =>
    res.download(resolve(options.appRoot, "plugin/Automation.rbxmx")),
  );
  app.post("/api/backups", async (_req, res) =>
    res.json(await createBackup(store)),
  );
  app.post("/api/service/stop", async (_req, res) => {
    await engine.stop();
    store.event(null, "service.stopped", {});
    res.json({ ok: true });
    setTimeout(() => process.emit("SIGTERM"), 100);
  });
  app.post("/api/pairing", (req, res) => {
    const code = randomBytes(5).toString("hex").toUpperCase();
    store.put("pairing", { id: hash(code), expiresAt: Date.now() + 300_000 });
    res.json({
      code,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      url: `http://127.0.0.1:${options.port}`,
    });
  });
  app.post("/bridge/pair", (req, res) => {
    const b = z
      .object({
        code: z.string(),
        studioId: z.string().min(5).max(100),
        name: z.string().max(100),
        placeId: z.string().regex(/^\d+$/),
        universeId: z.string().regex(/^\d+$/),
        fingerprint: z.string().max(200),
        documentId: z.string().max(100).optional(),
        capabilities: z.array(z.string()).max(20),
      })
      .parse(req.body);
    const pairing = store.get<any>("pairing", hash(b.code));
    if (!pairing || pairing.expiresAt < Date.now())
      return res.status(401).json({ error: "Код истёк или уже использован" });
    const secret = token();
    store.transaction(() => {
      store.delete("pairing", hash(b.code));
      store.put("bridgeToken", { id: b.studioId, hash: hash(secret) });
      const old = store.get<StudioConnection>("studio", b.studioId);
      store.put<StudioConnection>("studio", {
        id: b.studioId,
        projectId: old?.projectId || null,
        name: b.name,
        placeId: b.placeId,
        universeId: b.universeId,
        version: old?.version || 0,
        fingerprint: b.fingerprint,
        capabilities: b.capabilities,
        lastSeen: now(),
        stopped: false,
        documentId: b.documentId,
      });
    });
    res.json({ token: secret, studioId: b.studioId });
  });
  app.use("/bridge", (req, res, next) => {
    const studioId = req.headers["x-studio-id"];
    const t =
      typeof studioId === "string"
        ? store.get<{ hash: string }>("bridgeToken", studioId)
        : null;
    if (
      !t ||
      !equals(
        hash(req.headers.authorization?.replace(/^Bearer /, "") || ""),
        t.hash,
      )
    )
      return res.status(401).json({ error: "Плагин не связан" });
    res.locals.studioId = studioId;
    next();
  });
  app.post("/bridge/resume", (req, res) => {
    const b = z
      .object({
        studioId: z.string().min(5).max(100),
        documentId: z.string().max(100),
        name: z.string().max(100),
        placeId: z.string().regex(/^\d+$/),
        universeId: z.string().regex(/^\d+$/),
        capabilities: z.array(z.string()).max(20),
      })
      .parse(req.body);
    const old = store.get<StudioConnection>("studio", res.locals.studioId)!;
    if (old.replacedBy)
      throw new Error(
        "Это подключение уже заменено. Введите новый код привязки.",
      );
    if (
      old.placeId !== b.placeId ||
      old.universeId !== b.universeId ||
      (old.documentId && old.documentId !== b.documentId)
    )
      throw new Error(
        "Документ или experience изменился: нужна новая привязка",
      );
    if (!old.stopped && Date.now() - Date.parse(old.lastSeen) < 15000)
      throw new Error(
        "Предыдущее окно Studio ещё активно. Ожидание отключения.",
      );
    if (store.get("studio", b.studioId))
      throw new Error("Идентификатор Studio уже занят");
    if (
      store
        .all<Command>("command")
        .some(
          (c) =>
            c.studioId === old.id && ["sent", "uncertain"].includes(c.status),
        )
    )
      throw new Error(
        "Не определён результат отправленной операции. Сначала нужна сверка сохранённого ответа.",
      );
    const p = old.projectId ? engine.project(old.projectId) : null;
    if (p && p.studioId !== old.id)
      throw new Error(
        "Пользователь выбрал другое подключение. Нужна новая привязка.",
      );
    const secret = token();
    const connection: StudioConnection = {
      ...old,
      id: b.studioId,
      name: b.name,
      documentId: b.documentId,
      capabilities: b.capabilities,
      lastSeen: now(),
      stopped: false,
    };
    delete connection.replacedBy;
    store.transaction(() => {
      old.replacedBy = connection.id;
      old.stopped = true;
      store.put("studio", old);
      store.put("studio", connection);
      store.put("bridgeToken", { id: connection.id, hash: hash(secret) });
      for (const c of store
        .all<Command>("command")
        .filter((c) => c.studioId === old.id && c.status === "queued")) {
        c.studioId = connection.id;
        store.put("command", c);
      }
      if (p) {
        p.studioId = connection.id;
        engine.save(p);
        store.event(p.id, "studio.resumed", {
          oldStudioId: old.id,
          studioId: connection.id,
        });
      }
    });
    res.json({
      token: secret,
      studioId: connection.id,
      projectId: connection.projectId,
      revision: connection.version,
    });
  });
  app.post("/bridge/poll", (req, res) => {
    const s = store.get<StudioConnection>("studio", res.locals.studioId)!;
    if (s.replacedBy)
      return res
        .status(409)
        .json({ error: "Подключение заменено новой сессией Studio" });
    s.lastSeen = now();
    const mode = z
      .object({
        stopped: z.boolean().default(false),
        playing: z.boolean().default(false),
      })
      .parse(req.body);
    s.stopped = mode.stopped;
    s.playMode = mode.playing;
    store.put("studio", s);
    const p = s.projectId ? engine.project(s.projectId) : null;
    const current = store
      .withStatus<Command>("command", ["sent"])
      .find((c) => c.studioId === s.id);
    if (s.stopped || s.playMode || !p || p.execution === "paused" || current)
      return res.json({
        command: null,
        projectId: s.projectId,
        revision: s.version,
      });
    const c = store
      .withStatus<Command>("command", ["queued"])
      .find((c) => c.studioId === s.id && c.projectId === p.id);
    if (c) {
      c.status = "sent";
      c.sentAt = now();
      store.put("command", c);
    }
    res.json({
      command: c || null,
      projectId: s.projectId,
      revision: s.version,
    });
  });
  app.post("/bridge/result", (req, res) =>
    res.json(
      engine.commandResult(
        res.locals.studioId,
        z.string().parse(req.body.commandId),
        req.body,
      ),
    ),
  );
  app.post("/bridge/stop", (req, res) => {
    const s = store.get<StudioConnection>("studio", res.locals.studioId)!;
    s.stopped = true;
    store.put("studio", s);
    if (s.projectId) engine.control(s.projectId, "pause");
    res.json({ ok: true });
  });
  app.use(
    express.static(resolve(options.appRoot, "dist"), { index: "index.html" }),
  );
  app.get("/{*path}", (_req, res) => {
    const p = resolve(options.appRoot, "dist/index.html");
    existsSync(p)
      ? res.sendFile(p)
      : res
          .status(503)
          .send("Выполните npm run build, затем откройте дашборд.");
  });
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error instanceof z.ZodError ? 400 : 409).json({
        error:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => i.path.join(".") + ": " + i.message)
                .join("; ")
            : error.message || "Ошибка операции",
      });
    },
  );
  return app;
}

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { Project } from "../shared/domain.js";
import { supportedEffort, type EffortModel } from "../shared/effort-policy.js";
import type { AgentServer } from "./agent-server.js";
import { Store, id } from "./store.js";

// The owner's own style references for a project: uploaded pictures and
// frames captured from the Roblox Player, a free-text wish, and the brief an
// agent assembles from them. Files live in references/<projectId>/.
export interface OwnerReference {
  id: string;
  projectId: string;
  prompt: string;
  status: "idle" | "running" | "failed";
  brief: OwnerBrief | null;
  briefAt: string | null;
  model?: string;
  effort?: string;
  error?: string | null;
}
const MAX_PICKS = 6;
export const ownerBriefSchema = z.object({
  summary: z.string().min(1).max(1500),
  palette: z
    .array(
      z.object({
        hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        role: z.string().max(80),
      }),
    )
    .min(3)
    .max(8),
  shapes: z.string().max(800),
  typography: z.string().max(600),
  hud: z.string().max(800),
  world: z.string().max(800),
  icons: z.string().max(600),
  avoid: z.string().max(600),
  picks: z
    .array(z.object({ file: z.string(), why: z.string().max(300) }))
    .min(1)
    .max(MAX_PICKS),
});
export type OwnerBrief = z.infer<typeof ownerBriefSchema>;
const MAX_IMAGES = 60;
const BRIEF_IMAGES = 12;
const NAME = /^(?:upload|capture)-[A-Za-z0-9-]+\.(?:png|jpg)$/;
const briefOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "palette",
    "shapes",
    "typography",
    "hud",
    "world",
    "icons",
    "avoid",
    "picks",
  ],
  properties: {
    summary: { type: "string" },
    palette: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hex", "role"],
        properties: { hex: { type: "string" }, role: { type: "string" } },
      },
    },
    shapes: { type: "string" },
    typography: { type: "string" },
    hud: { type: "string" },
    world: { type: "string" },
    icons: { type: "string" },
    avoid: { type: "string" },
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "why"],
        properties: { file: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};
const BRIEF_INSTRUCTIONS = `Ты арт-директор Roblox-игры. Владелец приложил свои референсы: загруженные картинки и кадры из Roblox Player, а также описание желаемого стиля. Собери из них краткий бриф стиля для команды, которая будет делать собственную игру.
Описывай приёмы, а не копируй чужую игру: не переноси названия, персонажей, логотипы и узнаваемые ассеты. Пожелание владельца важнее картинок; если картинки противоречат ему, следуй пожеланию и скажи об этом в summary.
palette — 3–8 цветов #RRGGBB с ролью (фон, панель, главное действие, акцент, текст). shapes — формы и силуэты интерфейса и мира. typography — характер шрифта и подписей. hud — расположение и иерархия HUD. world — мир, материалы, свет. icons — стиль иконок. avoid — чего избегать. picks — до 6 самых полезных файлов из списка с причиной; используй только имена файлов из списка.
Пиши по-русски, коротко и конкретно. Ответ — только JSON по схеме.`;

const dir = (store: Store, projectId: string) =>
  resolve(store.root, "references", projectId);

export function ownerReference(store: Store, projectId: string) {
  return (
    store.get<OwnerReference>("ownerReference", projectId) || {
      id: projectId,
      projectId,
      prompt: "",
      status: "idle" as const,
      brief: null,
      briefAt: null,
    }
  );
}
export function referenceImages(store: Store, projectId: string) {
  const folder = dir(store, projectId);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => NAME.test(name))
    .map((name) => ({
      name,
      file: `references/${projectId}/${name}`,
      source: name.startsWith("capture-") ? "capture" : "upload",
      at: statSync(resolve(folder, name)).mtime.toISOString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function addReferenceImage(
  store: Store,
  projectId: string,
  input: unknown,
) {
  const body = z
    .object({
      dataBase64: z.string().max(7_000_000),
      mime: z.enum(["image/png", "image/jpeg"]),
    })
    .parse(input);
  const bytes = Buffer.from(body.dataBase64, "base64");
  const valid =
    body.mime === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || bytes.length > 5_000_000)
    throw new Error("Нужен PNG/JPEG не более 5 МБ");
  if (referenceImages(store, projectId).length >= MAX_IMAGES)
    throw new Error(`Не больше ${MAX_IMAGES} референсов на проект`);
  const name = `upload-${id()}.${body.mime === "image/png" ? "png" : "jpg"}`;
  store.file(`references/${projectId}/${name}`, bytes);
  return { name };
}
export function removeReferenceImage(
  store: Store,
  projectId: string,
  name: string,
) {
  if (!NAME.test(name)) throw new Error("Неверное имя файла");
  rmSync(resolve(dir(store, projectId), name), { force: true });
}
export function saveReferencePrompt(
  store: Store,
  projectId: string,
  prompt: unknown,
) {
  const record = ownerReference(store, projectId);
  record.prompt = z.string().trim().max(4000).parse(prompt);
  store.put("ownerReference", record);
  return record;
}
// The images agents receive with the brief: the agent's picks, otherwise the
// first uploads. Missing files are skipped.
export function ownerReferenceImages(store: Store, projectId: string) {
  const record = store.get<OwnerReference>("ownerReference", projectId);
  const images = referenceImages(store, projectId);
  const names = record?.brief
    ? record.brief.picks.map((p) => p.file)
    : images.map((i) => i.name);
  return names
    .filter((name) => images.some((i) => i.name === name))
    .slice(0, MAX_PICKS)
    .map((name) => ({
      type: "localImage",
      path: resolve(dir(store, projectId), name),
    }));
}
// Text the game agents get next to the project: the owner's wish and brief.
export function ownerStyleContext(store: Store, projectId: string) {
  const record = store.get<OwnerReference>("ownerReference", projectId);
  if (!record?.prompt && !record?.brief) return null;
  return {
    note: "Собственные референсы владельца: следуй приёмам брифа в оригинальном исполнении, не копируй чужие игры.",
    prompt: record.prompt || null,
    brief: record.brief,
  };
}

export async function buildOwnerBrief(options: {
  store: Store;
  agent: AgentServer;
  project: Project;
  models: EffortModel[];
  timeoutMs?: number;
}) {
  const { store, agent, project: p } = options;
  const images = referenceImages(store, p.id);
  const record = ownerReference(store, p.id);
  if (!images.length && !record.prompt)
    throw new Error("Добавьте картинки, кадры из Roblox или описание стиля");
  if (record.status === "running") throw new Error("Бриф уже собирается");
  record.status = "running";
  record.error = null;
  store.put("ownerReference", record);
  let threadId = "",
    turnId = "",
    cleanup = () => {};
  try {
    const work = dir(store, p.id);
    mkdirSync(work, { recursive: true });
    const configured = p.settings.model
      ? null
      : await agent.request("config/read", { cwd: work, includeLayers: false });
    const choice = supportedEffort(
      { effort: "medium", reason: "Бриф стиля по референсам владельца" },
      options.models,
      p.settings.model || configured?.config?.model || null,
    );
    record.model = choice.model;
    record.effort = choice.effort;
    const thread = await agent.request("thread/start", {
      cwd: work,
      model: choice.model,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { ...(await agent.isolatedConfig(work)), web_search: "disabled" },
      developerInstructions: BRIEF_INSTRUCTIONS,
    });
    threadId = thread.thread.id;
    const used = images.slice(-BRIEF_IMAGES);
    let message = "";
    const completion = new Promise<unknown>((accept, reject) => {
      const onNotification = (m: any) => {
        if (m.params?.threadId !== threadId) return;
        if (
          m.method === "item/completed" &&
          m.params.item?.type === "agentMessage"
        )
          message = m.params.item.text;
        if (m.method !== "turn/completed") return;
        if (m.params.turn.status !== "completed")
          reject(new Error(m.params.turn.error?.message || "Бриф не собран"));
        else
          try {
            accept(
              JSON.parse(
                message.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
              ),
            );
          } catch {
            reject(new Error("ИИ вернул некорректный бриф. Попробуйте снова."));
          }
      };
      const onDisconnect = () => reject(new Error("Связь с ИИ прервалась"));
      const timer = setTimeout(
        () => reject(new Error("ИИ не ответил вовремя")),
        options.timeoutMs || 300_000,
      );
      agent.on("notification", onNotification);
      agent.on("disconnected", onDisconnect);
      cleanup = () => {
        clearTimeout(timer);
        agent.off("notification", onNotification);
        agent.off("disconnected", onDisconnect);
      };
    });
    const turn = await agent.request("turn/start", {
      threadId,
      model: choice.model,
      effort: choice.effort,
      input: [
        {
          type: "text",
          text: JSON.stringify({
            project: {
              name: p.name,
              genre: p.genre,
              goal: p.goal,
              concept: p.concept,
            },
            ownerWish: record.prompt || null,
            files: used.map((i) => ({ file: i.name, source: i.source })),
            note: "Картинки приложены в том же порядке, что files.",
          }),
          text_elements: [],
        },
        ...used.map((i) => ({
          type: "localImage",
          path: resolve(work, i.name),
        })),
      ],
      outputSchema: briefOutputSchema,
    });
    turnId = turn.turn.id;
    const brief = ownerBriefSchema.parse(await completion);
    brief.picks = brief.picks.filter((pick) =>
      used.some((i) => i.name === pick.file),
    );
    const saved = ownerReference(store, p.id);
    Object.assign(saved, {
      status: "idle",
      brief,
      briefAt: new Date().toISOString(),
      model: record.model,
      effort: record.effort,
      error: null,
    });
    store.put("ownerReference", saved);
    store.event(p.id, "references.brief", { images: used.length });
    return saved;
  } catch (error) {
    const saved = ownerReference(store, p.id);
    saved.status = "failed";
    saved.error = (error as Error).message;
    store.put("ownerReference", saved);
    if (threadId && turnId) await agent.stopTask(threadId, turnId);
    throw error;
  } finally {
    cleanup();
  }
}

// Frames from the Roblox Player while the owner plays. Windows only.
export class PlayerCapture {
  sessions = new Map<
    string,
    { child: ChildProcess; startedAt: string; frames: number }
  >();
  constructor(private store: Store) {}
  status(projectId: string) {
    const s = this.sessions.get(projectId);
    return s
      ? { active: true, startedAt: s.startedAt, frames: s.frames }
      : { active: false, startedAt: null, frames: 0 };
  }
  start(projectId: string) {
    if (process.platform !== "win32")
      throw new Error("Захват Roblox Player доступен только в Windows");
    if (this.sessions.has(projectId)) return this.status(projectId);
    if (referenceImages(this.store, projectId).length >= MAX_IMAGES)
      throw new Error(`Не больше ${MAX_IMAGES} референсов на проект`);
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(import.meta.dirname, "capture-roblox.ps1"),
        "-OutDir",
        dir(this.store, projectId),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const session = { child, startedAt: new Date().toISOString(), frames: 0 };
    this.sessions.set(projectId, session);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (NAME.test(line.trim())) session.frames++;
    });
    child.on("close", () => {
      if (this.sessions.get(projectId) === session) {
        this.sessions.delete(projectId);
        this.store.event(projectId, "references.captured", {
          frames: session.frames,
        });
      }
    });
    return this.status(projectId);
  }
  stop(projectId: string) {
    this.sessions.get(projectId)?.child.kill();
    return { active: false, startedAt: null, frames: 0 };
  }
  close() {
    for (const s of this.sessions.values()) s.child.kill();
  }
}

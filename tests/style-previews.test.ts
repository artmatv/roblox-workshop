import { test } from "node:test";
import { acceptReviewed } from "./review-fixture.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Engine } from "../server/engine.js";
import { Store } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { manifestSchema, type StylePackage } from "../shared/domain.js";
import {
  materializeStylePreviews,
  sceneForProject,
  contrastText,
  PREVIEW_RENDERER,
} from "../server/style-previews.js";
test("style comparison produces every screen on both devices and rejects palette-only variants", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-styles-"));
  const s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const p = e.createProject({
      name: "Лунные почтальоны",
      genre: "Obby",
      goal: "Test complete comparable previews",
    });
    const make = (familyId: string, geometry: string, uiLayout: string) => ({
      familyId,
      name: familyId,
      rules: {
        geometry,
        uiLayout,
        palette: {
          sky: "#30406a",
          ground: "#7986ad",
          surface: "#afc9dd",
          primary: "#24648b",
          accent: "#f5cf7e",
          ink: "#182439",
          panel: "#ffffff",
        },
        materials: ["Plastic", "Neon"],
        lighting: "soft",
        avatar: "original",
        typography: "game UI",
        rationale: "test",
        mobile: "44px",
        hud: "same functions",
        shop: "cosmetics",
        inventory: "same items",
      },
      references: [
        {
          game: "Test reference",
          author: "Test author",
          url: "https://www.biggames.io/post/pet-simulator-99-update-99",
          checkedAt: new Date().toISOString(),
          device: "unknown",
          screen: "inventory",
          observations: "fixture",
          confidence: "fixture",
        },
      ],
      previews: [],
    });
    const variants = [
      make("roblox-classic", "blocks", "arcade"),
      make("toy-cartoon", "rounded", "playful"),
      make("atmospheric-lowpoly", "faceted", "quiet"),
    ];
    const result = manifestSchema.parse({
      summary: "style plans",
      data: { styles: variants },
    });
    materializeStylePreviews(p, result);
    assert.equal(result.files.length, 24);
    for (let i = 1; i <= 3; i++)
      for (const screen of ["hud", "shop", "inventory", "menu"])
        for (const device of ["desktop", "mobile"]) {
          const f = result.files.find(
            (f) => f.path === `style-${i}/${screen}-${device}.svg`,
          )!;
          assert.ok(f);
          assert.match(f.content, /КОНЦЕПЦИЯ · НЕ СКРИНШОТ STUDIO/);
          assert.doesNotMatch(f.content, /<script|<foreignObject|href=|src=/i);
          assert.match(
            f.content,
            device === "mobile"
              ? /width="390" height="844"/
              : /width="1280" height="720"/,
          );
        }
    assert.notEqual(result.files[0].content, result.files[8].content);
    const bad = manifestSchema.parse({
      summary: "bad",
      data: {
        styles: [
          variants[0],
          { ...variants[0], name: "different color" },
          { ...variants[0], name: "another color" },
        ],
      },
    });
    assert.throws(() => materializeStylePreviews(p, bad), /геометрией/);
    const first = e.task(p, {
      title: "First choices",
      role: "art",
      kind: "styles",
      instructions: "first generation",
    });
    acceptReviewed(
      e,
      first,
      manifestSchema.parse({
        summary: "First generation",
        data: { styles: variants },
      }),
    );
    const original = e.currentStyles(p.id);
    assert.equal(original.length, 3);
    e.updateProject(p.id, { selectedStyle: original[0].id });
    const second = e.task(e.project(p.id), {
      title: "Revised choices",
      role: "art",
      kind: "styles",
      instructions: "new generation",
    });
    acceptReviewed(
      e,
      second,
      manifestSchema.parse({
        summary: "Second generation",
        data: { styles: variants },
      }),
    );
    assert.equal(e.currentStyles(p.id).length, 3);
    assert.equal(s.all<StylePackage>("style").length, 6);
    assert.ok(s.get<StylePackage>("style", original[0].id)!.supersededAt);
    assert.equal(e.project(p.id).selectedStyle, null);
    assert.throws(
      () => e.updateProject(p.id, { selectedStyle: original[0].id }),
      /текущим/,
    );
    e.updateProject(p.id, {
      concept: "An approved original game concept for visual comparison",
    });
    e.approve(p.id, "concept");
    const current = e.project(p.id);
    current.studioId = "visual-fixture";
    e.save(current);
    s.put("studio", {
      id: "visual-fixture",
      projectId: p.id,
      name: "Fixture",
      placeId: "0",
      universeId: "0",
      version: 0,
      fingerprint: "base",
      capabilities: ["snapshot", "apply", "test", "capture"],
      lastSeen: new Date().toISOString(),
      stopped: false,
    });
    const candidate = e.currentStyles(p.id)[0],
      preview = e.stylePreview(p.id, candidate.id);
    assert.equal(e.project(p.id).selectedStyle, null);
    assert.equal(preview.previewStyleId, candidate.id);
    assert.equal(e.project(p.id).approvals.style, undefined);
    assert.throws(
      () =>
        e.acceptResult(
          { ...preview, previewStyleHash: "stale" },
          manifestSchema.parse({ summary: "stale source" }),
        ),
      /Правила/,
    );
    preview.status = "succeeded";
    s.put("task", preview);
    e.initialCheckpoint(e.project(p.id), {
      instances: [],
      fingerprint: "base",
    });
    const runtime = (failedSubcheck: boolean) => {
      const checkTask = e.task(e.project(p.id), {
        title: "Native runtime evidence",
        role: "qa",
        kind: "style-retest",
        provider: "studio",
        status: "verifying",
        instructions: "test",
      });
      const command = e.queue(e.project(p.id), checkTask, "test", {
        styleId: candidate.id,
      });
      command.status = "sent";
      s.put("command", command);
      e.commandResult("visual-fixture", command.id, {
        ok: true,
        projectId: p.id,
        baseRevision: 0,
        fingerprint: "base",
        checks: [
          {
            id: "style-runtime",
            name: "Runtime",
            status: "passed",
            evidence: "Observed client",
          },
          {
            id: "localization",
            name: "English source and Roblox localization",
            status: "passed",
            evidence: "Observed native English source table and client GUI",
          },
          {
            id: "client-layout",
            name: "Layout",
            status: failedSubcheck ? "failed" : "passed",
            evidence: "Measured bounds",
          },
        ],
      });
    };
    runtime(true);
    assert.equal(s.get<StylePackage>("style", candidate.id)!.status, "concept");
    runtime(false);
    assert.equal(s.get<StylePackage>("style", candidate.id)!.status, "studio");
    assert.equal(e.project(p.id).approvals.style, undefined);
    const reset = e.resetStylePreview(p.id);
    reset.status = "sent";
    s.put("command", reset);
    e.commandResult("visual-fixture", reset.id, {
      ok: true,
      projectId: p.id,
      baseRevision: 0,
      fingerprint: "base",
    });
    assert.equal(e.project(p.id).revision, 0);
    assert.equal(e.versions(p.id).length, 1);
    assert.equal(e.project(p.id).stage, "style");
    e.unbindStudio(p.id);
    assert.equal(e.project(p.id).studioId, null);
    assert.equal(s.get<any>("studio", "visual-fixture").projectId, null);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("concept art can load local guidance without Studio while scene validation still requires it", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-art-"));
  const s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const p = e.createProject({
      name: "Art fixture",
      genre: "Simulator",
      goal: "Offline style planning",
    });
    const t = e.task(p, {
      title: "Styles",
      kind: "styles",
      role: "art",
      instructions: "Prepare plans",
    });
    assert.match(e.skillContext(p, t), /local-art/);
    const scene = e.task(p, {
      title: "Scene",
      kind: "style-preview",
      role: "art",
      instructions: "Build scene",
    });
    assert.throws(() => e.skillContext(p, scene), /недоступны/);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("native candidates can be prepared offline, require compatible Studio to apply and repair failed runtime checks within the limit", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-native-candidates-")),
    s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const p = e.createProject({
      name: "Native candidate",
      genre: "Obby",
      goal: "Prepare without editing Studio",
    });
    p.concept = "An original compact course with a courier";
    e.save(p);
    e.approve(p.id, "concept");
    const style: StylePackage = {
      id: "candidate-fixture",
      projectId: p.id,
      familyId: "roblox-classic",
      name: "Candidate",
      version: 1,
      status: "concept",
      rules: {},
      references: [],
      previews: [],
      studioEvidence: null,
    };
    s.put("style", style);
    const draft = e.stylePreview(p.id, style.id, true);
    assert.match(e.skillContext(p, draft), /SKILL roblox-ui@/);
    assert.match(e.skillContext(p, draft), /SKILL roblox-luau@/);
    draft.attempt = 1;
    draft.requirementsHash = e.taskRequirementsHash(e.project(p.id), draft);
    const scene = manifestSchema.parse({
      summary: "Prepared scene",
      instances: [
        { path: "StarterGui/Preview", className: "ScreenGui", properties: {} },
        {
          path: "StarterGui/Preview/Title",
          className: "TextLabel",
          properties: { Text: "Native preview" },
        },
        {
          path: "Workspace/Preview",
          className: "Part",
          properties: { Anchored: true },
        },
        {
          path: "ServerStorage/AutomationTests",
          className: "ModuleScript",
          properties: {},
          source: "return {run=function() return {checks={}} end}",
        },
      ],
    });
    acceptReviewed(e, draft, scene);
    assert.equal(s.all("command").length, 0);
    assert.equal(e.project(p.id).selectedStyle, null);
    assert.throws(() => e.applyPreparedStyle(p.id, style.id), /недоступны/);
    e.updateProject(p.id, { selectedStyle: style.id });
    Object.assign(p, e.project(p.id));
    p.studioId = "candidate-studio";
    e.save(p);
    s.put("studio", {
      id: p.studioId,
      projectId: p.id,
      name: "Fixture",
      placeId: "0",
      universeId: "0",
      version: 0,
      fingerprint: "base",
      capabilities: ["apply", "test", "capture"],
      lastSeen: new Date().toISOString(),
      stopped: false,
    });
    e.initialCheckpoint(e.project(p.id), {
      instances: [
        {
          path: "Workspace/Baseplate",
          className: "Part",
          properties: { Anchored: true, Transparency: 0 },
        },
      ],
      fingerprint: "base",
    });
    const apply = e.applyPreparedStyle(p.id, style.id);
    const environment = s
      .get<any>("task", draft.id)
      .result.instances.find((i: any) =>
        i.path.endsWith("AutomationPreviewEnvironment"),
      );
    assert.match(environment.source, /Workspace\/Baseplate/);
    assert.match(environment.source, /LocalTransparencyModifier/);
    assert.doesNotMatch(environment.source, /:Destroy\(/);
    apply.status = "sent";
    s.put("command", apply);
    e.commandResult(p.studioId, apply.id, {
      ok: true,
      projectId: p.id,
      baseRevision: 0,
      fingerprint: "native-scene",
    });
    const check = s.all<any>("command").at(-1);
    check.status = "sent";
    s.put("command", check);
    e.commandResult(p.studioId, check.id, {
      ok: true,
      projectId: p.id,
      baseRevision: 0,
      fingerprint: "native-scene",
      checks: [
        {
          id: "style-runtime",
          name: "Runtime",
          status: "failed",
          evidence: "Client response timeout",
        },
      ],
    });
    const retry = s.get<any>("task", draft.id);
    assert.equal(retry.status, "queued");
    assert.match(retry.error, /Client response timeout/);
    assert.equal(retry.attempt, 1);
    assert.equal(s.get<StylePackage>("style", style.id)!.status, "concept");
    retry.attempt = retry.maxAttempts;
    s.put("task", retry);
    acceptReviewed(e, retry, scene);
    const secondApply = s.all<any>("command").at(-1);
    secondApply.status = "sent";
    s.put("command", secondApply);
    e.commandResult(p.studioId, secondApply.id, {
      ok: true,
      projectId: p.id,
      baseRevision: 0,
      fingerprint: "native-scene",
    });
    const exhausted = s.all<any>("command").at(-1);
    exhausted.status = "sent";
    s.put("command", exhausted);
    e.commandResult(p.studioId, exhausted.id, {
      ok: true,
      projectId: p.id,
      baseRevision: 0,
      fingerprint: "native-scene",
      checks: [
        {
          id: "style-runtime",
          name: "Runtime",
          status: "failed",
          evidence: "Still failed",
        },
      ],
    });
    assert.equal(s.get<any>("task", draft.id).status, "failed");
    assert.equal(e.project(p.id).approvals.style, undefined);
    const preparedAgain = s.get<any>("task", draft.id);
    preparedAgain.status = "blocked";
    preparedAgain.error = "Unexpected Studio edits before apply";
    s.put("task", preparedAgain);
    const repeated = e.applyPreparedStyle(p.id, style.id);
    assert.equal(repeated.operation, "apply");
    assert.equal(s.get<any>("task", draft.id).attempt, preparedAgain.attempt);
    assert.equal(s.get<any>("task", draft.id).status, "verifying");
    s.put("studio", {
      ...s.get<any>("studio", p.studioId),
      fingerprint: "different-scene",
    });
    assert.throws(() => e.retestStyle(p.id, style.id), /именно эту/);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("new preview rendering preserves the previous package and cannot change selected styles", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-preview-history-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  try {
    const p = engine.createProject({
      name: "Новый город",
      genre: "Roleplay",
      goal: "Original city game",
    });
    const scene = sceneForProject(p);
    assert.equal(scene.layout, "plaza");
    assert.equal(scene.theme, "neutral");
    assert.doesNotMatch(JSON.stringify(scene), /Лун|кристалл|маяк/i);
    const s: StylePackage = {
      id: "test-style",
      projectId: p.id,
      familyId: "roblox-classic",
      version: 1,
      name: "Классика",
      status: "concept",
      studioEvidence: null,
      references: [
        {
          game: "Fixture",
          author: "Fixture",
          url: "https://www.roblox.com/",
          checkedAt: new Date().toISOString(),
          device: "unknown",
          screen: "identity",
          observations: "Fixture source",
          confidence: "fixture",
        },
      ],
      previews: [
        {
          screen: "hud",
          device: "mobile",
          kind: "concept",
          file: "old/hud.svg",
        },
      ],
      rules: {
        geometry: "blocks",
        uiLayout: "arcade",
        palette: {
          sky: "#99ccdd",
          ground: "#5c9e60",
          surface: "#ffffff",
          primary: "#ffdd00",
          accent: "#203040",
          ink: "#192035",
          panel: "#ffffff",
        },
        materials: ["Plastic", "SmoothPlastic"],
        lighting: "day",
        avatar: "blocks",
        typography: "sans",
        rationale: "same functions",
        mobile: "safe area",
        hud: "progress",
        shop: "cosmetics",
        inventory: "cosmetics",
        previewRenderer: "older",
      },
    };
    store.file("old/hud.svg", "original");
    store.put("style", s);
    assert.equal(engine.refreshStyleConcepts(p.id).updated, 1);
    const updated = store.get<StylePackage>("style", s.id)!;
    assert.equal(updated.version, 2);
    assert.equal(updated.rules.previewRenderer, PREVIEW_RENDERER);
    assert.equal(updated.previews.length, 8);
    assert.equal(store.read("old/hud.svg"), "original");
    assert.equal(store.get<any>("styleHistory", "test-style@1").version, 1);
    assert.equal(engine.refreshStyleConcepts(p.id).updated, 0);
    engine.updateProject(p.id, { selectedStyle: s.id });
    assert.throws(() => engine.refreshStyleConcepts(p.id), /до выбора/);
    assert.equal(contrastText("#ffff00"), "#111111");
    assert.equal(contrastText("#000033"), "#ffffff");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

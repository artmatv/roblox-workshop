import { effortModels } from "./effort-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import {
  getStylePresets,
  UI_STYLE_SKILL,
  assertPresetStyle,
  presetAgentContext,
  stylePresetLibrary,
} from "../server/style-presets.js";
import { importSkill } from "../server/skills.js";
import { assertSafeSvg } from "../server/safe-svg.js";
import { preferredStylePreview } from "../shared/style-preview-selection.js";
// The owner's reference photos stay out of the public repository; a fresh
// clone serves presets without them, so photo checks run only where present.
const referencePhotos = existsSync(
  resolve(
    import.meta.dirname,
    "../.agents/skills/roblox-ui-styles/references/images/bright-simulator.png",
  ),
);
import type { StylePackage } from "../shared/domain.js";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "automation-ui-kits-")),
    store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex),
    project = engine.createProject({
      name: "Reusable style fixture",
      genre: "Obby",
      goal: "Choose presentation without creating a prototype",
    });
  return {
    root,
    store,
    codex,
    engine,
    project,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("ready styles can be selected and approved offline; selection starts no agents, Studio commands or paid operations", () => {
  const f = fixture();
  try {
    const presets = getStylePresets(
      f.store,
      f.project.skillPins[UI_STYLE_SKILL],
    );
    assert.equal(presets.length, 3);
    for (const p of presets) {
      assert.equal(p.previews.length, 8);
      for (const file of p.previews) assertSafeSvg(f.store.read(file.file));
      assertSafeSvg(f.store.read(p.iconSheet));
    }
    const selected = f.engine.selectStylePreset(f.project.id, "neon-clicker");
    assert.equal(
      selected.rules.preset && (selected.rules.preset as any).id,
      "neon-clicker",
    );
    assert.equal(f.engine.project(f.project.id).selectedStyle, selected.id);
    assert.throws(() => f.engine.approve(f.project.id, "style"), /concept/);
    f.engine.updateProject(f.project.id, {
      concept:
        "Collect resources, improve tools and unlock three original zones.",
    });
    f.engine.approve(f.project.id, "concept");
    f.engine.approve(f.project.id, "style");
    assert.equal(f.engine.project(f.project.id).stage, "specification");
    assert.equal(
      f.store.get<StylePackage>("style", selected.id)!.studioEvidence,
      null,
    );
    assert.equal(f.engine.tasks(f.project.id).length, 0);
    assert.equal(f.store.all("command").length, 0);
    assert.equal(f.store.all("providerOperation").length, 0);
    assert.ok(
      f.engine.project(f.project.id).requiredChecks.includes("localization"),
    );
    assert.ok(
      f.engine.releaseBlockers(f.engine.project(f.project.id), undefined)
        .length,
    );
    const before = f.engine.project(f.project.id).approvals.style;
    f.engine.selectStylePreset(f.project.id, "neon-clicker");
    assert.deepEqual(f.engine.project(f.project.id).approvals.style, before);
    f.engine.selectStylePreset(f.project.id, "bright-simulator");
    assert.equal(f.engine.project(f.project.id).approvals.style, undefined);
  } finally {
    f.close();
  }
});
test("preset approval rejects changed definitions and pinned archives survive a skill upgrade", () => {
  const f = fixture();
  try {
    const selected = f.engine.selectStylePreset(
        f.project.id,
        "tactical-tycoon",
      ),
      p = f.engine.project(f.project.id);
    const changed = f.store.get<StylePackage>("style", selected.id)!;
    (changed.rules.palette as any).primary = "#ffffff";
    assert.throws(() => assertPresetStyle(f.store, p, changed), /отличается/);
    importSkill(f.store, {
      id: UI_STYLE_SKILL,
      source: "https://example.com/reviewed-version",
      version: "2.0.0",
      license: "Private",
      roles: ["ui"],
      capabilities: [],
      dependencies: [],
      files: [{ path: "SKILL.md", content: "A newer package awaiting review" }],
    });
    assert.equal(
      getStylePresets(f.store, p.skillPins[UI_STYLE_SKILL]).length,
      3,
    );
    assert.equal(
      assertPresetStyle(
        f.store,
        p,
        f.store.get<StylePackage>("style", selected.id)!,
      ).version,
      "1.0.0",
    );
    const skill = f.store.get<any>("skill", UI_STYLE_SKILL);
    skill.status = "disabled";
    f.store.put("skill", skill);
    assert.equal(
      stylePresetLibrary(f.store, p.skillPins[UI_STYLE_SKILL]).items.length,
      0,
    );
    assert.match(stylePresetLibrary(f.store).error!, /отключён/);
  } finally {
    f.close();
  }
});
test("interface turns receive the pinned style skill, actual kit tokens, icon vectors and the selected user reference", async () => {
  const f = fixture(),
    calls: any[] = [];
  try {
    f.engine.selectStylePreset(f.project.id, "bright-simulator");
    const p = f.engine.project(f.project.id);
    p.studioId = "fixture";
    f.store.put("studio", {
      id: "fixture",
      capabilities: ["apply", "test", "capture"],
    });
    f.codex.isolatedConfig = async () => ({
      web_search: "disabled",
      features: { shell_tool: false, apps: false, collab: false },
      mcp_servers: {},
    });
    f.codex.request = async (method: string, params: any) => {
      calls.push({ method, params });
      return method === "thread/start"
        ? { thread: { id: "ui-kit-thread" } }
        : { turn: { id: "ui-kit-turn" } };
    };
    f.engine.account = { account: { type: "chatgpt", id: "fixture" } };
    const t = f.engine.task(p, {
      title: "Apply the chosen kit",
      role: "ui",
      kind: "ui",
      instructions: "Implement the approved interface",
      status: "planned",
    });
    f.engine.models = effortModels;
    await f.engine.runAgent(p, t);
    assert.ok(t.skills.some((s) => s.id === UI_STYLE_SKILL));
    assert.match(
      calls.find((c) => c.method === "thread/start").params
        .developerInstructions,
      /SKILL roblox-ui-styles@1\.0\.0/,
    );
    const turn = calls.find((c) => c.method === "turn/start").params,
      prompt = JSON.parse(turn.input.find((i: any) => i.type === "text").text);
    assert.equal(prompt.uiStyleKit.preset.id, "bright-simulator");
    assert.equal(prompt.uiStyleKit.preset.native.minimumTouchTarget, 44);
    assert.ok(prompt.uiStyleKit.icons.icons.potion.paths.length);
    assert.equal(
      turn.input.filter((i: any) => i.type === "localImage").length,
      referencePhotos ? 1 : 0,
    );
    if (referencePhotos)
      assert.match(
        turn.input.find((i: any) => i.type === "localImage").path,
        /bright-simulator\.png$/,
      );
    assert.equal(presetAgentContext(f.store, p, "gameplay"), null);
  } finally {
    f.close();
  }
});
test("preset catalogue, image files, selection and reload work through the authenticated API without Studio", async () => {
  const f = fixture(),
    port = 48273,
    server = createApp(f.store, f.engine, "ui-kit-token", {
      port,
      appRoot: resolve("."),
    }).listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const call = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}` + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer ui-kit-token",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const initial = await (await call(`/api/projects/${f.project.id}`)).json();
    assert.equal(initial.uiStyles.items.length, 3);
    const item = initial.uiStyles.items[0],
      file = await call(
        "/api/files?" + new URLSearchParams({ path: item.previews[0].file }),
      );
    assert.equal(file.status, 200);
    assert.match(await file.text(), /data-icon="shop"/);
    const selected = await call(`/api/projects/${f.project.id}/styles/preset`, {
      presetId: item.id,
    });
    assert.equal(selected.status, 200);
    const reloaded = await (await call(`/api/projects/${f.project.id}`)).json();
    assert.equal(reloaded.project.selectedStyle, (await selected.json()).id);
    assert.equal(reloaded.tasks.length, 0);
    assert.equal(reloaded.commands.length, 0);
    assert.equal(
      (
        await call(`/api/projects/${f.project.id}/styles/preset`, {
          presetId: "../../outside",
        })
      ).status,
      409,
    );
    importSkill(f.store, {
      id: UI_STYLE_SKILL,
      source: "https://example.com/new-version",
      version: "2.0.0",
      license: "Private",
      roles: ["ui"],
      capabilities: [],
      dependencies: [],
      files: [{ path: "SKILL.md", content: "New version awaiting review" }],
    });
    const reference = await call(
      `/api/style-presets/${item.id}/reference?pin=${item.skillHash}`,
    );
    if (referencePhotos) {
      assert.equal(
        reference.status,
        200,
        reference.ok ? "" : await reference.text(),
      );
      assert.match(reference.headers.get("content-type")!, /image\/png/);
      const photo = new Uint8Array(await reference.arrayBuffer());
      assert.deepEqual(
        [...photo.slice(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
      );
    } else assert.equal(reference.ok, false);
    const skill = f.store.get<any>("skill", UI_STYLE_SKILL);
    skill.status = "disabled";
    f.store.put("skill", skill);
    assert.equal((await call("/api/state")).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
  }
});
test("SVG packages reject executable/external content while accepting the shipped standalone icons", () => {
  assert.throws(() => assertSafeSvg("<svg><script>alert(1)</script></svg>"));
  assert.throws(() =>
    assertSafeSvg('<svg><use href="https://example.com/icon.svg"/></svg>'),
  );
  assert.throws(() =>
    assertSafeSvg('<svg><image href="file:///secret.png"/></svg>'),
  );
  assertSafeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1" fill="#fff"/></svg>',
  );
});
test("an old concept image never hides a later Studio capture of the same screen", () => {
  const style = {
    previews: [
      { screen: "hud", device: "desktop", kind: "concept", file: "old.svg" },
      { screen: "hud", device: "desktop", kind: "studio", file: "actual.png" },
      {
        screen: "hud",
        device: "desktop",
        kind: "concept",
        file: "later-draft.svg",
      },
    ],
  } as StylePackage;
  assert.equal(
    preferredStylePreview(style, "hud", "desktop")?.file,
    "actual.png",
  );
  assert.equal(preferredStylePreview(style, "hud", "mobile"), undefined);
});

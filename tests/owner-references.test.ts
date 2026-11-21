import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Codex } from "../server/codex.js";
import { Engine } from "../server/engine.js";
import { Store } from "../server/store.js";
import {
  addReferenceImage,
  buildOwnerBrief,
  ownerReference,
  ownerReferenceImages,
  ownerStyleContext,
  referenceImages,
  removeReferenceImage,
  saveReferencePrompt,
} from "../server/owner-references.js";
import { presetReferenceImages } from "../server/style-presets.js";
import { effortModels } from "./effort-fixture.js";
import { placeIdFrom } from "../web/OwnerReferences.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString(
  "base64",
);
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "automation-owner-refs-")),
    store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex),
    project = engine.createProject({
      name: "Owner style fixture",
      genre: "Obby",
      goal: "Use the owner's own references",
    });
  return {
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

test("owner uploads are validated, listed, removed and handed to art agents", () => {
  const f = fixture();
  try {
    const id = f.project.id;
    assert.throws(
      () =>
        addReferenceImage(f.store, id, {
          dataBase64: "AAAA",
          mime: "image/png",
        }),
      /PNG\/JPEG/,
    );
    const first = addReferenceImage(f.store, id, {
      dataBase64: PNG,
      mime: "image/png",
    });
    addReferenceImage(f.store, id, { dataBase64: PNG, mime: "image/png" });
    assert.equal(referenceImages(f.store, id).length, 2);
    assert.throws(() => removeReferenceImage(f.store, id, "../project.json"));
    removeReferenceImage(f.store, id, first.name);
    const images = referenceImages(f.store, id);
    assert.deepEqual(
      images.map((i) => i.source),
      ["upload"],
    );
    assert.equal(ownerStyleContext(f.store, id), null);
    saveReferencePrompt(f.store, id, "  Объёмные кнопки, спокойный мир  ");
    assert.equal(
      ownerReference(f.store, id).prompt,
      "Объёмные кнопки, спокойный мир",
    );
    assert.equal(
      ownerStyleContext(f.store, id)?.prompt,
      "Объёмные кнопки, спокойный мир",
    );
    const project = f.engine.project(id);
    const ui = presetReferenceImages(f.store, project, "ui");
    assert.equal(ui.length, 1);
    assert.ok(ui[0].path.endsWith(images[0].name));
    assert.deepEqual(presetReferenceImages(f.store, project, "gameplay"), []);
  } finally {
    f.close();
  }
});

test("the style brief is one read-only turn over the owner's images and wish", async () => {
  const f = fixture();
  try {
    const id = f.project.id;
    const a = addReferenceImage(f.store, id, {
      dataBase64: PNG,
      mime: "image/png",
    });
    const b = addReferenceImage(f.store, id, {
      dataBase64: PNG,
      mime: "image/png",
    });
    saveReferencePrompt(f.store, id, "Яркий интерфейс");
    const calls: any[] = [];
    f.codex.ready = true;
    f.codex.isolatedConfig = async () => ({ mcp_servers: {}, features: {} });
    f.codex.request = async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === "config/read") return { config: { model: "test-model" } };
      if (method === "thread/start") return { thread: { id: "brief-thread" } };
      setTimeout(() => {
        f.codex.emit("notification", {
          method: "item/completed",
          params: {
            threadId: "brief-thread",
            turnId: "brief-turn",
            item: {
              type: "agentMessage",
              text: JSON.stringify({
                summary: "Яркие объёмные кнопки",
                palette: [
                  { hex: "#FFAA00", role: "главное действие" },
                  { hex: "#1E2A44", role: "панель" },
                  { hex: "#FFFFFF", role: "текст" },
                ],
                shapes: "скруглённые",
                typography: "жирный",
                hud: "ресурсы сверху",
                world: "пастельный",
                icons: "объёмные",
                avoid: "мелкий текст",
                picks: [
                  { file: b.name, why: "лучшие кнопки" },
                  { file: "invented.png", why: "нет такого файла" },
                ],
              }),
            },
          },
        });
        f.codex.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "brief-thread",
            turn: { id: "brief-turn", status: "completed" },
          },
        });
      }, 10);
      return { turn: { id: "brief-turn" } };
    };
    const saved = await buildOwnerBrief({
      store: f.store,
      agent: f.codex,
      project: f.engine.project(id),
      models: effortModels,
    });
    assert.deepEqual(
      saved.brief?.picks.map((p) => p.file),
      [b.name],
    );
    const start = calls.find((c) => c.method === "thread/start").params;
    assert.equal(start.sandbox, "read-only");
    assert.equal(start.ephemeral, true);
    const turn = calls.find((c) => c.method === "turn/start").params;
    assert.equal(turn.effort, "medium");
    assert.equal(
      turn.input.filter((i: any) => i.type === "localImage").length,
      2,
    );
    assert.match(turn.input[0].text, /Яркий интерфейс/);
    assert.ok(a.name);
    const handed = ownerReferenceImages(f.store, id);
    assert.equal(handed.length, 1);
    assert.ok(handed[0].path.endsWith(b.name));
    assert.equal(
      ownerStyleContext(f.store, id)?.brief?.summary,
      "Яркие объёмные кнопки",
    );
  } finally {
    f.close();
  }
});

test("game links and bare ids give the place id to open in Roblox", () => {
  assert.equal(
    placeIdFrom("https://www.roblox.com/games/920587237/Adopt-Me"),
    "920587237",
  );
  assert.equal(placeIdFrom("  142823291 "), "142823291");
  assert.equal(placeIdFrom("roblox"), null);
});

test(
  "the Roblox Player capture script runs and saves nothing without a Roblox window",
  { skip: process.platform !== "win32" },
  () => {
    const out = mkdtempSync(resolve(tmpdir(), "automation-capture-"));
    try {
      const run = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(import.meta.dirname, "../server/capture-roblox.ps1"),
          "-OutDir",
          out,
          "-Seconds",
          "1",
          "-IntervalMs",
          "200",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 60_000 },
      );
      assert.equal(run.status, 0, run.stderr);
      assert.ok(existsSync(out));
      assert.deepEqual(
        readdirSync(out).filter((n) => n.startsWith("capture-")),
        [],
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
);

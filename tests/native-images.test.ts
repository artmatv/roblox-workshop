import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  linkSync,
  symlinkSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { stageGeneratedImage } from "../server/native-images.js";
import { assertNativeEvidence } from "../server/native-harness.js";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { NATIVE_KIND } from "../shared/native-harness.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=",
  "base64",
);
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "native-images-"));
  const codexHome = resolve(root, "codex"),
    workspace = resolve(root, "workspace"),
    traceRoot = resolve(root, "trace"),
    threadId = "thread-fixture";
  mkdirSync(workspace);
  mkdirSync(resolve(codexHome, "generated_images", threadId), {
    recursive: true,
  });
  const source = resolve(codexHome, "generated_images", threadId, "image.png");
  writeFileSync(source, png);
  return {
    root,
    codexHome,
    workspace,
    traceRoot,
    threadId,
    source,
    item: {
      id: "item-1",
      type: "imageGeneration",
      status: "completed",
      savedPath: source,
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
function stage(f: ReturnType<typeof setup>, item = f.item) {
  return stageGeneratedImage({
    codexHome: f.codexHome,
    threadId: f.threadId,
    item,
    workspace: f.workspace,
    traceRoot: f.traceRoot,
  });
}
test("completed image is copied and indexed with exact bytes, digest, and stable paths", () => {
  const f = setup();
  try {
    const first = stage(f),
      second = stage(f);
    const expectedHash = createHash("sha256").update(png).digest("hex");
    const assetPath = resolve(f.workspace, first.asset),
      previewPath = resolve(f.traceRoot, first.preview);
    assert.equal(first.sha256, expectedHash);
    assert.equal(first.asset, second.asset);
    assert.deepEqual(readFileSync(assetPath), png);
    assert.deepEqual(readFileSync(previewPath), png);
    const index = JSON.parse(
      readFileSync(
        resolve(f.workspace, "assets/generated-images.json"),
        "utf8",
      ),
    );
    assert.equal(index.length, 1);
    assert.deepEqual(index[0], {
      itemId: "item-1",
      path: first.asset,
      sha256: expectedHash,
    });
  } finally {
    f.close();
  }
});
test("failed, incomplete, malformed, outside, hardlinked and linked destinations are rejected", () => {
  const f = setup();
  try {
    for (const item of [
      { ...f.item, id: "" },
      { ...f.item, id: "../bad" },
      { ...f.item, status: "failed" },
      { ...f.item, status: "inProgress" },
      { ...f.item, failure: { message: "failed" } },
      { ...f.item, savedPath: resolve(f.root, "elsewhere.png") },
    ])
      assert.throws(() => stage(f, item));
    const truncated = resolve(
      f.codexHome,
      "generated_images",
      f.threadId,
      "truncated.png",
    );
    writeFileSync(truncated, png.subarray(0, -8));
    assert.throws(() => stage(f, { ...f.item, savedPath: truncated }));
    const wrong = resolve(
      f.codexHome,
      "generated_images",
      f.threadId,
      "wrong.png",
    );
    writeFileSync(wrong, Buffer.from("not png"));
    assert.throws(() => stage(f, { ...f.item, savedPath: wrong }));
    const hard = resolve(
      f.codexHome,
      "generated_images",
      f.threadId,
      "hard.png",
    );
    linkSync(f.source, hard);
    assert.throws(() => stage(f, { ...f.item, savedPath: hard }));
    unlinkSync(hard);
    const external = resolve(f.root, "external");
    mkdirSync(external);
    writeFileSync(resolve(external, "image.png"), png);
    const junction = resolve(
      f.codexHome,
      "generated_images",
      f.threadId,
      "junction",
    );
    symlinkSync(external, junction, "junction");
    assert.throws(() =>
      stage(f, { ...f.item, savedPath: resolve(junction, "image.png") }),
    );
    const indexJunction = resolve(f.workspace, "assets");
    mkdirSync(indexJunction);
    const outsideIndex = resolve(f.root, "outside-index.json");
    writeFileSync(outsideIndex, "[]");
    const indexContent = readFileSync(outsideIndex, "utf8");
    const outsideIndexHard = resolve(indexJunction, "generated-images.json");
    linkSync(outsideIndex, outsideIndexHard);
    assert.throws(() => stage(f, { ...f.item, id: "index-hardlink" }));
    assert.equal(readFileSync(outsideIndex, "utf8"), indexContent);
    unlinkSync(outsideIndexHard);
    const expectedDest = resolve(
      indexJunction,
      `generated-${createHash("sha256").update("linked-dest").digest("hex")}.png`,
    );
    const outsideAsset = resolve(f.root, "outside-asset.png");
    writeFileSync(outsideAsset, png);
    linkSync(outsideAsset, expectedDest);
    assert.throws(() => stage(f, { ...f.item, id: "linked-dest" }));
    const workspaceJunction = resolve(f.root, "linked-workspace");
    symlinkSync(external, workspaceJunction, "junction");
    assert.throws(() =>
      stageGeneratedImage({
        codexHome: f.codexHome,
        threadId: f.threadId,
        item: { ...f.item, id: "junction-dest" },
        workspace: workspaceJunction,
        traceRoot: f.traceRoot,
      }),
    );
  } finally {
    f.close();
  }
});
test("image evidence requires hash-matched generated upload and preserves legacy draw evidence", () => {
  const shots = [
    "world-desktop",
    "hud-desktop",
    "shop-desktop",
    "collection-desktop",
    "hud-mobile",
  ].map((capture_id) => ({
    tool: "screen_capture",
    success: true,
    captures: ["frame.png"],
    arguments: { capture_id },
    viewport: { device: capture_id === "hud-mobile" ? "phone" : "default" },
  }));
  const generated = {
      tool: "image_gen",
      success: true,
      asset: "assets/generated-x.png",
      sha256: "a".repeat(64),
    },
    mesh = { tool: "generate_mesh", success: true };
  assert.throws(() =>
    assertNativeEvidence(shots, [
      ...shots,
      generated,
      {
        tool: "upload_image",
        success: true,
        images: [{ path: "assets/unrelated.png", sha256: "b".repeat(64) }],
      },
      mesh,
    ]),
  );
  assert.equal(
    assertNativeEvidence(shots, [
      ...shots,
      generated,
      {
        tool: "upload_image",
        success: true,
        images: [{ path: generated.asset, sha256: generated.sha256 }],
      },
      mesh,
    ]).length,
    5,
  );
  assert.equal(
    assertNativeEvidence(shots, [
      ...shots,
      { tool: "draw_icon", asset: "assets/icon.png" },
      { tool: "upload_image", success: true },
      mesh,
    ]).length,
    5,
  );
});
test("engine stages image items only for the active matching native thread and turn", () => {
  const f = setup(),
    dbRoot = resolve(f.root, "store"),
    store = new Store(dbRoot),
    codex = new Codex(),
    engine = new Engine(store, codex);
  try {
    const project = engine.createProject({
      name: "Image fixture",
      genre: "Simulator",
      goal: "Check event routing",
    });
    const task = engine.task(project, {
      title: "Native",
      role: "designer",
      kind: NATIVE_KIND,
      instructions: "test",
    });
    task.status = "running";
    task.threadId = f.threadId;
    task.turnId = "turn-good";
    store.put("task", task);
    engine.active.add(task.id);
    store.put("nativeSession", {
      id: project.id,
      taskId: task.id,
      threadId: f.threadId,
      workspace: f.workspace,
      status: "running",
      revision: 0,
    });
    engine.native.imageGenerationHome = f.codexHome;
    store.put("agentMessage", { id: task.id, text: "keep this" });
    const imageEvent = (threadId: string, turnId: string) => ({
      method: "item/completed",
      params: { threadId, turnId, item: f.item },
    });
    engine.onNotification(imageEvent("wrong-thread", "turn-good"));
    engine.onNotification(imageEvent(f.threadId, "wrong-turn"));
    engine.onNotification({
      method: "item/completed",
      params: { threadId: f.threadId, item: f.item },
    });
    assert.equal(existsSync(resolve(f.workspace, "assets")), false);
    engine.onNotification({
      method: "item/completed",
      params: {
        threadId: f.threadId,
        turnId: "turn-good",
        item: { ...f.item, type: "reasoning" },
      },
    });
    const priorMessage = store.get<any>("agentMessage", task.id)?.text;
    task.kind = "build";
    store.put("task", task);
    engine.onNotification(imageEvent(f.threadId, "turn-good"));
    task.kind = NATIVE_KIND;
    store.put("task", task);
    engine.active.delete(task.id);
    engine.onNotification(imageEvent(f.threadId, "turn-good"));
    engine.active.add(task.id);
    assert.equal(existsSync(resolve(f.workspace, "assets")), false);
    engine.onNotification(imageEvent(f.threadId, "turn-good"));
    engine.onNotification(imageEvent(f.threadId, "turn-good"));
    const runRoot = resolve(dbRoot, "native-runs", task.id),
      traceLines = readFileSync(resolve(runRoot, "tools.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.equal(traceLines.length, 1);
    assert.equal(traceLines[0].success, true);
    assert.equal(traceLines[0].tool, "image_gen");
    assert.equal(store.get<any>("agentMessage", task.id)?.text, priorMessage);
    assert.equal(
      JSON.parse(
        readFileSync(
          resolve(f.workspace, "assets/generated-images.json"),
          "utf8",
        ),
      ).length,
      1,
    );
  } finally {
    engine.active.clear();
    store.close();
    f.close();
  }
});

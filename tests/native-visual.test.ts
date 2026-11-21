import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import {
  MAX_VISUAL_FRAMES,
  copyVisualFrames,
  cleanupVisualFrames,
  selectVisualFrames,
  verifyVisualFrames,
} from "../server/native-visual.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  "base64",
);
const labels = [
  "world-desktop",
  "hud-desktop",
  "shop-desktop",
  "collection-desktop",
  "hud-mobile",
];
function records(taskId = "task", attempt = 3) {
  return labels.map((capture_id, i) => ({
    taskId,
    attempt,
    tool: "screen_capture",
    success: true,
    captureRecordId: String(i).padStart(24, "0"),
    arguments: { capture_id },
    captures: [`frame-${i}.png`],
    viewport: { device: i === 4 ? "phone" : "default" },
  }));
}

test("selects the latest five required views and distinct targeted closeups", () => {
  const old = records("task", 2),
    current = records();
  current.push({
    taskId: "task",
    attempt: 3,
    tool: "screen_capture",
    success: true,
    captureRecordId: "000000000000000000000010",
    arguments: { capture_id: "hud-desktop" },
    captures: ["latest.png"],
    viewport: { device: "default" },
  });
  for (let i = 0; i < 9; i++)
    current.push({
      taskId: "task",
      attempt: 3,
      tool: "screen_capture",
      success: true,
      captureRecordId: String(20 + i).padStart(24, "0"),
      arguments: { capture_id: `${i === 8 ? "visual" : "closeup"}-${i}` },
      captures: [`target-${i}.png`],
      viewport: { device: "default" },
    });
  current.push({
    taskId: "task",
    attempt: 3,
    tool: "screen_capture",
    success: true,
    captureRecordId: "000000000000000000000029",
    arguments: { capture_id: "diagnostic-route" },
    captures: ["diagnostic-route.png"],
    viewport: { device: "default" },
  });
  current.push({
    taskId: "task",
    attempt: 3,
    tool: "screen_capture",
    success: true,
    captureRecordId: "000000000000000000000030",
    arguments: { capture_id: "closeup-2" },
    captures: ["closeup-2-retake.png"],
    viewport: { device: "default" },
  });
  const selected = selectVisualFrames([...old, ...current], "task", 3);
  assert.equal(selected.length, 5 + 9);
  assert.ok(selected.length <= MAX_VISUAL_FRAMES);
  assert.equal(
    selected.find((frame) => frame.captureId === "hud-desktop")?.source,
    "latest.png",
  );
  assert.deepEqual(
    selected.slice(-9).map((frame) => frame.captureId),
    [
      "closeup-0",
      "closeup-1",
      "closeup-3",
      "closeup-4",
      "closeup-5",
      "closeup-6",
      "closeup-7",
      "visual-8",
      "closeup-2",
    ],
  );
  assert.equal(selected.at(-1)?.source, "closeup-2-retake.png");
  assert.equal(
    selected.some((frame) => frame.captureId === "diagnostic-route"),
    false,
  );
  assert.throws(() => selectVisualFrames(old, "task", 3), /текущей попытки/);
});

test("frames the delivery assigns to items are kept ahead of newer unassigned ones", () => {
  const current = records();
  for (let i = 0; i < MAX_VISUAL_FRAMES + 10; i++)
    current.push({
      taskId: "task",
      attempt: 3,
      tool: "screen_capture",
      success: true,
      captureRecordId: String(100 + i).padStart(24, "0"),
      arguments: { capture_id: `visual-${i}` },
      captures: [`v-${i}.png`],
      viewport: { device: "default" },
    });
  const plain = selectVisualFrames(current, "task", 3).map((f) => f.captureId);
  assert.ok(!plain.includes("visual-0"), "oldest frame falls out by recency");
  const kept = selectVisualFrames(current, "task", 3, undefined, ["visual-0", "visual-1"]);
  const ids = kept.map((f) => f.captureId);
  // With a delivery map the reviewer gets exactly the assigned targeted frames.
  assert.deepEqual(ids.filter((id) => id.startsWith("visual-")), ["visual-0", "visual-1"]);
});

test("copies bounded real PNG frames and rejects byte changes, traversal and linked sources", () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-visual-"));
  const outside = mkdtempSync(resolve(tmpdir(), "native-visual-out-"));
  const workspace = mkdtempSync(resolve(tmpdir(), "native-visual-workspace-"));
  try {
    for (const [i] of labels.entries())
      writeFileSync(resolve(root, `frame-${i}.png`), png);
    writeFileSync(resolve(outside, "external.png"), png);
    const frames = copyVisualFrames(root, records(), "task", 3, undefined, workspace);
    assert.equal(frames.length, 5);
    for (const frame of frames) {
      assert.equal(frame.path.startsWith(workspace + sep), true);
      const bytes = readFileSync(frame.path);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        frame.sha256,
      );
      assert.equal(lstatSync(frame.path).nlink, 1);
    }
    verifyVisualFrames(root, frames, workspace);
    assert.throws(() => verifyVisualFrames(root, frames, outside), /вышла из каталога/);
    writeFileSync(resolve(root, "frame-0.png"), Buffer.from("changed"));
    assert.throws(() => verifyVisualFrames(root, frames, workspace), /PNG|изменился/);
    const reviewDirectory = resolve(frames[0]!.path, "..");
    cleanupVisualFrames(workspace, frames);
    assert.throws(() => lstatSync(reviewDirectory), /ENOENT/);
    const linkedRecords = records();
    rmSync(resolve(root, "frame-0.png"));
    let symlinkAvailable = true;
    try {
      symlinkSync(
        resolve(outside, "external.png"),
        resolve(root, "frame-0.png"),
        "file",
      );
    } catch (error: any) {
      if (error?.code !== "EPERM") throw error;
      symlinkAvailable = false;
    }
    if (symlinkAvailable)
      assert.throws(
        () => copyVisualFrames(root, linkedRecords, "task", 3),
        /обычным файлом|ссылку/,
      );
    if (symlinkAvailable) {
      symlinkSync(root, resolve(outside, "linked-root"), "junction");
      assert.throws(
        () =>
          copyVisualFrames(
            resolve(outside, "linked-root"),
            records(),
            "task",
            3,
          ),
        /Каталог трассировки проходит через ссылку/,
      );
    }
    assert.throws(
      () =>
        copyVisualFrames(
          root,
          records().map((r, i) =>
            i === 0 ? { ...r, captures: ["../external.png"] } : r,
          ),
          "task",
          3,
        ),
      /вне каталога|выходит|безопасным относительным/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("rejects hardlinks and oversized dimensions", () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-visual-hardlink-"));
  const outside = mkdtempSync(resolve(tmpdir(), "native-visual-hardlink-out-"));
  try {
    for (const [i] of labels.entries())
      writeFileSync(resolve(root, `frame-${i}.png`), png);
    writeFileSync(resolve(outside, "external.png"), png);
    rmSync(resolve(root, "frame-0.png"));
    let hardlinkAvailable = true;
    try {
      linkSync(resolve(outside, "external.png"), resolve(root, "frame-0.png"));
    } catch (error: any) {
      if (error?.code !== "EPERM") throw error;
      hardlinkAvailable = false;
    }
    if (hardlinkAvailable)
      assert.throws(
        () => copyVisualFrames(root, records(), "task", 3),
        /ссылок/,
      );
    rmSync(resolve(root, "frame-0.png"), { force: true });
    const huge = Buffer.from(png);
    huge.writeUInt32BE(4097, 16);
    writeFileSync(resolve(root, "frame-0.png"), huge);
    assert.throws(
      () => copyVisualFrames(root, records(), "task", 3),
      /Размеры кадра/,
    );
    writeFileSync(resolve(root, "frame-0.png"), png.subarray(0, 20));
    assert.throws(
      () => copyVisualFrames(root, records(), "task", 3),
      /PNG или JPEG/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("accepts bounded JPEG dimensions but rejects a missing end marker", () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-visual-jpeg-"));
  try {
    for (const [i] of labels.entries())
      writeFileSync(resolve(root, `frame-${i}.png`), png);
    const jpeg = Buffer.from(
      "ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9",
      "hex",
    );
    writeFileSync(resolve(root, "frame-0.png"), jpeg);
    const frames = copyVisualFrames(root, records(), "task", 3);
    assert.equal(frames[0]!.path.endsWith(".jpg"), true);
    assert.equal(readFileSync(frames[0]!.path).equals(jpeg), true);
    rmSync(resolve(root, "frame-0.png"));
    writeFileSync(
      resolve(root, "frame-0.png"),
      jpeg.subarray(0, jpeg.length - 2),
    );
    assert.throws(
      () => copyVisualFrames(root, records(), "task", 3),
      /PNG или JPEG/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

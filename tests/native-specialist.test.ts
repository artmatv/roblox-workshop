import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { NativeSpecialist } from "../server/native-specialist.js";

class FakeCodex extends EventEmitter {
  calls: Array<[string, any]> = [];
  closed = false;
  constructor(
    private answer: any,
    private beforeTurn?: () => void,
    private quietTurn = false,
  ) {
    super();
  }
  async start() {}
  async isolatedConfig() {
    return {
      web_search: "live",
      mcp_servers: { parent: { enabled: true } },
      features: { shell_tool: true, apps: true, collab: true },
      agents: { enabled: true },
    };
  }
  async models() {
    return { data: ["gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol"] };
  }
  async request(method: string, params: any) {
    this.calls.push([method, params]);
    if (method === "thread/start") {
      this.thread = params;
      return { thread: { id: "th-1" } };
    }
    if (method === "turn/start") {
      this.beforeTurn?.();
      if (!this.quietTurn)
        setImmediate(() => {
          this.emit("notification", {
            method: "item/completed",
            params: {
              threadId: "th-1",
              turnId: "tu-1",
              item: { type: "agentMessage", text: JSON.stringify(this.answer) },
            },
          });
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId: "th-1",
              turnId: "tu-1",
              turn: { id: "tu-1", status: "completed" },
            },
          });
        });
      return { turn: { id: "tu-1" } };
    }
    throw new Error(`Unexpected request ${method}`);
  }
  thread: any;
  close() {
    this.closed = true;
  }
}
function fixture(answer: any, beforeTurn?: () => void, quietTurn = false) {
  const workspace = mkdtempSync(resolve(tmpdir(), "native-specialist-"));
  let fake!: FakeCodex;
  const records: any[] = [];
  const specialist = new NativeSpecialist(
    workspace,
    () => {},
    (x) => records.push(x),
    () => (fake = new FakeCodex(answer, beforeTurn, quietTurn)) as any,
  );
  return {
    workspace,
    specialist,
    records,
    get fake() {
      return fake;
    },
    cleanup: () => {
      specialist.close();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}
const instruction = "Implement the requested file change.";

test("uses fixed role model, medium effort, and disables every inherited capability", async () => {
  const f = fixture({ summary: "done", files: [] });
  try {
    await f.specialist.run({ role: "reviewer", instruction, files: [] });
    const thread = f.fake.calls.find((x) => x[0] === "thread/start")![1];
    const turn = f.fake.calls.find((x) => x[0] === "turn/start")![1];
    assert.equal(thread.model, "gpt-6.1-sol");
    assert.equal(thread.approvalPolicy, "never");
    assert.equal(thread.sandbox, "read-only");
    assert.equal(thread.config.web_search, "disabled");
    assert.deepEqual(thread.config.mcp_servers.parent, { enabled: false });
    assert.deepEqual(thread.config.features, {
      shell_tool: false,
      apps: false,
      collab: false,
      plugins: false,
      memories: false,
    });
    assert.deepEqual(thread.config.agents, { enabled: false });
    assert.equal(thread.config.model_reasoning_effort, "medium");
    assert.equal(turn.model, "gpt-6.1-sol");
    assert.equal(turn.effort, "medium");
  } finally {
    f.cleanup();
  }
});

test("reviewer can read project markdown and json without proposing writes", async () => {
  const f = fixture({ summary: "accepted", files: [] });
  try {
    writeFileSync(resolve(f.workspace, "review.md"), "Review context");
    writeFileSync(resolve(f.workspace, "data.json"), '{"ok":true}');
    const result = await f.specialist.run({
      role: "reviewer",
      instruction,
      files: ["review.md", "data.json"],
    });
    const turn = f.fake.calls.find((x) => x[0] === "turn/start")![1];
    const input = JSON.parse(turn.input[0].text);
    assert.equal(input.files["review.md"], "Review context");
    assert.equal(input.files["data.json"], '{"ok":true}');
    assert.deepEqual(JSON.parse(result.content[0]!.text).files, []);
  } finally {
    f.cleanup();
  }
});

test("coder receives the parent assignment and exact current source strings", async () => {
  const source = "return { ready = true }";
  const f = fixture({
    summary: "Implemented the requested server source",
    files: [{ path: "src/Loop.server.luau", content: source }],
  });
  try {
    mkdirSync(resolve(f.workspace, "src"), { recursive: true });
    writeFileSync(resolve(f.workspace, "src/Loop.server.luau"), source);
    writeFileSync(resolve(f.workspace, "SPEC.md"), "Reference only");
    writeFileSync(resolve(f.workspace, "VISUAL_BRIEF.md"), "Reference visual context");
    await f.specialist.run({
      role: "coder",
      instruction: "Replace the requested server script with the implementation.",
      files: ["src/Loop.server.luau", "src/New.server.luau"],
    });
    const thread = f.fake.calls.find((x) => x[0] === "thread/start")![1];
    assert.equal(thread.sandbox, "read-only");
    const turn = f.fake.calls.find((x) => x[0] === "turn/start")![1];
    assert.equal(
      turn.input[0].text,
      "Активное задание из проверенного вызова ask_specialist:\nReplace the requested server script with the implementation.",
    );
    assert.equal(turn.input.length, 2);
    const dataText = turn.input[1].text;
    assert.equal(dataText.includes("Replace the requested server script"), false);
    const data = JSON.parse(dataText.replace("Данные текущих и справочных файлов (JSON):\n", ""));
    assert.deepEqual(data.allowedFiles, ["src/Loop.server.luau", "src/New.server.luau"]);
    assert.equal(data.currentFiles["src/Loop.server.luau"], source);
    assert.equal(data.currentFiles["src/New.server.luau"], null);
    assert.equal(data.referenceFiles["SPEC.md"], "Reference only");
    assert.equal(data.referenceFiles["VISUAL_BRIEF.md"], "Reference visual context");
    assert.equal(data.allowedFiles.includes("SPEC.md"), false);
    assert.match(thread.developerInstructions, /исходный код в поле content каждого элемента files JSON/);
    assert.match(thread.developerInstructions, /read-only sandbox запрещает только прямую запись в локальную файловую систему/);
    assert.match(thread.developerInstructions, /не запрещает генерировать исходники или вернуть их текстом/);
    assert.equal(readFileSync(resolve(f.workspace, "src/Loop.server.luau"), "utf8"), source);
  } finally {
    f.cleanup();
  }
});

test("trusted visual review sends exact local images, uses a structured verdict, and keeps reviewer tools disabled", async () => {
  const f = fixture({
    summary: "Visual review completed",
    files: [],
    visualReview: {
      verdict: "needs_changes",
      summary: "Arrow points sideways",
      findings: [
        {
          captureId: "hud-desktop",
          location: "top center",
          issue: "Arrow points left",
          expected: "Arrow points toward the next waypoint",
        },
      ],
    },
  });
  try {
    writeFileSync(
      resolve(f.workspace, "SPEC.md"),
      "Project visual requirements",
    );
    writeFileSync(
      resolve(f.workspace, "VISUAL_BRIEF.md"),
      "Owner visual preferences",
    );
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(resolve(f.workspace, "frame.png"), image);
    // Reviewer copies live in a per-review directory inside the workspace.
    const reviewDir = resolve(f.workspace, ".visual-review-" + "a".repeat(24));
    mkdirSync(reviewDir, { recursive: true });
    const path = resolve(reviewDir, "01.png");
    writeFileSync(path, image);
    const sha256 = createHash("sha256").update(image).digest("hex");
    const result = await f.specialist.run(
      { role: "reviewer", instruction, files: [] },
      {
        taskId: "task-1",
        attempt: 2,
        taskInstructions: "Inspect the route",
        specification: "Arrow points forward",
        traceRoot: f.workspace,
        frames: [
          {
            captureId: "hud-desktop",
            captureRecordId: "000000000000000000000001",
            label: "hud-desktop",
            source: "frame.png",
            path,
            sha256,
          },
        ],
        styleReferences: ["D:/style/reference.png"],
      },
    );
    const thread = f.fake.calls.find((x) => x[0] === "thread/start")![1];
    const turn = f.fake.calls.find((x) => x[0] === "turn/start")![1];
    assert.equal(thread.config.features.shell_tool, false);
    assert.equal(thread.config.features.image_generation, false);
    assert.deepEqual(turn.input.slice(1), [
      { type: "localImage", path: "D:/style/reference.png" },
      { type: "localImage", path },
    ]);
    const trustedInput = JSON.parse(turn.input[0]!.text);
    assert.ok(trustedInput.instruction.includes("first 1 attached image(s) are the approved UI style reference"));
    assert.match(trustedInput.instruction, /hud-desktop/);
    assert.equal(trustedInput.files["SPEC.md"], "Project visual requirements");
    assert.equal(
      trustedInput.files["VISUAL_BRIEF.md"],
      "Owner visual preferences",
    );
    assert.equal(
      JSON.parse(result.content[0]!.text).visualReview.verdict,
      "needs_changes",
    );
    assert.deepEqual(JSON.parse(result.content[0]!.text).files, []);
  } finally {
    f.cleanup();
  }
});

test("trusted visual review rejects unknown capture references and public image fields", async () => {
  const f = fixture({
    summary: "review",
    files: [],
    visualReview: {
      verdict: "needs_changes",
      summary: "bad",
      findings: [
        { captureId: "outside", location: "x", issue: "bad", expected: "good" },
      ],
    },
  });
  try {
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(resolve(f.workspace, "frame.png"), image);
    // Reviewer copies live in a per-review directory inside the workspace.
    const reviewDir = resolve(f.workspace, ".visual-review-" + "a".repeat(24));
    mkdirSync(reviewDir, { recursive: true });
    const path = resolve(reviewDir, "01.png");
    writeFileSync(path, image);
    const sha256 = createHash("sha256").update(image).digest("hex");
    await assert.rejects(
      f.specialist.run(
        { role: "reviewer", instruction, files: [] },
        {
          taskId: "t",
          attempt: 1,
          taskInstructions: "x",
          specification: "y",
          traceRoot: f.workspace,
          frames: [
            {
              captureId: "known",
              captureRecordId: "000000000000000000000001",
              label: "known",
              source: "frame.png",
              path,
              sha256,
            },
          ],
        },
      ),
      /unknown captureId/,
    );
    await assert.rejects(
      f.specialist.run({
        role: "reviewer",
        instruction,
        files: [],
        images: [path],
      }),
      /Unrecognized key/,
    );
  } finally {
    f.cleanup();
  }
});

test("trusted visual review deadline closes a nonresponsive reviewer", async () => {
  const f = fixture({ summary: "never arrives", files: [] }, undefined, true);
  try {
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(resolve(f.workspace, "frame.png"), image);
    // Reviewer copies live in a per-review directory inside the workspace.
    const reviewDir = resolve(f.workspace, ".visual-review-" + "a".repeat(24));
    mkdirSync(reviewDir, { recursive: true });
    const path = resolve(reviewDir, "01.png");
    writeFileSync(path, image);
    await assert.rejects(
      f.specialist.run(
        { role: "reviewer", instruction, files: [] },
        {
          taskId: "task",
          attempt: 1,
          taskInstructions: "x",
          specification: "y",
          traceRoot: f.workspace,
          timeoutMs: 25,
          frames: [
            {
              captureId: "world-desktop",
              captureRecordId: "000000000000000000000001",
              label: "world-desktop",
              source: "frame.png",
              path,
              sha256: createHash("sha256").update(image).digest("hex"),
            },
          ],
        },
      ),
      /timed out/i,
    );
    assert.equal(f.fake.closed, true);
  } finally {
    f.cleanup();
  }
});
test("architect cannot write even when the model proposes files", async () => {
  const f = fixture({
    summary: "design",
    files: [{ path: "src/a.lua", content: "bad" }],
  });
  try {
    await assert.rejects(
      f.specialist.run({ role: "architect", instruction, files: [] }),
      /returned files/,
    );
    assert.equal(readFileSync(resolve(f.workspace, "src/a.lua"), "utf8"), "");
  } catch (e: any) {
    if (!/ENOENT/.test(e?.message || "")) throw e;
  } finally {
    f.cleanup();
  }
});

test("rejects traversal and symlinked directories", async () => {
  const f = fixture({ summary: "x", files: [] });
  try {
    await assert.rejects(
      f.specialist.run({
        role: "coder",
        instruction,
        files: ["../escape.lua"],
      }),
      /Unsafe path/,
    );
    const outside = mkdtempSync(resolve(tmpdir(), "native-specialist-out-"));
    try {
      try {
        symlinkSync(outside, resolve(f.workspace, "linked"), "junction");
      } catch (error: any) {
        if (error?.code === "EPERM") return;
        throw error;
      }
      await assert.rejects(
        f.specialist.run({
          role: "coder",
          instruction,
          files: ["linked/x.lua"],
        }),
        /Link path/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    f.cleanup();
  }
});

test("hardlinked writable target is rejected and preserves external file", async () => {
  const f = fixture({ summary: "done", files: [] });
  const outside = mkdtempSync(resolve(tmpdir(), "native-specialist-hardlink-"));
  const external = resolve(outside, "shared.lua");
  try {
    writeFileSync(external, "keep me");
    try {
      linkSync(external, resolve(f.workspace, "main.lua"));
    } catch (error: any) {
      if (error?.code === "EPERM") return;
      throw error;
    }
    await assert.rejects(
      f.specialist.run({ role: "coder", instruction, files: ["main.lua"] }),
      /Hardlinked writable target/,
    );
    assert.equal(readFileSync(external, "utf8"), "keep me");
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});
test("does not overwrite a file changed during the run", async () => {
  const target = mkdtempSync(resolve(tmpdir(), "native-specialist-stale-"));
  const path = resolve(target, "main.lua");
  writeFileSync(path, "original");
  const f = fixture(
    { summary: "done", files: [{ path: "main.lua", content: "new" }] },
    () => writeFileSync(resolve(f.workspace, "main.lua"), "outside change"),
  );
  try {
    writeFileSync(resolve(f.workspace, "main.lua"), "original");
    await assert.rejects(
      f.specialist.run({ role: "coder", instruction, files: ["main.lua"] }),
      /changed during/,
    );
    assert.equal(
      readFileSync(resolve(f.workspace, "main.lua"), "utf8"),
      "outside change",
    );
  } finally {
    f.cleanup();
    rmSync(target, { recursive: true, force: true });
  }
});

test("paused lease prevents writes and closes the child", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "native-specialist-pause-"));
  let paused = false,
    fake!: FakeCodex;
  const specialist = new NativeSpecialist(
    workspace,
    () => {
      if (paused) throw new Error("lease paused");
    },
    () => {},
    () => {
      fake = new FakeCodex(
        { summary: "done", files: [{ path: "main.lua", content: "new" }] },
        () => {
          paused = true;
        },
      );
      return fake as any;
    },
  );
  try {
    await assert.rejects(
      specialist.run({ role: "coder", instruction, files: ["main.lua"] }),
      /lease paused/,
    );
    assert.equal(fake.closed, true);
    assert.throws(() => readFileSync(resolve(workspace, "main.lua")));
  } finally {
    specialist.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

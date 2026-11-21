import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store, hash } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import { ExternalReviewProvider } from "../server/external-reviewer.js";
async function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "native-review-")),
    store = new Store(root),
    engine = new Engine(store, new Codex()),
    p = engine.createProject({
      name: "Scoped review",
      genre: "Simulator",
      goal: "Review selected source",
    });
  p.studioId = "bound-studio";
  engine.setExecution(p, "running");
  const task = engine.task(p, {
    title: "Owner",
    role: "designer",
    kind: "studio-development",
    instructions: "Review files",
    status: "running",
  });
  const work = resolve(root, "work");
  mkdirSync(work);
  store.put("nativeSession", {
    id: p.id,
    taskId: task.id,
    status: "working",
    workspace: work,
  });
  store.put("nativeCapability", {
    id: task.id,
    hash: hash("scoped-token"),
    studioId: p.studioId,
    expiresAt: Date.now() + 60000,
  });
  const options = { port: 0, appRoot: resolve(import.meta.dirname, "..") },
    server = createApp(store, engine, "dashboard-token", options).listen(
      0,
      "127.0.0.1",
    );
  await new Promise<void>((r) => server.once("listening", r));
  options.port = (server.address() as any).port;
  const call = async (
    files: string[] = [],
    token = "scoped-token",
    instruction = "Review these materials",
  ) => {
    const r = await fetch(
      `http://127.0.0.1:${options.port}/native/external-review`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: task.id,
          instruction,
          files,
        }),
      },
    );
    return { status: r.status, body: await r.json() };
  };
  return {
    root,
    store,
    engine,
    p,
    task,
    call,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("external review callback requires the scoped task token, running lease and workspace files; no key causes no provider operation", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call([], "dashboard-token")).status, 403);
    assert.equal((await f.call(["../outside.md"])).status, 409);
    f.engine.setExecution(f.p, "paused");
    assert.equal((await f.call()).status, 409);
    f.engine.setExecution(f.p, "running");
    const disabled = await f.call();
    assert.equal(disabled.status, 409);
    assert.match(disabled.body.error, /Включите независимую/);
    assert.equal(f.store.all("providerOperation").length, 0);
    assert.equal(f.store.all("externalReview").length, 0);
  } finally {
    await f.close();
  }
});
test("a repeated owner review returns the existing result without another provider call", async () => {
  const original = ExternalReviewProvider.prototype.review;
  let calls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    calls++;
    return {
      id: "review",
      model: "chosen",
      summary: "Findings",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    } as any;
  };
  const f = await fixture();
  try {
    assert.equal((await f.call()).status, 200);
    assert.equal((await f.call()).status, 200);
    assert.equal(calls, 1);
  } finally {
    ExternalReviewProvider.prototype.review = original;
    await f.close();
  }
});
test("a failed model cannot be retried with different review input in the same attempt, while another model remains available", async () => {
  const original = ExternalReviewProvider.prototype.review;
  let calls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    calls++;
    if (calls === 1) throw new Error("HTTP 503 Service Unavailable");
    return {
      id: "alternate-review",
      model: "alternate-model",
      summary: "Reviewed by alternate model",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    } as any;
  };
  const f = await fixture();
  try {
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    f.store.put("secret", {
      id: "external-reviewer",
      encrypted: "mocked-provider-key",
    });
    const failed = await f.call([], "scoped-token", "Review first input");
    assert.equal(failed.status, 409);
    assert.match(failed.body.error, /HTTP 503/);
    assert.equal(calls, 1);
    const savedFailure = f.store
      .all<any>("nativeExternalReview")
      .find((review) => review.status === "failed");
    assert.equal(savedFailure?.model, "selected-model");

    const retrySameModel = await f.call([], "scoped-token", "Review changed input");
    assert.equal(retrySameModel.status, 409);
    assert.match(retrySameModel.body.error, /автоматический повтор отключён/);
    assert.equal(calls, 1);

    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "alternate-model",
    });
    const alternate = await f.call([], "scoped-token", "Review alternate model");
    assert.equal(alternate.status, 200);
    assert.equal(alternate.body.model, "alternate-model");
    assert.equal(calls, 2);
  } finally {
    ExternalReviewProvider.prototype.review = original;
    await f.close();
  }
});
test("legacy unknown failures without a model conservatively block same-attempt paid reviews", async () => {
  const original = ExternalReviewProvider.prototype.review;
  let calls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    calls++;
    return { id: "unexpected", model: "alternate-model" } as any;
  };
  const f = await fixture();
  try {
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    f.store.put("secret", {
      id: "external-reviewer",
      encrypted: "mocked-provider-key",
    });
    f.store.put("nativeExternalReview", {
      id: "legacy-prompt-file-hash",
      taskId: f.task.id,
      attempt: f.task.attempt,
      status: "failed",
      error: "Результат запроса неизвестен после HTTP 503",
    });

    const sameModel = await f.call([], "scoped-token", "Changed payload, same selected model");
    assert.equal(sameModel.status, 409);
    assert.equal(calls, 0);

    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "alternate-model",
    });
    const unknownModel = await f.call([], "scoped-token", "Changed payload, alternate model");
    assert.equal(unknownModel.status, 409);
    assert.equal(calls, 0);
  } finally {
    ExternalReviewProvider.prototype.review = original;
    await f.close();
  }
});
test("a failed review blocks new prompts despite an earlier success but preserves its exact cached success", async () => {
  const original = ExternalReviewProvider.prototype.review;
  let calls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    calls++;
    if (calls === 2) throw new Error("HTTP 503 Service Unavailable");
    return {
      id: "selected-review",
      model: "selected-model",
      summary: "Cached success",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    } as any;
  };
  const f = await fixture();
  try {
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    f.store.put("secret", {
      id: "external-reviewer",
      encrypted: "mocked-provider-key",
    });
    const first = await f.call([], "scoped-token", "Successful input");
    assert.equal(first.status, 200);
    const failed = await f.call([], "scoped-token", "Failing input");
    assert.equal(failed.status, 409);
    assert.equal(calls, 2);

    const blockedNewPrompt = await f.call([], "scoped-token", "Another changed input");
    assert.equal(blockedNewPrompt.status, 409);
    assert.equal(calls, 2);
    const cachedSuccess = await f.call([], "scoped-token", "Successful input");
    assert.equal(cachedSuccess.status, 200);
    assert.equal(cachedSuccess.body.summary, "Cached success");
    assert.equal(calls, 2);
  } finally {
    ExternalReviewProvider.prototype.review = original;
    await f.close();
  }
});
test("pausing an owner aborts an in-flight independent review and cannot cache success", async () => {
  const original = ExternalReviewProvider.prototype.review;
  let began!: () => void;
  const started = new Promise<void>((r) => (began = r));
  ExternalReviewProvider.prototype.review = async (
    _id,
    _instruction,
    _files,
    signal,
  ) => {
    began();
    return await new Promise((_, reject) =>
      signal!.addEventListener(
        "abort",
        () => reject(new Error("Review cancelled by pause")),
        { once: true },
      ),
    );
  };
  const f = await fixture();
  try {
    const response = f.call();
    await started;
    f.engine.setExecution(f.p, "paused");
    assert.equal((await response).status, 409);
    assert.ok(
      f.store
        .all<any>("nativeExternalReview")
        .every((r) => r.status !== "completed"),
    );
  } finally {
    ExternalReviewProvider.prototype.review = original;
    await f.close();
  }
});

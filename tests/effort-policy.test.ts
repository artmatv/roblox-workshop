import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  planEffort,
  supportedEffort,
  ROLE_EFFORT,
} from "../shared/effort-policy.js";
import type { Role, Task } from "../shared/domain.js";
import { Engine } from "../server/engine.js";
import { Store } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { effortModels } from "./effort-fixture.js";

const task = (role: Role = "ui", extra: Partial<Task> = {}) =>
  ({ role, provider: "codex", ...extra }) as Task;
test("role defaults, routine and complex tasks follow the agreed effort table", () => {
  for (const [role, effort] of Object.entries(ROLE_EFFORT))
    assert.equal(planEffort(task(role as Role))?.effort, effort);
  assert.equal(planEffort(task("ui", { provider: "studio" })), null);
  assert.equal(
    planEffort(task("ui", { effortClass: "routine" }))?.effort,
    "low",
  );
  assert.equal(
    planEffort(task("assets", { effortClass: "complex" }))?.effort,
    "high",
  );
  assert.equal(
    planEffort(task("ui", { effortClass: "complex" }))?.effort,
    "xhigh",
  );
});
test("only semantic rejection counts raise effort, automatically capped at xhigh", () => {
  assert.equal(planEffort(task("assets"), 1)?.effort, "high");
  assert.equal(planEffort(task("assets"), 2)?.effort, "xhigh");
  assert.equal(planEffort(task("ui"), 99)?.effort, "xhigh");
  for (const error of [
    "Selected model is at capacity",
    "quota exceeded",
    "Превышено время задачи",
    "Результат не принят: Invalid JSON",
  ])
    assert.equal(planEffort(task("ui", { error, attempt: 3 }))?.effort, "high");
  assert.equal(
    planEffort(
      task("ui", {
        effortClass: "routine",
        effortOverride: "low",
        effortOverrideReason: "One text edit",
      }),
      0,
      true,
    )?.effort,
    "high",
  );
});
test("max is explicit diagnostic-only after a recorded xhigh attempt", () => {
  const t = task("gameplay", {
    effortOverride: "max",
    effortOverrideReason: "Data recovery still fails",
    effortClass: "diagnostic",
  });
  assert.throws(() => planEffort(t), /предыдущего запуска xhigh/);
  t.effortHistory = [{ effort: "xhigh" }] as Task["effortHistory"];
  assert.equal(planEffort(t)?.effort, "max");
  assert.equal(planEffort(t, 0, true)?.effort, "xhigh");
  t.effortClass = "standard";
  assert.throws(() => planEffort(t), /диагностической/);
  assert.throws(
    () => planEffort(task("ui", { effortOverride: "low" })),
    /небольшой/,
  );
});
test("model capabilities constrain effort without changing model or silently enabling max", () => {
  const catalog = [
    {
      ...effortModels[0],
      supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
    },
  ];
  const effective = supportedEffort(
    { effort: "high", reason: "role" },
    catalog,
    "test-model",
  );
  assert.equal(effective.effort, "medium");
  assert.match(effective.reason, /вместо high/);
  assert.throws(
    () => supportedEffort({ effort: "max", reason: "manual" }, catalog, null),
    /недоступен/,
  );
  assert.throws(
    () =>
      supportedEffort(
        { effort: "high", reason: "role" },
        catalog,
        "missing-model",
      ),
    /каталог/,
  );
});
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "effort-policy-"));
  const store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  const p = engine.createProject({
    name: "Effort fixture",
    genre: "Simulator",
    goal: "Isolated test",
  });
  p.settings.agentPolicy = "legacy";
  engine.models = effortModels;
  engine.account = { account: { type: "chatgpt", id: "fixture" } };
  engine.setExecution(p, "running");
  codex.ready = true;
  codex.isolatedConfig = async () => ({
    web_search: "disabled",
    mcp_servers: {},
    features: { shell_tool: false, apps: false, collab: false },
  });
  p.studioId = "effort-studio";
  store.put("studio", {
    id: p.studioId,
    capabilities: ["apply", "test", "capture", "snapshot", "import"],
  });
  engine.save(p);
  const calls: Array<{ method: string; params: any }> = [];
  codex.request = async (method, params) => {
    calls.push({ method, params });
    return method.startsWith("thread/")
      ? {
          thread: { id: "saved-thread" },
          model: "test-model",
          reasoningEffort: "low",
        }
      : { turn: { id: "effort-turn" } };
  };
  return {
    root,
    store,
    engine,
    codex,
    p,
    calls,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("new and resumed turns explicitly override global low and persist model/effort evidence", async () => {
  const f = fixture();
  try {
    for (const threadId of [null, "saved-thread"]) {
      const t = f.engine.task(f.p, {
        title: "UI",
        role: "ui",
        kind: "ui",
        instructions: "Build controls",
        threadId,
      });
      await f.engine.runAgent(f.p, t);
      const call = f.calls.filter((c) => c.method === "turn/start").at(-1)!;
      assert.ok(
        call,
        f.store.get<Task>("task", t.id)?.error || "No turn/start request",
      );
      assert.equal(call.params.effort, "high");
      assert.equal(call.params.model, "test-model");
      const saved = f.store.get<Task>("task", t.id)!;
      assert.equal(saved.effortRun?.effort, "high");
      assert.equal(saved.effortHistory?.length, 1);
      assert.equal(
        f.store.get<any>("agentContext", t.id).effortPolicy.effort,
        "high",
      );
    }
    assert.ok(f.calls.some((c) => c.method === "thread/resume"));
  } finally {
    f.close();
  }
});
test("existing rejected tasks escalate on resume, capacity/schema retries do not", async () => {
  const f = fixture();
  try {
    const t = f.engine.task(f.p, {
      title: "UI",
      role: "ui",
      kind: "ui",
      instructions: "Build controls",
      threadId: "saved-thread",
      error: "Selected model is at capacity",
    });
    f.store.put("resultReview", {
      id: "old-review",
      taskId: t.id,
      status: "rejected",
    });
    await f.engine.runAgent(f.p, t);
    assert.equal(
      f.calls.filter((c) => c.method === "turn/start").at(-1)!.params.effort,
      "xhigh",
    );
    for (const error of [
      "Selected model is at capacity",
      "Результат не принят: Invalid JSON",
    ]) {
      const other = f.engine.task(f.p, {
        title: "UI",
        role: "ui",
        kind: "ui",
        instructions: "Build controls",
        error,
        attempt: 2,
      });
      await f.engine.runAgent(f.p, other);
      assert.equal(
        f.calls.filter((c) => c.method === "turn/start").at(-1)!.params.effort,
        "high",
      );
    }
  } finally {
    f.close();
  }
});
test("manual overrides are validated and completed or running tasks remain unchanged", () => {
  const f = fixture();
  try {
    const t = f.engine.task(f.p, {
      title: "UI",
      role: "ui",
      kind: "ui",
      instructions: "test",
    });
    const body = {
      complexity: "routine",
      override: "low",
      reason: "Only replace one label",
    };
    assert.equal(
      f.engine.configureTaskEffort(t.id, body).effortOverride,
      "low",
    );
    assert.throws(
      () => f.engine.configureTaskEffort(t.id, { ...body, reason: "" }),
      /причину/,
    );
    assert.throws(
      () => f.engine.configureTaskEffort(t.id, { ...body, override: "max" }),
      /диагностической/,
    );
    for (const status of ["running", "succeeded"] as const) {
      f.store.put("task", { ...t, status });
      assert.throws(
        () => f.engine.configureTaskEffort(t.id, body),
        /ожидающей/,
      );
    }
  } finally {
    f.close();
  }
});

test("default model follows effective Codex configuration, and a project override changes resumed turns", async () => {
  const f = fixture();
  try {
    f.engine.models = [
      ...effortModels,
      {
        ...effortModels[0],
        id: "configured-model",
        model: "configured-model",
        isDefault: false,
      },
    ];
    const request = f.codex.request.bind(f.codex);
    f.codex.request = async (method, params) =>
      method === "config/read"
        ? {
            config: {
              model: "configured-model",
              model_reasoning_effort: "low",
            },
          }
        : request(method, params);
    const t = f.engine.task(f.p, {
      title: "UI",
      role: "ui",
      kind: "ui",
      instructions: "Test",
      threadId: "saved-thread",
    });
    await f.engine.runAgent(f.p, t);
    assert.equal(
      f.calls.filter((c) => c.method === "turn/start").at(-1)!.params.model,
      "configured-model",
    );
    assert.equal(t.effortRun?.effort, "high");
    f.p.settings.model = "test-model";
    const next = f.engine.task(f.p, {
      title: "UI",
      role: "ui",
      kind: "ui",
      instructions: "Test",
      threadId: "saved-thread",
    });
    await f.engine.runAgent(f.p, next);
    assert.equal(
      f.calls.filter((c) => c.method === "turn/start").at(-1)!.params.model,
      "test-model",
    );
  } finally {
    f.close();
  }
});

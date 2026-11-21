import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store, hash } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import { manifestSchema, type Task } from "../shared/domain.js";
import { productionRepairSources } from "../shared/production-recovery.js";
import { effortModels } from "./effort-fixture.js";
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "production-recovery-"));
  const store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  const p = engine.createProject({
    name: "Recovery fixture",
    genre: "Simulator",
    goal: "Test recovery",
  });
  p.settings.agentPolicy = "legacy";
  p.specification = "Approved fixture specification";
  p.budget.approved = true;
  p.stage = "production";
  p.execution = "error";
  for (const name of ["specification", "budget"])
    p.approvals[name] = {
      revision: p.revision,
      hash: engine.approvalHash(p, name),
      at: new Date().toISOString(),
    };
  p.studioId = "recovery-studio";
  store.put("studio", {
    id: p.studioId,
    capabilities: ["apply", "test", "capture", "snapshot", "import"],
  });
  engine.save(p);
  const sources = (["gameplay", "ui", "assets"] as const).map((role) => {
    const t = engine.task(p, {
      title: role,
      role,
      kind: role,
      scope:
        role === "ui"
          ? ["StarterGui", "StarterPlayer"]
          : role === "assets"
            ? ["Workspace"]
            : ["ServerScriptService", "ReplicatedStorage"],
      instructions: "Original task",
      status: "failed",
      attempt: 3,
      maxAttempts: 3,
      error: "Результат не принят: исправить собственный дефект",
      threadId: "saved-" + role,
      reviewId: "review-" + role,
    });
    t.requirementsHash = engine.taskRequirementsHash(p, t);
    store.put("task", t);
    const candidate = manifestSchema.parse({
      files: [{ path: role + ".luau", content: "saved candidate " + role }],
      summary: "Saved artifact",
    });
    store.put("agentCandidate", {
      id: t.reviewId!,
      raw: candidate,
      prepared: candidate,
    });
    store.put("resultReview", {
      id: t.reviewId!,
      taskId: t.id,
      projectId: p.id,
      status: "rejected",
      summary: "Fix local defect",
      issues: ["Specific defect"],
      createdAt: new Date().toISOString(),
      reviewedAt: new Date().toISOString(),
    });
    return t;
  });
  const build = engine.task(p, {
    title: "Build",
    role: "orchestrator",
    kind: "build",
    provider: "studio",
    dependencies: sources.map((t) => t.id),
    instructions: "Build",
    status: "dependencies",
  });
  const qa = engine.task(p, {
    title: "QA",
    role: "qa",
    kind: "qa",
    dependencies: [build.id],
    instructions: "Check",
    status: "dependencies",
  });
  engine.models = effortModels;
  engine.account = { account: { type: "chatgpt", id: "fixture" } };
  codex.isolatedConfig = async () => ({
    web_search: "disabled",
    mcp_servers: {},
    features: { shell_tool: false, apps: false, collab: false },
  });
  const calls: Array<{ method: string; params: any }> = [];
  codex.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: { model: "test-model" } };
    if (method.startsWith("thread/"))
      return { thread: { id: (params as any).threadId || "new-thread" } };
    return { turn: { id: "repair-turn" } };
  };
  return {
    root,
    store,
    codex,
    engine,
    p,
    sources,
    build,
    qa,
    calls,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("bounded recovery preserves history and accepted work, rewires the existing build and orders shared-contract work", () => {
  const f = fixture();
  try {
    const approved = structuredClone(f.p.approvals);
    const { tasks } = f.engine.repairProduction(f.p.id);
    assert.equal(tasks.length, 3);
    const gameplay = tasks.find((t) => t.kind === "gameplay")!;
    assert.equal(f.engine.project(f.p.id).execution, "running");
    assert.deepEqual(f.engine.project(f.p.id).approvals, approved);
    for (const t of tasks) {
      const original = f.sources.find((s) => s.id === t.repairOfTaskId)!;
      assert.equal(t.attempt, 0);
      assert.equal(t.maxAttempts, 3);
      assert.equal(t.threadId, original.threadId);
      assert.deepEqual(t.scope, original.scope);
      assert.equal(f.store.get<Task>("task", original.id)?.attempt, 3);
      assert.equal(
        f.store.get<Task>("task", original.id)?.supersededByTaskId,
        t.id,
      );
      assert.ok(f.store.get("agentCandidate", original.reviewId!));
      if (t.kind !== "gameplay")
        assert.ok(t.dependencies.includes(gameplay.id));
    }
    assert.deepEqual(
      new Set(f.store.get<Task>("task", f.build.id)?.dependencies),
      new Set(tasks.map((t) => t.id)),
    );
    assert.deepEqual(f.store.get<Task>("task", f.qa.id)?.dependencies, [
      f.build.id,
    ]);
    const count = f.engine.tasks(f.p.id).length;
    assert.throws(() => f.engine.repairProduction(f.p.id), /Нет исчерпавших/);
    assert.equal(f.engine.tasks(f.p.id).length, count);
    for (const source of f.sources)
      assert.throws(() => f.engine.retryTask(source.id), /не ожидает/);
  } finally {
    f.close();
  }
});
test("repair continuation receives its rejected artifact, findings and inherited effort", async () => {
  const f = fixture();
  try {
    const repair = f.engine
      .repairProduction(f.p.id)
      .tasks.find((t) => t.kind === "gameplay")!;
    assert.equal(f.engine.effortPlan(repair)?.effort, "xhigh");
    await f.engine.runAgent(f.engine.project(f.p.id), repair);
    const turn = f.calls.find((c) => c.method === "turn/start")!.params;
    const prompt = JSON.parse(turn.input[0].text);
    assert.equal(turn.effort, "xhigh");
    assert.match(prompt.previousFailure, /исправить собственный дефект/);
    assert.match(
      prompt.previousCandidate.files[0].content,
      /saved candidate gameplay/,
    );
    assert.equal(
      f.calls.find((c) => c.method === "thread/resume")!.params.threadId,
      "saved-gameplay",
    );
    assert.match(
      f.calls.find((c) => c.method === "thread/resume")!.params
        .developerInstructions,
      /Не реализуй чужие UI/,
    );
  } finally {
    f.close();
  }
});
test("missing artifacts, changed requirements and missing approvals cannot partially create repairs", () => {
  for (const change of ["artifact", "requirements", "approval"] as const) {
    const f = fixture();
    try {
      const before = f.engine.tasks(f.p.id).length;
      if (change === "artifact")
        f.store.delete("agentCandidate", f.sources[1].reviewId!);
      if (change === "requirements") {
        f.p.goal = "Changed goal";
        f.engine.save(f.p);
      }
      if (change === "approval") {
        f.p.approvals = {};
        f.engine.save(f.p);
      }
      assert.throws(() => f.engine.repairProduction(f.p.id));
      assert.equal(f.engine.tasks(f.p.id).length, before);
      assert.ok(
        f.sources.every(
          (t) => !f.store.get<Task>("task", t.id)?.supersededByTaskId,
        ),
      );
    } finally {
      f.close();
    }
  }
});
test("completed roles are preserved and superseded or historical failures are not repair candidates", () => {
  const f = fixture();
  try {
    f.store.put("task", { ...f.sources[2], status: "succeeded" });
    f.engine.task(f.p, {
      title: "Old specification",
      role: "designer",
      kind: "specification",
      instructions: "old",
      status: "failed",
      attempt: 1,
      maxAttempts: 1,
      error: "Результат не принят: old",
    });
    assert.equal(
      productionRepairSources(f.p, f.engine.tasks(f.p.id)).length,
      2,
    );
    const repairs = f.engine.repairProduction(f.p.id).tasks;
    assert.equal(repairs.length, 2);
    assert.ok(
      f.store
        .get<Task>("task", f.build.id)
        ?.dependencies.includes(f.sources[2].id),
    );
    f.engine.control(f.p.id, "resume");
    assert.ok(
      f.sources
        .slice(0, 2)
        .every((t) => f.store.get<Task>("task", t.id)?.status === "failed"),
    );
  } finally {
    f.close();
  }
});
test("HTTP repair requires personal access and returns only the bounded replacement tasks", async () => {
  const f = fixture(),
    port = 48338;
  const server = createApp(f.store, f.engine, "repair-token", {
    port,
    appRoot: resolve("."),
  }).listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const path = `http://127.0.0.1:${port}/api/projects/${f.p.id}/repair-production`;
    assert.equal((await fetch(path, { method: "POST" })).status, 401);
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: "Bearer repair-token",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).tasks.length, 3);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
  }
});

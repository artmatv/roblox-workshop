import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { manifestSchema, type Manifest, type Task } from "../shared/domain.js";
import {
  assembleIntegration,
  applyIntegrationPatch,
  type IntegrationBase,
} from "../server/integration.js";
import { Store, hash } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { effortModels } from "./effort-fixture.js";
const manifest = (input: Partial<Manifest> = {}) =>
  manifestSchema.parse({ summary: "Accepted component", ...input });
const node = (path: string, source = "return true") => ({
  path,
  className: "ModuleScript",
  properties: {},
  source,
});
const components = () => [
  {
    id: "gameplay",
    kind: "gameplay",
    result: manifest({
      instances: [node("ServerScriptService/Game")],
      files: [
        { path: "docs/page-materials.md", content: "Gameplay copy" },
        { path: "tests/core.luau", content: "Core tests" },
      ],
      checks: [
        {
          id: "unit-core",
          name: "Core",
          required: false,
          status: "not_run",
          evidence: null,
        },
      ],
      data: {
        integrationContract: { api: "Sync" },
        assets: [{ id: "asset-a" }],
        localization: {
          entries: [{ key: "hud.coins", source: "Coins: {count:int}" }],
        },
      },
    }),
  },
  {
    id: "ui",
    kind: "ui",
    result: manifest({
      instances: [node("StarterGui/Controller")],
      data: {
        integrationContract: { uses: "Sync" },
        localization: { entries: [{ key: "shop.title", source: "Shop" }] },
      },
    }),
  },
  {
    id: "assets",
    kind: "assets",
    result: manifest({
      instances: [
        { path: "Workspace/Park", className: "Model", properties: {} },
      ],
      files: [{ path: "docs/page-materials.md", content: "World copy" }],
      deletions: ["Workspace/OldPark"],
      data: { integrationContract: { world: "Park" } },
    }),
  },
];
const baseOf = (
  manifest: Manifest,
  conflicts: IntegrationBase["conflicts"] = [],
): IntegrationBase => ({
  id: "base",
  taskId: "integration",
  projectId: "project",
  revision: 0,
  hash: hash(manifest),
  manifest,
  dependencyHashes: [],
  conflicts,
});
const patchFor = (base: IntegrationBase, input: Partial<Manifest> = {}) =>
  manifest({
    ...input,
    data: {
      ...input.data,
      integrationPatch: { baseId: base.id, baseHash: base.hash },
    },
  });
test("documentation conflicts merge without an agent while code, tests, deletions and role contracts remain intact", () => {
  const input = components(),
    before = hash(input),
    merged = assembleIntegration(input);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.manifest.instances.length, 3);
  const doc = merged.manifest.files.find(
    (f) => f.path === "docs/page-materials.md",
  )!;
  assert.match(doc.content, /Gameplay copy/);
  assert.match(doc.content, /World copy/);
  assert.ok(merged.manifest.files.some((f) => f.path === "tests/core.luau"));
  assert.deepEqual(merged.manifest.deletions, ["Workspace/OldPark"]);
  assert.equal((merged.manifest.data.integrationContracts as any[]).length, 3);
  assert.equal((merged.manifest.data.localization as any).entries.length, 2);
  assert.equal(hash(input), before);
});
test("a three-node style patch materializes a full candidate and preserves untouched source and metadata", () => {
  const initial = assembleIntegration(components()).manifest,
    base = baseOf(initial);
  const patch = patchFor(base, {
    instances: [node("StarterGui/Controller", "return 'fixed'")],
    files: [{ path: "tests/regression.luau", content: "Regression test" }],
    data: {
      assets: [],
      localization: { entries: [{ key: "shop.title", source: "Cosmetics" }] },
    },
  });
  const result = applyIntegrationPatch(base, patch);
  assert.equal(result.instances.length, 3);
  assert.equal(
    result.instances.find((n) => n.path === "StarterGui/Controller")?.source,
    "return 'fixed'",
  );
  assert.equal(
    hash(result.instances.find((n) => n.path === "ServerScriptService/Game")),
    hash(initial.instances.find((n) => n.path === "ServerScriptService/Game")),
  );
  assert.ok(result.files.some((f) => f.path === "tests/core.luau"));
  assert.ok(result.files.some((f) => f.path === "tests/regression.luau"));
  assert.equal((result.data.assets as any[]).length, 1);
  assert.equal((result.data.integrationContracts as any[]).length, 3);
  assert.equal((result.data.localization as any).entries.length, 2);
  assert.equal(
    (result.data.localization as any).entries.find(
      (e: any) => e.key === "shop.title",
    ).source,
    "Cosmetics",
  );
  assert.equal(result.checks[0].status, "not_run");
  assert.equal(hash(base.manifest), base.hash);
});
test("runtime conflicts cannot be silently resolved, and a patch for a stale base cannot apply", () => {
  const input = components();
  input.push({
    id: "other",
    kind: "gameplay",
    result: manifest({
      instances: [node("ServerScriptService/Game", "return false")],
    }),
  });
  const merged = assembleIntegration(input),
    base = baseOf(merged.manifest, merged.conflicts);
  assert.equal(merged.conflicts.length, 1);
  assert.throws(
    () =>
      applyIntegrationPatch(
        base,
        patchFor(base, {
          files: [{ path: "docs/note.md", content: "Not a resolution" }],
        }),
      ),
    /Не разрешён конфликт/,
  );
  const patch = patchFor(base, {
    instances: [node("ServerScriptService/Game", "return 'resolved'")],
  });
  assert.equal(applyIntegrationPatch(base, patch).instances.length, 3);
  (patch.data.integrationPatch as any).baseHash = "stale";
  assert.throws(
    () => applyIntegrationPatch(base, patch),
    /другой или изменённой/,
  );
});
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "integration-patch-"));
  const store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  const p = engine.createProject({
    name: "Integration fixture",
    genre: "Simulator",
    goal: "Test patches",
  });
  p.stage = "production";
  p.execution = "running";
  p.studioId = "integration-studio";
  store.put("studio", {
    id: p.studioId,
    capabilities: ["apply", "test", "capture", "snapshot", "import"],
  });
  engine.save(p);
  const sources = components().map((c) =>
    engine.task(p, {
      ...c,
      title: c.kind,
      role: c.kind as Task["role"],
      instructions: "Component",
      status: "succeeded",
    }),
  );
  const task = engine.task(p, {
    title: "Integration",
    role: "orchestrator",
    kind: "integration",
    instructions: "Patch integration",
    scope: ["ServerScriptService", "StarterGui", "Workspace"],
    dependencies: sources.map((t) => t.id),
  });
  engine.models = effortModels;
  engine.account = { account: { type: "chatgpt" } };
  engine.lastPoll = Date.now();
  codex.ready = true;
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
      return { thread: { id: "integration-thread" } };
    return { turn: { id: "integration-turn" } };
  };
  return {
    store,
    codex,
    engine,
    p,
    sources,
    task,
    calls,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("worker gets one pinned full base plus compact dependencies and returns only a validated patch", async () => {
  const f = fixture();
  try {
    await f.engine.runAgent(f.p, f.task);
    assert.ok(
      f.calls.some((c) => c.method === "turn/start"),
      f.store.get<Task>("task", f.task.id)?.error || "Missing turn/start",
    );
    const request = f.calls.find((c) => c.method === "turn/start")!.params,
      prompt = JSON.parse(request.input[0].text);
    assert.equal(prompt.integrationBase.instances.length, 3);
    assert.equal(prompt.previousCandidate, null);
    assert.ok(
      prompt.dependencies.every((d: any) => d.resultHash && !d.instances),
    );
    const base = f.engine.integrationBase(f.p, f.task);
    const raw = patchFor(base, {
      instances: [node("StarterGui/Controller", "return 'patched'")],
    });
    assert.equal(f.engine.prepareResult(f.task, raw).instances.length, 3);
    assert.throws(() =>
      f.engine.prepareResult(
        f.task,
        manifest({ instances: [node("StarterGui/Controller")] }),
      ),
    );
    const dependency = f.sources[0];
    dependency.result!.summary = "Changed dependency";
    f.store.put("task", dependency);
    assert.throws(
      () => f.engine.prepareResult(f.task, raw),
      /Зависимости интеграции изменились/,
    );
  } finally {
    f.close();
  }
});
test("the reviewer sees the materialized candidate, never a partial patch or deferred merge script", async () => {
  const f = fixture();
  try {
    const base = f.engine.createIntegrationBase(f.p, f.task);
    f.task.attempt = 1;
    f.task.requirementsHash = f.engine.taskRequirementsHash(f.p, f.task);
    f.store.put("task", f.task);
    await f.engine.submitAgentResult(
      f.task,
      patchFor(base, {
        instances: [node("StarterGui/Controller", "return 'fixed'")],
      }),
    );
    const review = f.calls.find((c) => c.method === "turn/start")!.params;
    const candidate = JSON.parse(review.input[0].text).candidate;
    assert.equal(candidate.instances.length, 3);
    assert.ok(candidate.files.some((f: any) => f.path === "tests/core.luau"));
    assert.equal(candidate.data.integrationPatch, undefined);
    assert.equal(candidate.data.integrationApplied.baseHash, base.hash);
    assert.equal(
      f.engine.tasks(f.p.id).find((t) => t.id === f.task.id)?.status,
      "reviewing",
    );
  } finally {
    f.close();
  }
});
test("blocked descendants cannot masquerade as running after Resume", async () => {
  const f = fixture();
  try {
    f.task.status = "failed";
    f.store.put("task", f.task);
    const build = f.engine.task(f.p, {
      title: "Build",
      kind: "build",
      role: "orchestrator",
      provider: "studio",
      instructions: "Build",
      dependencies: [f.task.id],
      status: "dependencies",
    });
    f.engine.task(f.p, {
      title: "QA",
      kind: "qa",
      role: "qa",
      instructions: "QA",
      dependencies: [build.id],
      status: "dependencies",
    });
    await f.engine.tick();
    assert.equal(f.engine.project(f.p.id).execution, "error");
  } finally {
    f.close();
  }
});
test("an active task awaiting configuration cannot be dispatched again on the next scheduler tick", async () => {
  const f = fixture();
  try {
    let starts = 0;
    f.engine.runAgent = async () => {
      starts++;
    };
    f.engine.active.add(f.task.id);
    f.task.status = "queued";
    f.store.put("task", f.task);
    await f.engine.tick();
    assert.equal(starts, 0);
  } finally {
    f.close();
  }
});

test("a saved partial integration fix can be re-reviewed as a complete candidate without another worker generation", async () => {
  const f = fixture();
  try {
    f.p.budget.approved = true;
    for (const name of ["specification", "budget"])
      f.p.approvals[name] = {
        revision: 0,
        hash: f.engine.approvalHash(f.p, name),
        at: new Date().toISOString(),
      };
    f.engine.save(f.p);
    const full = assembleIntegration(f.sources).manifest;
    const partial = manifest({
      instances: [node("StarterGui/Controller", "return 'legacy fix'")],
    });
    f.task.status = "failed";
    f.task.attempt = 3;
    f.task.maxAttempts = 3;
    f.task.reviewId = "legacy-partial";
    f.task.error = "Результат не принят: Верните полный manifest";
    f.store.put("task", f.task);
    for (const [id, attempt, value] of [
      ["legacy-full", 2, full],
      ["legacy-partial", 3, partial],
    ] as const) {
      f.store.put("resultReview", {
        id,
        projectId: f.p.id,
        taskId: f.task.id,
        attempt,
        status: "rejected",
        summary: "Legacy result",
        issues: [],
      });
      f.store.put("agentCandidate", { id, raw: value, prepared: value });
    }
    const build = f.engine.task(f.p, {
      title: "Build",
      kind: "build",
      role: "orchestrator",
      provider: "studio",
      instructions: "Build",
      dependencies: [f.task.id],
      status: "dependencies",
    });
    const repaired = await f.engine.reviewSavedIntegrationPatch(
      f.task.id,
      "legacy-partial",
    );
    assert.equal(repaired.status, "reviewing");
    assert.equal(repaired.attempt, 1);
    const turns = f.calls.filter((c) => c.method === "turn/start");
    assert.equal(turns.length, 1);
    const input = JSON.parse(turns[0].params.input[0].text);
    assert.equal(input.candidate.instances.length, 3);
    assert.equal(
      input.candidate.instances.find(
        (n: any) => n.path === "StarterGui/Controller",
      ).source,
      "return 'legacy fix'",
    );
    assert.deepEqual(f.store.get<Task>("task", build.id)?.dependencies, [
      repaired.id,
    ]);
    assert.ok(f.store.get("agentCandidate", "legacy-full"));
  } finally {
    f.close();
  }
});

test("a Studio wait discovered during scheduling is not overwritten by the stalled-chain detector", async () => {
  const f = fixture();
  try {
    f.task.status = "succeeded";
    f.task.result = assembleIntegration(f.sources).manifest;
    f.store.put("task", f.task);
    const build = f.engine.task(f.p, {
      title: "Build",
      kind: "build",
      role: "orchestrator",
      provider: "studio",
      instructions: "Build",
      dependencies: [f.task.id],
      status: "queued",
    });
    f.engine.task(f.p, {
      title: "QA",
      kind: "qa",
      role: "qa",
      instructions: "QA",
      dependencies: [build.id],
      status: "dependencies",
    });
    f.engine.build = (project, task) => {
      task.status = "blocked";
      f.store.put("task", task);
      f.engine.setExecution(f.engine.project(project.id), "studio");
    };
    await f.engine.tick();
    assert.equal(f.engine.project(f.p.id).execution, "studio");
  } finally {
    f.close();
  }
});

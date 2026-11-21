import { effortModels } from "./effort-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Engine, REQUIRED_CHECKS } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { Store, hash } from "../server/store.js";
import { manifestSchema, type Manifest, type Task } from "../shared/domain.js";
import {
  serializeReviewInput,
  type ResultReview,
} from "../server/orchestrator.js";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "automation-review-")),
    store = new Store(root),
    codex = new Codex(),
    e = new Engine(store, codex);
  const p = e.createProject({
    name: "Orchestrator fixture",
    genre: "Simulator",
    goal: "Review every actual deliverable before application",
  });
  e.models = effortModels;
  e.setExecution(p, "running");
  const calls: Array<{ method: string; params: any }> = [];
  codex.ready = true;
  codex.isolatedConfig = async () => ({
    web_search: "live",
    mcp_servers: {},
    features: { shell_tool: false, apps: false, collab: false },
  });
  let n = 0;
  codex.request = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "thread/start")
      return { thread: { id: "review-thread-" + ++n } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    return { turn: { id: "review-turn-" + ++n } };
  };
  e.account = { account: { type: "chatgpt", id: "fixture" } };
  return {
    root,
    store,
    codex,
    e,
    p,
    calls,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function fullSpec() {
  return `# Original Park — specification
## Player loop and content
Collect litter, recycle it on the server, improve capacity, and restore three park areas. The first action is available without opening a menu. The server validates ownership, distance and capacity. A full bag never loses its contents. The main loop and all progression remain free. Three upgrades and six original litter types are in scope; no trading or user generated content is included.
## Presentation, systems and budgets
HUD, upgrades, collection and shop use the approved style on desktop and mobile. Author all text in English en-us, provide Roblox Localization, and parameterize dynamic messages. Save versioned profiles, migrate older data and make receipts idempotent. Cosmetic products have no fictional IDs and remain unavailable until configured. Target eight players, 60 FPS desktop and 30 FPS mobile, to be measured in Studio. Only original assets with recorded permissions are allowed. No paid API or publishing operation is authorized by this document.
## Acceptance criteria
${REQUIRED_CHECKS.map((id) => `- ${id}: exercise the actual client/server behavior and record evidence; not run yet.`).join("\n")}
## Estimate
External expenses are planned at zero; subscription usage is separate. Actual effort and performance remain estimates pending implementation.
`;
}
function response(): Manifest {
  return manifestSchema.parse({
    summary: "The specification has been prepared",
    files: [{ path: "SPEC.md", content: fullSpec() }],
    data: {
      specification:
        "SPEC.md contains the complete specification, economy and all checks. ".repeat(
          3,
        ),
      estimate: "External services planned at zero; effort is an estimate.",
      requiredChecks: REQUIRED_CHECKS,
    },
  });
}
function task(f: Fixture, extra: Partial<Task> = {}) {
  const t = f.e.task(f.p, {
    title: "Specification",
    role: "designer",
    kind: "specification",
    instructions:
      "Return a complete SPEC.md and an estimate; no generation or Studio execution",
    status: "running",
    attempt: 1,
    threadId: "worker-thread",
    turnId: "worker-turn",
    ...extra,
  });
  t.requirementsHash = f.e.taskRequirementsHash(f.e.project(f.p.id), t);
  f.store.put("task", t);
  return t;
}
function verdict(f: Fixture, id: string, change: Record<string, unknown> = {}) {
  const t = f.store.get<Task>("task", id)!,
    review = f.store.get<ResultReview>("resultReview", t.reviewId!)!;
  f.e.onNotification({
    method: "item/completed",
    params: {
      threadId: review.threadId,
      turnId: review.turnId,
      item: {
        type: "agentMessage",
        text: JSON.stringify({
          candidateHash: review.candidateHash,
          verdict: "accept",
          summary: "Full artifact matches the assigned task",
          issues: [],
          ...change,
        }),
      },
    },
  });
  f.e.onNotification({
    method: "turn/completed",
    params: {
      threadId: review.threadId,
      turn: { id: review.turnId, status: "completed" },
    },
  });
}
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end)
      throw new Error("Review did not reach the expected state");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("the orchestrator resolves the complete SPEC.md, rejects summary-only results and publishes nothing during preflight", () => {
  const f = fixture();
  try {
    const t = task(f),
      raw = response(),
      prepared = f.e.prepareResult(t, raw);
    assert.equal(prepared.data.specification, fullSpec());
    assert.notEqual(raw.data.specification, fullSpec());
    assert.equal(f.e.project(f.p.id).specification, "");
    assert.equal(existsSync(resolve(f.root, "tasks", t.id, "SPEC.md")), false);
    assert.throws(() => f.e.acceptResult(t, raw), /оркестратор/);
    const summary = manifestSchema.parse({
      summary: "Done",
      data: { specification: raw.data.specification, estimate: "Unknown" },
    });
    assert.throws(() => f.e.prepareResult(t, summary), /полный документ/);
    assert.equal(
      f.e.tasks(f.p.id).filter((t) => t.status === "succeeded").length,
      0,
    );
  } finally {
    f.close();
  }
});

test("a real worker completion is quarantined and routed to a separate isolated orchestrator turn before any project/file change", async () => {
  const f = fixture();
  try {
    const t = task(f),
      raw = response();
    f.e.active.add(t.id);
    const text = JSON.stringify({
      ...raw,
      dataJson: JSON.stringify(raw.data),
      instances: [],
    });
    f.e.onNotification({
      method: "item/completed",
      params: {
        threadId: t.threadId,
        turnId: t.turnId,
        item: { type: "agentMessage", text },
      },
    });
    f.e.onNotification({
      method: "turn/completed",
      params: {
        threadId: t.threadId,
        turn: { id: t.turnId, status: "completed" },
      },
    });
    await until(() => !!f.calls.find((c) => c.method === "turn/start"));
    const current = f.store.get<Task>("task", t.id)!;
    assert.equal(current.status, "reviewing");
    assert.equal(current.result, null);
    assert.equal(f.e.project(f.p.id).specification, "");
    assert.equal(existsSync(resolve(f.root, "tasks", t.id, "SPEC.md")), false);
    const start = f.calls.find((c) => c.method === "thread/start")!.params;
    assert.match(start.developerInstructions, /оркестратор/);
    assert.equal(start.config.web_search, "disabled");
    assert.equal(start.sandbox, "read-only");
    const turn = f.calls.find((c) => c.method === "turn/start")!.params;
    assert.notEqual(turn.threadId, t.threadId);
    assert.equal(turn.effort, "medium");
    assert.equal(turn.model, "gpt-6.1-sol");
    assert.equal(
      JSON.parse(turn.input[0].text).candidate.data.specification,
      fullSpec(),
    );
    await until(
      () =>
        !!f.store.get<ResultReview>("resultReview", current.reviewId!)?.turnId,
    );
    assert.equal(
      f.store.get<ResultReview>("resultReview", current.reviewId!)!.effortRun
        ?.effort,
      "medium",
    );
    verdict(f, t.id);
    const p = f.e.project(f.p.id),
      reviewed = f.store.get<Task>("task", t.id)!;
    assert.equal(reviewed.status, "succeeded");
    assert.equal(p.specification, fullSpec());
    assert.equal(f.store.read(p.specificationArtifact!.file), fullSpec());
    assert.equal(p.specificationArtifact!.hash, hash(fullSpec()));
    assert.equal(
      f.store.get<ResultReview>("resultReview", current.reviewId!)!.status,
      "accepted",
    );
    assert.ok(
      f.store.get<ResultReview>("resultReview", current.reviewId!)!.appliedAt,
    );
    assert.equal(f.store.all("command").length, 0);
    assert.equal(p.approvals.specification, undefined);
    assert.ok(reviewed.result!.checks.every((c) => c.status !== "passed"));
    const events = f.store
      .events(p.id)
      .filter((e: any) => e.type === "task.result").length;
    verdict(f, t.id);
    assert.equal(
      f.store.events(p.id).filter((e: any) => e.type === "task.result").length,
      events,
    );
  } finally {
    f.close();
  }
});

test("a rejected answer returns concrete findings to the same worker and cannot start dependencies", async () => {
  const f = fixture();
  try {
    const t = task(f);
    await f.e.submitAgentResult(t, response());
    verdict(f, t.id, {
      verdict: "revise",
      summary: "The scope is inconsistent",
      issues: ["Specify the missing capacity upgrade rule"],
    });
    const current = f.store.get<Task>("task", t.id)!;
    assert.equal(current.status, "queued");
    assert.match(current.error!, /capacity upgrade/);
    assert.equal(current.result, null);
    assert.equal(f.e.project(f.p.id).specification, "");
    await f.e.runAgent(f.e.project(f.p.id), current);
    const turn = f.calls.filter((c) => c.method === "turn/start").at(-1)!;
    assert.equal(turn.params.threadId, "worker-thread");
    assert.equal(turn.params.effort, "medium");
    assert.equal(turn.params.model, "gpt-6.1-sol");
    assert.match(
      JSON.parse(turn.params.input[0].text).previousFailure,
      /capacity upgrade/,
    );
    assert.equal(f.store.get<Task>("task", t.id)!.attempt, 2);
  } finally {
    f.close();
  }
});

test("the reviewer receives the worker's actual context, full skill resources, research, illustrated kit and service contracts", async () => {
  const f = fixture();
  try {
    f.e.selectStylePreset(f.p.id, "bright-simulator");
    const research = {
      id: "research-input",
      projectId: f.p.id,
      summary: "Provided project research",
      sources: [{ url: "https://example.com/source" }],
      concepts: [],
    };
    f.store.put("research", research);
    const t = task(f);
    await f.e.runAgent(f.e.project(f.p.id), t);
    const saved = f.store.get<any>("agentContext", t.id);
    assert.ok(saved.developerInstructions.includes("AutomationI18n"));
    assert.deepEqual(saved.prompt.research, [research]);
    await f.e.submitAgentResult(t, response());
    const prompt = JSON.parse(
      f.calls.filter((c) => c.method === "turn/start").at(-1)!.params.input[0]
        .text,
    );
    assert.deepEqual(prompt.workerContext.prompt, saved.prompt);
    assert.equal(
      prompt.workerContext.developerInstructions,
      saved.developerInstructions,
    );
    assert.match(prompt.serviceContracts.gameLanguage, /AutomationI18n/);
    assert.match(
      prompt.serviceContracts.localizationQA,
      /AutomationLocaleCatalog/,
    );
    assert.deepEqual(prompt.research, [research]);
    assert.equal(prompt.uiStyleKit.preset.id, "bright-simulator");
    assert.ok(prompt.uiStyleKit.icons.icons.inventory.paths.length);
    const skill = f.store.get<any>("skill", "game-ui-ux");
    assert.equal(
      prompt.skillResources.find((s: any) => s.id === skill.id).instructions,
      skill.instructions,
    );
    assert.match(prompt.uiStyleLicense, /original/i);
  } finally {
    f.close();
  }
});

test("code and QA answers are gated too; forged passes and missing artifacts cannot enter Studio", async () => {
  const f = fixture();
  try {
    for (const role of ["gameplay", "ui", "assets", "qa", "art"] as const) {
      const t = task(f, {
        role,
        kind: role === "art" ? "artifacts" : role,
        scope: ["ServerStorage"],
      });
      const result = manifestSchema.parse({
        summary: "Prepared module",
        instances: [
          {
            path: "ServerStorage/AutomationTests",
            className: "ModuleScript",
            source: "return {run=function() return {} end}",
          },
        ],
      });
      await f.e.submitAgentResult(t, result);
      assert.equal(f.store.get<Task>("task", t.id)!.status, "reviewing");
      assert.equal(f.store.all("command").length, 0);
      verdict(f, t.id, {
        verdict: "revise",
        issues: ["The module lacks the assigned behavior"],
      });
      assert.equal(f.store.get<Task>("task", t.id)!.result, null);
    }
    const t = task(f, { kind: "ui", role: "ui" });
    assert.throws(
      () => f.e.prepareResult(t, manifestSchema.parse({ summary: "Done" })),
      /только summary/,
    );
    assert.throws(
      () =>
        f.e.prepareResult(
          t,
          manifestSchema.parse({
            summary: "Done",
            checks: [
              {
                id: "launch",
                name: "Launch",
                required: true,
                status: "passed",
                evidence: "Claimed success",
              },
            ],
          }),
        ),
      /не может засчитывать/,
    );
  } finally {
    f.close();
  }
});

test("changed requirements, contradictory verdicts and wrong hashes never publish a candidate", async () => {
  const f = fixture();
  try {
    for (const change of [
      { candidateHash: "0".repeat(64) },
      { issues: ["Unresolved issue"] },
    ]) {
      const t = task(f);
      await f.e.submitAgentResult(t, response());
      verdict(f, t.id, change);
      assert.equal(f.store.get<Task>("task", t.id)!.status, "blocked");
      assert.equal(f.e.project(f.p.id).specification, "");
    }
    const t = task(f);
    await f.e.submitAgentResult(t, response());
    f.e.updateProject(f.p.id, {
      goal: "The owner changed the production requirements",
    });
    verdict(f, t.id);
    assert.equal(f.e.project(f.p.id).specification, "");
    assert.equal(
      f.store.get<ResultReview>("resultReview", t.reviewId!)!.status,
      "stale",
    );
  } finally {
    f.close();
  }
});

test("a paused/restarted review retains its candidate and resumes the review without another worker attempt", async () => {
  const f = fixture();
  try {
    const t = task(f, { maxAttempts: 1 });
    await f.e.submitAgentResult(t, response());
    const review = f.store.get<ResultReview>("resultReview", t.reviewId!)!,
      interruptions: string[] = [];
    f.codex.stopTask = async (thread) => {
      interruptions.push(thread);
      return true;
    };
    f.e.control(f.p.id, "pause");
    await until(() => interruptions.length === 1);
    assert.deepEqual(interruptions, [review.threadId]);
    verdict(f, t.id);
    assert.equal(f.e.project(f.p.id).specification, "");
    const restarted = new Engine(f.store, f.codex);
    restarted.account = f.e.account;
    f.e = restarted;
    restarted.control(f.p.id, "resume");
    const pending = f.store.get<Task>("task", t.id)!;
    assert.equal(pending.status, "queued");
    const before = f.calls.length;
    restarted.models = effortModels;
    await restarted.runAgent(restarted.project(f.p.id), pending);
    assert.equal(f.store.get<Task>("task", t.id)!.attempt, 1);
    assert.equal(
      f.calls.slice(before).find((c) => c.method === "thread/resume")!.params
        .threadId,
      review.threadId,
    );
    verdict(f, t.id);
    assert.equal(restarted.project(f.p.id).specification, fullSpec());
  } finally {
    f.close();
  }
});

test("unavailable review keeps the candidate for retry; manual edits invalidate the document approval and provenance", async () => {
  const f = fixture();
  try {
    const t = task(f);
    f.codex.ready = false;
    await f.e.submitAgentResult(t, response());
    assert.equal(f.store.get<Task>("task", t.id)!.status, "blocked");
    assert.equal(f.e.project(f.p.id).specification, "");
    f.codex.ready = true;
    const pending = f.e.retryTask(t.id);
    await f.e.runAgent(f.e.project(f.p.id), pending);
    verdict(f, t.id);
    const p = f.e.project(f.p.id);
    p.approvals.specification = {
      at: new Date().toISOString(),
      hash: "old",
      revision: 0,
    };
    p.approvals.budget = {
      at: new Date().toISOString(),
      hash: "old",
      revision: 0,
    };
    p.budget.approved = true;
    f.e.save(p);
    const changed = f.e.updateProject(p.id, {
      specification: fullSpec() + "\nOwner's change",
    });
    assert.equal(changed.specificationArtifact, undefined);
    assert.equal(changed.approvals.specification, undefined);
    assert.equal(changed.approvals.budget, undefined);
    assert.equal(changed.budget.approved, false);
  } finally {
    f.close();
  }
});

test("large review context preserves every value while transferring a repeated base only once", () => {
  const base = {
    instances: [
      { path: "Workspace/Example", source: "source line\n".repeat(50000) },
    ],
  };
  const input = {
    candidateHash: "candidate identity",
    workerContext: { prompt: { base } },
    base,
    candidate: {
      source: "independent candidate",
      metadata: { $contextRef: "ordinary untrusted data" },
    },
  };
  const text = serializeReviewInput(input);
  assert.ok(text.length < 900000);
  const envelope = JSON.parse(text);
  assert.equal(envelope.transport, "lossless-json-pointer-v1");
  assert.deepEqual(envelope.references, [
    { at: "/base", to: "/workerContext/prompt/base" },
  ]);
  const parts = (path: string) =>
    path
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
  for (const ref of envelope.references) {
    const value = parts(ref.to).reduce(
      (v: any, k: string) => v[k],
      envelope.payload,
    );
    const keys = parts(ref.at),
      key = keys.pop()!;
    const parent = keys.reduce((v: any, k: string) => v[k], envelope.payload);
    parent[key] = structuredClone(value);
  }
  assert.deepEqual(envelope.payload, input);
  assert.equal(
    serializeReviewInput({ candidateHash: "small" }),
    JSON.stringify({ candidateHash: "small" }),
  );
});

test("a reviewer thread with no persisted rollout is recreated without rerunning the worker", async () => {
  const f = fixture();
  try {
    const t = task(f);
    await f.e.submitAgentResult(t, response());
    const review = f.store.get<ResultReview>("resultReview", t.reviewId!)!;
    review.status = "blocked";
    review.turnId = null;
    f.store.put("resultReview", review);
    const oldThread = review.threadId;
    const request = f.codex.request;
    let missing = false;
    f.codex.request = async (method: string, params: any) => {
      if (method === "thread/resume" && params.threadId === oldThread) {
        missing = true;
        throw new Error("no rollout found for thread id " + oldThread);
      }
      return request(method, params);
    };
    const candidatesBefore = f.store.all("agentCandidate").length;
    await f.e.runReview(f.e.project(f.p.id), t, review);
    assert.ok(missing);
    assert.equal(review.status, "reviewing");
    assert.notEqual(review.threadId, oldThread);
    assert.equal(t.attempt, 1);
    assert.equal(f.store.all("agentCandidate").length, candidatesBefore);
    assert.equal(f.e.tasks(f.p.id).length, 1);
  } finally {
    f.close();
  }
});

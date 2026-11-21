import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { Engine } from "../server/engine.js";
import { createApp } from "../server/app.js";
import { generateProjectNames, namingBrief } from "../server/name-generator.js";
import {
  namingStudy,
  projectNameSchema,
  validateNameSuggestions,
} from "../shared/project-naming.js";
import { effortModels } from "./effort-fixture.js";
import { fixtureNames, mockNamingAI } from "./project-naming-fixture.js";
function fixture(options: Parameters<typeof mockNamingAI>[1] = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "project-naming-"));
  const store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  const p = engine.createProject({
    name: "123",
    genre: "Симулятор",
    goal: "Детская игра про уборку парка",
  });
  p.concept = JSON.stringify({
    title: "Cleanup",
    loop: "Collect litter, recycle, upgrade capacity, restore the park",
    privateInternalNote: "PRIVATE_CONCEPT_NOTE",
  });
  p.specification = "PRIVATE_SPECIFICATION";
  p.selectedStyle = "PRIVATE_STYLE_ID";
  engine.save(p);
  store.put("feedback", {
    id: "feedback",
    projectId: p.id,
    text: "PRIVATE_FEEDBACK",
  });
  engine.account = { account: { type: "chatgpt", id: "test" } };
  engine.models = effortModels;
  const calls = mockNamingAI(codex, options);
  return {
    root,
    store,
    codex,
    engine,
    p,
    calls,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("study contains a dated sourced chart and derived naming rules", () => {
  assert.equal(namingStudy.games.length, 24);
  assert.ok(
    namingStudy.games.every(
      (g) => g.url.startsWith("https://www.roblox.com/games/") && g.baseName,
    ),
  );
  assert.equal(namingStudy.analysis.sampleSize, 24);
  assert.ok(!Number.isNaN(Date.parse(namingStudy.checkedAt)));
});
test("renaming validates and persists metadata without changing approvals, identity or work", () => {
  const f = fixture();
  try {
    f.p.approvals = {
      concept: { revision: 0, hash: "approved", at: new Date().toISOString() },
    };
    f.engine.save(f.p);
    const t = f.engine.task(f.p, {
      title: "Queued work",
      role: "ui",
      kind: "ui",
      instructions: "test",
    });
    const before = f.engine.taskRequirementsHash(f.p, t);
    const updated = f.engine.updateProject(f.p.id, {
      name: "  Парк Чистоты  ",
    });
    assert.equal(updated.name, "Парк Чистоты");
    assert.equal(updated.id, f.p.id);
    assert.deepEqual(updated.approvals, f.p.approvals);
    assert.equal(updated.revision, 0);
    assert.equal(f.engine.taskRequirementsHash(updated, t), before);
    assert.equal(f.store.get<any>("task", t.id).status, "queued");
    assert.throws(() => f.engine.updateProject(f.p.id, { name: " " }));
    assert.throws(() =>
      f.engine.updateProject(f.p.id, { name: "A".repeat(101) }),
    );
    assert.throws(() =>
      f.engine.updateProject(f.p.id, { name: "Hello\nWorld" }),
    );
    assert.equal(f.engine.project(f.p.id).name, "Парк Чистоты");
  } finally {
    f.close();
  }
});
test("AI sees only a bounded idea/genre/concept brief, never full documents or other projects", async () => {
  const f = fixture();
  try {
    f.engine.createProject({
      name: "PRIVATE_OTHER_PROJECT",
      genre: "Test",
      goal: "Private",
    });
    const result = await f.engine.suggestProjectNames(f.p.id);
    assert.equal(result.suggestions.length, 5);
    const turn = f.calls.find((c) => c.method === "turn/start")!.params;
    assert.equal(turn.effort, "medium");
    assert.equal(turn.model, "test-model");
    assert.match(turn.input[0].text, /Collect litter/);
    assert.doesNotMatch(
      turn.input[0].text,
      /PRIVATE_|specification|feedback|styleId/,
    );
    assert.ok(
      f.calls.find((c) => c.method === "thread/start")!.params.ephemeral,
    );
    assert.equal(f.engine.project(f.p.id).name, "123");
    assert.equal(f.engine.tasks(f.p.id).length, 0);
    const saved = f.store.all<any>("nameGeneration")[0];
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.effort, "medium");
    assert.equal(saved.usage.last.outputTokens, 500);
    assert.equal(f.engine.namingRequests.size, 0);
    assert.equal(f.codex.listenerCount("notification"), 1);
  } finally {
    f.close();
  }
});
test("concept summaries retain only bounded known gameplay fields", () => {
  const f = fixture();
  try {
    assert.doesNotMatch(JSON.stringify(namingBrief(f.p)), /PRIVATE_/);
    f.p.goal = "x".repeat(20000);
    f.p.concept = "y".repeat(20000);
    assert.ok(JSON.stringify(namingBrief(f.p)).length < 5000);
  } finally {
    f.close();
  }
});
test("duplicate clicks share one AI request and results are not a template fallback", async () => {
  const f = fixture();
  try {
    const [a, b] = await Promise.all([
      f.engine.suggestProjectNames(f.p.id),
      f.engine.suggestProjectNames(f.p.id),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
    assert.deepEqual(a.suggestions, fixtureNames);
  } finally {
    f.close();
  }
});
test("AI errors leave the project name unchanged and release the naming request", async () => {
  const f = fixture({ error: "Selected model is at capacity" });
  try {
    await assert.rejects(f.engine.suggestProjectNames(f.p.id), /at capacity/);
    assert.equal(f.engine.project(f.p.id).name, "123");
    assert.equal(f.engine.namingRequests.size, 0);
    assert.equal(f.store.all<any>("nameGeneration")[0].status, "failed");
    assert.equal(f.codex.listenerCount("notification"), 1);
  } finally {
    f.close();
  }
});
test("timeouts and shutdown interrupt naming without replay or leftover listeners", async () => {
  const f = fixture({ noResponse: true });
  try {
    await assert.rejects(
      generateProjectNames({
        store: f.store,
        codex: f.codex,
        project: f.p,
        models: effortModels,
        timeoutMs: 20,
      }),
      /вовремя/,
    );
    assert.ok(f.calls.some((c) => c.method === "turn/interrupt"));
    assert.equal(f.codex.listenerCount("notification"), 1);
    const pending = f.engine.suggestProjectNames(f.p.id);
    const rejected = assert.rejects(pending, /остановлена|aborted/i);
    await new Promise((r) => setTimeout(r, 10));
    await f.engine.stop();
    await rejected;
    assert.equal(f.engine.namingRequests.size, 0);
    assert.ok(
      f.store.all<any>("nameGeneration").every((g) => g.status === "failed"),
    );
  } finally {
    f.close();
  }
});
test("no account or exhausted quota does not start naming or spend API credits", async () => {
  const f = fixture();
  try {
    f.engine.account = { account: { type: "apiKey" } };
    await assert.rejects(
      f.engine.suggestProjectNames(f.p.id),
      /подключите аккаунт исполнителя/,
    );
    f.engine.account = { account: { type: "chatgpt" } };
    f.engine.quotaStale = false;
    f.engine.quota = {
      rateLimits: {
        primary: {
          usedPercent: 100,
          windowDurationMins: 300,
          resetsAt: 1900000000,
        },
      },
    };
    await assert.rejects(f.engine.suggestProjectNames(f.p.id), /квоты/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.all("nameGeneration").length, 0);
  } finally {
    f.close();
  }
});
test("an exhausted included quota blocks unless the owner lets the project spend credits above its floor", () => {
  const f = fixture();
  try {
    const p = f.engine.project(f.p.id);
    f.engine.quotaStale = false;
    f.engine.quota = {
      rateLimits: {
        primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1900000000 },
        credits: { hasCredits: true, unlimited: false, balance: "500.0" },
        spendControlReached: false,
        rateLimitReachedType: null,
      },
    };
    // Credits on the account are not a permission to spend them.
    assert.equal(f.engine.quotaBlocked(p), true);
    p.settings.creditsFloor = 400;
    assert.equal(f.engine.quotaBlocked(p), false);
    p.settings.creditsFloor = 500;
    assert.equal(f.engine.quotaBlocked(p), true, "the floor itself is kept");
    p.settings.creditsFloor = 0;
    f.engine.quota.rateLimits.spendControlReached = true;
    assert.equal(f.engine.quotaBlocked(p), true);
    f.engine.quota.rateLimits.spendControlReached = false;
    // The plan limit being reached is what credits are for; depleted credits are not.
    f.engine.quota.rateLimits.rateLimitReachedType = "rate_limit_reached";
    assert.equal(f.engine.quotaBlocked(p), false);
    f.engine.quota.rateLimits.rateLimitReachedType = "workspace_owner_credits_depleted";
    assert.equal(f.engine.quotaBlocked(p), true);
    f.engine.quota.rateLimits.rateLimitReachedType = null;
    // A sparse rolling update keeps the credits the last full read reported.
    f.engine.onNotification({
      method: "account/rateLimits/updated",
      params: {
        rateLimits: {
          primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1900000000 },
          credits: null,
          spendControlReached: null,
        },
      },
    });
    assert.equal(f.engine.quota.rateLimits.credits.balance, "500.0");
    assert.equal(f.engine.quotaBlocked(p), false);
    f.engine.quota.rateLimits.credits = { hasCredits: false, unlimited: false, balance: "0" };
    assert.equal(f.engine.quotaBlocked(p), true);
  } finally {
    f.close();
  }
});
test("a free limit reset is redeemed once per quota window and only when the quota reopens late", async () => {
  const f = fixture();
  try {
    const p = f.engine.project(f.p.id);
    const consumed: any[] = [];
    f.engine.refreshAccount = async () => {};
    f.codex.request = async (method: string, params: any) => {
      consumed.push({ method, params });
      return { outcome: "reset" };
    };
    const seconds = (hours: number) => Math.floor(Date.now() / 1000) + hours * 3600;
    const quota = (resetsAt: number, availableCount: number) => ({
      rateLimits: { primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt } },
      rateLimitResetCredits: { availableCount, credits: null },
    });
    f.engine.quotaStale = false;
    f.engine.quota = quota(seconds(48), 2);
    f.engine.maybeResetLimits(p);
    assert.equal(consumed.length, 0, "not without the owner's permission");
    p.settings.autoResetLimits = true;
    f.engine.quota = quota(seconds(2), 2);
    f.engine.maybeResetLimits(p);
    assert.equal(consumed.length, 0, "the quota reopens by itself soon");
    f.engine.quota = quota(seconds(48), 0);
    f.engine.maybeResetLimits(p);
    assert.equal(consumed.length, 0, "no reset credit left");
    f.engine.quota = quota(seconds(48), 2);
    f.engine.maybeResetLimits(p);
    f.engine.maybeResetLimits(p);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(consumed.length, 1);
    assert.equal(consumed[0].method, "account/rateLimitResetCredit/consume");
    assert.match(consumed[0].params.idempotencyKey, /^workshop-reset-\d+$/);
    assert.ok(
      f.store.events(p.id).some((e: any) => e.type === "account.limits.reset" && e.body.outcome === "reset"),
    );
  } finally {
    f.close();
  }
});
test("duplicate names, chart copies and malformed answers are rejected locally", () => {
  assert.equal(projectNameSchema.parse("  My Park  "), "My Park");
  assert.throws(() => validateNameSuggestions({ suggestions: [] }));
  assert.throws(
    () =>
      validateNameSuggestions({
        suggestions: fixtureNames.map((s, i) => ({
          ...s,
          name: i === 0 ? "Fish It!" : s.name,
        })),
      }),
    /повторил/,
  );
  assert.throws(
    () =>
      validateNameSuggestions({
        suggestions: fixtureNames.map((s) => ({ ...s, name: "Same Name" })),
      }),
    /повторил/,
  );
  assert.throws(
    () =>
      validateNameSuggestions({ suggestions: fixtureNames }, [
        "Sweep the Park",
      ]),
    /повторил/,
  );
});
test("HTTP rename and AI naming are authenticated and generating suggestions never renames", async () => {
  const f = fixture(),
    port = 48334;
  const server = createApp(f.store, f.engine, "naming-test-token", {
    port,
    appRoot: resolve("."),
  }).listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const headers = {
    Authorization: "Bearer naming-test-token",
    "Content-Type": "application/json",
  };
  try {
    const path = `http://127.0.0.1:${port}/api/projects/${f.p.id}`;
    assert.equal(
      (
        await fetch(path + "/name-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    const names = await fetch(path + "/name-suggestions", {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(names.status, 200);
    assert.equal((await names.json()).suggestions.length, 5);
    assert.equal(f.engine.project(f.p.id).name, "123");
    assert.equal(
      (
        await fetch(path, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ name: "My Clean Park" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(path, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ name: " " }),
        })
      ).status,
      400,
    );
    assert.equal(f.engine.project(f.p.id).name, "My Clean Park");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
  }
});

test("fenced JSON is accepted and malformed AI output fails without a template replacement", async () => {
  const raw =
    "```json\n" + JSON.stringify({ suggestions: fixtureNames }) + "\n```";
  const f = fixture({ rawText: raw });
  try {
    const result = await f.engine.suggestProjectNames(f.p.id);
    assert.deepEqual(result.suggestions, fixtureNames);
    assert.equal(f.store.all<any>("nameGeneration")[0].rawResponse, raw);
  } finally {
    f.close();
  }
  const bad = fixture({ rawText: "not a JSON response" });
  try {
    await assert.rejects(
      bad.engine.suggestProjectNames(bad.p.id),
      /некорректный список/,
    );
    assert.equal(bad.engine.project(bad.p.id).name, "123");
    assert.equal(bad.store.all<any>("nameGeneration")[0].status, "failed");
    assert.equal(bad.engine.namingRequests.size, 0);
  } finally {
    bad.close();
  }
});

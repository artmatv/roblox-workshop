import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store, hash, safePath, id } from "../server/store.js";
import { Codex, normalizeLimits } from "../server/codex.js";
import { Engine, REQUIRED_CHECKS } from "../server/engine.js";
import { reserve, balance, settle } from "../server/budget.js";
import {
  manifestSchema,
  type Version,
  type StylePackage,
  type StudioConnection,
  type Command,
} from "../shared/domain.js";
import { exportPlace, normalizeEnumTokens } from "../server/export.js";
import { prepareGameLocalization } from "../server/game-localization.js";
import { Adapters, parseCsv } from "../server/adapters.js";
import { Vault } from "../server/vault.js";
import { acceptReviewed } from "./review-fixture.js";
const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-test-"));
  const s = new Store(root);
  const e = new Engine(s, new Codex());
  const p = e.createProject({
    name: "Test only",
    genre: "Obby",
    goal: "Isolated acceptance fixture",
  });
  return {
    s,
    e,
    p,
    close: () => {
      s.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
};
const manifest = () =>
  manifestSchema.parse({
    summary: "Test artifact",
    instances: [
      {
        path: "Workspace/TestPart",
        className: "Part",
        properties: {
          Anchored: true,
          Size: { type: "Vector3", value: [4, 1, 4] },
        },
      },
    ],
  });
test("service shutdown interrupts each active task once even when requested twice", async () => {
  const f = fixture();
  let interruptions = 0,
    closes = 0;
  f.e.codex.stopTask = async () => {
    interruptions++;
    await Promise.resolve();
    return true;
  };
  f.e.codex.close = () => {
    closes++;
  };
  try {
    const t = f.e.task(f.p, {
      title: "Running",
      role: "art",
      kind: "styles",
      instructions: "test",
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      status: "running",
    });
    f.e.active.add(t.id);
    await Promise.all([f.e.stop(), f.e.stop()]);
    assert.equal(interruptions, 1);
    assert.equal(closes, 1);
  } finally {
    f.close();
  }
});
function studio(f: ReturnType<typeof fixture>) {
  const s: StudioConnection = {
    id: id(),
    projectId: f.p.id,
    name: "Test Studio",
    placeId: "0",
    universeId: "0",
    version: 0,
    fingerprint: "base",
    lastSeen: new Date().toISOString(),
    capabilities: ["apply", "test", "capture", "snapshot", "import"],
    stopped: false,
  };
  f.s.put("studio", s);
  f.p.studioId = s.id;
  f.e.save(f.p);
  return s;
}
function ready(f: ReturnType<typeof fixture>) {
  const { p, e, s } = f;
  p.concept = "Original concept";
  e.save(p);
  e.approve(p.id, "concept");
  const style: StylePackage = {
    id: id(),
    projectId: p.id,
    familyId: "roblox-classic",
    version: 1,
    name: "Test style",
    status: "studio",
    rules: {},
    references: [],
    previews: [],
    studioEvidence: "test-evidence",
  };
  s.put("style", style);
  const previewResult = manifest();
  prepareGameLocalization(previewResult);
  const preview = e.task(p, {
    title: "Verified English preview fixture",
    role: "art",
    kind: "style-preview",
    instructions: "fixture",
    status: "succeeded",
    result: previewResult,
  });
  style.previewTaskId = preview.id;
  s.put("style", style);
  e.updateProject(p.id, { selectedStyle: style.id });
  e.approve(p.id, "style");
  e.updateProject(p.id, {
    specification: "Test specification ".repeat(20),
    budget: { limitMicros: 10_000_000 },
    settings: { dailyLimitMicros: 10_000_000 },
  });
  e.approve(p.id, "specification");
  e.approve(p.id, "budget");
  return e.project(p.id);
}
test("project, decisions and events survive a process restart", () => {
  const f = fixture();
  try {
    f.p.concept = "Persisted";
    f.e.save(f.p);
    f.e.approve(f.p.id, "concept");
    const second = new Store(f.s.root);
    assert.equal(second.get<any>("project", f.p.id).concept, "Persisted");
    assert.ok(second.events(f.p.id).length >= 2);
    second.close();
  } finally {
    f.close();
  }
});
test("production cannot bypass concept/style/specification/budget gates", () => {
  const f = fixture();
  try {
    assert.throws(() => f.e.startPhase(f.p.id, "production"), /согласование/);
    assert.throws(() => f.e.approve(f.p.id, "style"), /согласование/);
    studio(f);
    const p = ready(f);
    f.e.startPhase(p.id, "production");
    assert.equal(
      f.e.tasks(p.id).filter((t) => t.kind !== "style-preview").length,
      1,
    );
    assert.equal(
      f.e
        .tasks(p.id)
        .filter(
          (t) => t.kind !== "style-preview" && t.dependencies.length === 0,
        ).length,
      1,
    );
  } finally {
    f.close();
  }
});
test("changing approved requirements invalidates dependent approvals and queued work", () => {
  const f = fixture();
  try {
    studio(f);
    const p = ready(f);
    f.e.startPhase(p.id, "production");
    const after = f.e.updateProject(p.id, { concept: "Changed intent" });
    assert.equal(after.approvals.concept, undefined);
    assert.equal(after.approvals.style, undefined);
    assert.equal(after.approvals.specification, undefined);
    assert.ok(
      f.e
        .tasks(p.id)
        .filter((t) => t.kind !== "style-preview")
        .every((t) => t.status === "cancelled"),
    );
  } finally {
    f.close();
  }
});
test("a file cannot escape the task root through relative traversal", () => {
  const f = fixture();
  try {
    assert.throws(() => safePath(f.s.root, "../outside"));
    assert.throws(() => safePath(f.s.root, "C:/secret"));
    assert.throws(() => safePath(f.s.root, "x\\y"));
    assert.throws(() => safePath(f.s.root, "tasks/x/../../../outside"));
    assert.ok(safePath(f.s.root, "tasks/x/result.json").startsWith(f.s.root));
  } finally {
    f.close();
  }
});
test("budget reservations are atomic, counted once and released on settlement", () => {
  const f = fixture();
  try {
    let p = ready(f);
    p.budget.limitMicros = 100;
    p.settings.dailyLimitMicros = 100;
    f.e.save(p);
    const a = f.e.task(p, {
      title: "a",
      role: "art",
      kind: "test",
      instructions: "test",
      estimateMicros: 70,
    });
    a.reservationId = reserve(f.s, p, a);
    assert.equal(balance(f.s, p).availableMicros, 30);
    const b = f.e.task(p, {
      title: "b",
      role: "art",
      kind: "test",
      instructions: "test",
      estimateMicros: 40,
    });
    assert.throws(() => reserve(f.s, p, b), /бюджета/);
    settle(f.s, a, 50, "provider-operation-1");
    settle(f.s, a, 50, "provider-operation-1");
    assert.deepEqual(balance(f.s, p), {
      limitMicros: 100,
      spentMicros: 50,
      reservedMicros: 0,
      availableMicros: 50,
    });
  } finally {
    f.close();
  }
});
test("invalid estimates, daily, stage and provider limits are enforced", () => {
  const f = fixture();
  try {
    const p = ready(f);
    const t = f.e.task(p, {
      title: "a",
      role: "art",
      kind: "test",
      instructions: "test",
      estimateMicros: 100,
    });
    p.settings.dailyLimitMicros = 99;
    assert.throws(() => reserve(f.s, p, t), /Дневной/);
    p.settings.dailyLimitMicros = 1000;
    p.budget.stageLimits[p.stage] = 99;
    assert.throws(() => reserve(f.s, p, t), /этапа/);
    p.budget.stageLimits = {};
    p.budget.providerLimits.codex = 99;
    assert.throws(() => reserve(f.s, p, t), /провайдера/);
    t.estimateMicros = NaN;
    assert.throws(() => reserve(f.s, p, t), /резерв/);
  } finally {
    f.close();
  }
});
test("quota maps include every source entry, clamp percentages and keep unknowns", () => {
  const q = normalizeLimits({
    rateLimitsByLimitId: {
      a: {
        limitName: "Model A",
        primary: {
          usedPercent: 110,
          windowDurationMins: 300,
          resetsAt: 1793510000,
        },
      },
      b: {
        secondary: {
          usedPercent: -5,
          windowDurationMins: null,
          resetsAt: null,
        },
      },
      c: { primary: {} },
    },
  });
  assert.equal(q.length, 3);
  assert.equal(q[0].remaining, 0);
  assert.equal(q[1].remaining, 100);
  assert.equal(q[2].remaining, null);
  assert.equal(q[1].resetsAt, null);
  assert.equal(normalizeLimits({}).length, 0);
  assert.equal(
    normalizeLimits({ rateLimits: { primary: { usedPercent: 20 } } })[0]
      .remaining,
    80,
  );
});
test("scope and untrusted code are rejected before integration", () => {
  const f = fixture();
  try {
    f.e.setExecution(f.p, "running");
    const t = f.e.task(f.p, {
      title: "ui",
      role: "ui",
      kind: "ui",
      scope: ["StarterGui"],
      instructions: "UI",
    });
    assert.throws(() => f.e.acceptResult(t, manifest()), /области/);
    const bad = manifest();
    bad.instances = [
      {
        path: "StarterGui/Bad",
        className: "LocalScript",
        properties: {},
        source: "require(12345)",
      },
    ];
    assert.throws(() => f.e.acceptResult(t, bad), /запрещённый вызов require/);
    assert.notEqual(f.s.get<any>("task", t.id).status, "succeeded");
  } finally {
    f.close();
  }
});
test("changed pinned skills or unavailable required tools block execution", () => {
  const f = fixture();
  try {
    const t = f.e.task(f.p, {
      title: "ui",
      role: "ui",
      kind: "ui",
      instructions: "UI",
    });
    assert.throws(() => f.e.skillContext(f.p, t), /недоступны/);
    studio(f);
    assert.ok(f.e.skillContext(f.p, t).includes("roblox-ui"));
    const skill = f.s.get<any>("skill", "roblox-ui");
    skill.instructions = "Changed";
    f.s.put("skill", skill);
    assert.throws(() => f.e.skillContext(f.p, t), /Изменена/);
  } finally {
    f.close();
  }
});
test("Studio commands bind project, connection, revision and write queue", () => {
  const f = fixture();
  try {
    const s = studio(f);
    const t = f.e.task(f.p, {
      title: "build",
      role: "orchestrator",
      kind: "build",
      instructions: "build",
    });
    const c = f.e.queue(f.p, t, "apply", {
      manifest: manifest(),
      targetRevision: 1,
    });
    assert.equal(c.expectedFingerprint, "base");
    assert.equal(c.studioId, s.id);
    assert.throws(() => f.e.queue(f.p, t, "apply", {}), /занята/);
    c.status = "sent";
    f.s.put("command", c);
    assert.throws(
      () => f.e.commandResult("another", c.id, { ok: true }),
      /не найдена/,
    );
    assert.throws(
      () =>
        f.e.commandResult(s.id, c.id, {
          ok: true,
          projectId: f.p.id,
          baseRevision: 99,
        }),
      /версия/,
    );
    f.e.commandResult(s.id, c.id, {
      ok: true,
      projectId: f.p.id,
      baseRevision: 0,
      fingerprint: "new",
    });
    assert.equal(f.e.project(f.p.id).revision, 1);
    const count = f.s.events(f.p.id).length;
    f.e.commandResult(s.id, c.id, {
      ok: true,
      projectId: f.p.id,
      baseRevision: 0,
    });
    assert.equal(f.s.events(f.p.id).length, count);
  } finally {
    f.close();
  }
});
test("interrupted tasks and uncertain operations survive restart without replay", () => {
  const f = fixture();
  try {
    studio(f);
    const t = f.e.task(f.p, {
      title: "work",
      role: "gameplay",
      kind: "gameplay",
      instructions: "work",
      status: "running",
      threadId: "persisted-thread",
    });
    const c = f.e.queue(f.p, t, "snapshot", {});
    c.status = "sent";
    f.s.put("command", c);
    new Engine(f.s, new Codex());
    assert.equal(f.s.get<any>("task", t.id).status, "blocked");
    assert.equal(f.s.get<any>("task", t.id).threadId, "persisted-thread");
    assert.equal(f.s.get<any>("command", c.id).status, "uncertain");
  } finally {
    f.close();
  }
});
test("release requires actual checks, phone, assets, target and exact version", () => {
  const f = fixture();
  try {
    const p = ready(f);
    p.revision = 1;
    p.placeId = "123";
    p.universeId = "456";
    f.e.save(p);
    const m = manifest();
    prepareGameLocalization(m);
    const v: Version = {
      id: id(),
      projectId: p.id,
      revision: 1,
      hash: hash(m),
      createdAt: new Date().toISOString(),
      reason: "Test",
      manifest: m,
      specification: p.specification,
      concept: p.concept,
      styleId: p.selectedStyle,
      styleVersion: 1,
      skillPins: p.skillPins,
      checks: REQUIRED_CHECKS.map((id) => ({
        id,
        name: id,
        required: true,
        status: "not_run",
        evidence: null,
      })),
      phone: null,
      findings: [],
      assets: [],
    };
    f.s.put("version", v);
    assert.throws(() => f.e.approveRelease(p.id, []), /телефоне/);
    v.checks = v.checks.map((c) => ({
      ...c,
      status: "passed",
      evidence: "test fixture evidence",
    }));
    v.phone = {
      device: "Test physical phone",
      at: new Date().toISOString(),
      passed: true,
      notes: "fixture",
    };
    v.assets = [{ id: "required", required: true, status: "pending" }];
    f.s.put("version", v);
    assert.throws(() => f.e.approveRelease(p.id, []), /ресурсы/);
    v.assets[0].status = "available";
    v.findings = [{ severity: "minor", message: "Small issue" }];
    f.s.put("version", v);
    assert.throws(() => f.e.approveRelease(p.id, []), /недочёт/);
    assert.equal(f.e.approveRelease(p.id, ["Small issue"]).hash, v.hash);
    f.e.updateProject(p.id, { specification: "Changed" });
    assert.throws(
      () => f.e.approveRelease(p.id, ["Small issue"]),
      /спецификация/,
    );
  } finally {
    f.close();
  }
});
test("CSV handles quotes, missing values, provenance and duplicate imports", () => {
  const f = fixture();
  try {
    assert.deepEqual(parseCsv('a,b\r\n"quoted,cell","double""quote"'), [
      ["a", "b"],
      ["quoted,cell", 'double"quote'],
    ]);
    const a = new Adapters(f.s, new Vault(f.s));
    const csv =
      "date,metric,value,unit\n2026-11-01,d1,,percent\n2026-11-01,active_players,12,players";
    a.importCsv(f.p.id, csv, null);
    a.importCsv(f.p.id, csv, null);
    assert.equal(f.s.all("metric").length, 2);
    assert.equal(f.s.all<any>("metric")[0].value, null);
    assert.match(f.s.all<any>("metric")[0].source, /CSV/);
    assert.throws(
      () => a.importCsv(f.p.id, "date,metric,value\n2026-11-01,d1,NaN", null),
      /число/,
    );
  } finally {
    f.close();
  }
});
test("place XML exports nested services, typed properties and escaped source", () => {
  const m = manifest();
  m.instances.push({
    path: "ServerScriptService/Main",
    className: "Script",
    properties: {},
    source: 'if a < b then print("a&b") end',
  });
  const xml = exportPlace(m);
  assert.match(xml, /<Item class="Workspace"/);
  assert.match(xml, /<Vector3 name="Size">/);
  assert.match(xml, /a &lt; b/);
  assert.match(xml, /a&amp;b/);
  assert.doesNotMatch(xml, /undefined/);
});
test("XML enum tokens match verified Studio values without inventing unknown values", () => {
  const m = manifest();
  m.instances[0].properties.Material = {
    type: "Enum",
    value: "Material.Plastic",
  };
  m.instances.push({
    path: "Workspace/PostalRoot",
    className: "Model",
    properties: {
      ModelStreamingMode: {
        type: "Enum",
        value: "ModelStreamingMode.Persistent",
      },
    },
  });
  const xml = exportPlace(m);
  assert.match(xml, /<token name="Material">256<\/token>/);
  assert.match(xml, /<token name="ModelStreamingMode">2<\/token>/);
  m.instances[0].properties.Material = {
    type: "Enum",
    value: "Material.Plastic",
    token: 272,
  };
  assert.throws(() => exportPlace(m), /Неверный XML token/);
  m.instances[0].properties.Material = {
    type: "Enum",
    value: "Unknown.Future",
  };
  assert.throws(() => exportPlace(m), /Неизвестный Enum/);
});
test("retrying a failed Studio check requeues its operation instead of building an empty manifest", async () => {
  const f = fixture();
  try {
    studio(f);
    const t = f.e.task(f.p, {
      title: "test",
      role: "qa",
      kind: "manual-check",
      provider: "studio",
      instructions: "test",
      status: "verifying",
    });
    const c = f.e.queue(f.p, t, "test", {
      versionId: "test-version",
      players: 2,
    });
    c.status = "failed";
    f.s.put("command", c);
    t.status = "queued";
    f.s.put("task", t);
    f.e.setExecution(f.p, "running");
    f.e.lastPoll = Date.now();
    await f.e.tick();
    const current = f.s.all<Command>("command").at(-1)!;
    assert.equal(current.operation, "test");
    assert.notEqual(current.id, c.id);
    assert.equal(current.payload.players, 2);
    assert.equal(f.s.get<any>("task", t.id).status, "verifying");
  } finally {
    f.close();
  }
});
test("an accepted corrected manifest clears the old error and normalizes a redundant matching name", () => {
  const f = fixture();
  try {
    f.e.setExecution(f.p, "running");
    const t = f.e.task(f.p, {
      title: "scene",
      role: "assets",
      kind: "assets",
      scope: ["Workspace"],
      instructions: "test",
      error: "Previous format error",
    });
    const m = manifest();
    m.instances[0].properties.Name = "TestPart";
    acceptReviewed(f.e, t, m);
    assert.equal(f.s.get<any>("task", t.id).error, null);
    assert.equal(
      f.s.get<any>("task", t.id).result.instances[0].properties.Name,
      undefined,
    );
  } finally {
    f.close();
  }
});
test("invalid generated code is corrected automatically and retrying one task preserves its diagnostic", () => {
  const f = fixture();
  try {
    f.e.setExecution(f.p, "running");
    const t = f.e.task(f.p, {
      title: "Native code",
      role: "art",
      kind: "style-preview-draft",
      instructions: "test",
      attempt: 1,
      status: "running",
    });
    const message =
      "Результат не принят: Исходник требует недоступных полномочий: ServerStorage/AutomationTests";
    f.e.fail(t, message);
    assert.equal(f.s.get<any>("task", t.id).status, "queued");
    t.status = "blocked";
    t.error = message;
    f.s.put("task", t);
    const retry = f.e.retryTask(t.id);
    assert.equal(retry.status, "queued");
    assert.equal(retry.error, message);
    retry.attempt = retry.maxAttempts;
    retry.status = "failed";
    f.s.put("task", retry);
    assert.throws(() => f.e.retryTask(t.id), /лимит/);
  } finally {
    f.close();
  }
});

test("model capacity blocks without consuming correction attempts or spinning retries", () => {
  const f = fixture();
  try {
    f.e.setExecution(f.p, "running");
    const t = f.e.task(f.p, {
      title: "Capacity",
      role: "ui",
      kind: "ui",
      instructions: "test",
      status: "running",
      attempt: 3,
      maxAttempts: 3,
    });
    f.e.fail(t, "Selected model is at capacity. Please try a different model.");
    assert.equal(
      f.e.tasks(f.p.id).find((x) => x.id === t.id)?.status,
      "blocked",
    );
    assert.equal(f.e.tasks(f.p.id).find((x) => x.id === t.id)?.attempt, 2);
    assert.equal(f.e.project(f.p.id).execution, "error");
    assert.equal(f.e.retryTask(t.id).status, "queued");
  } finally {
    f.close();
  }
});

test("legacy exhausted capacity task can retry but exhausted validation failure cannot", () => {
  const f = fixture();
  try {
    const t = f.e.task(f.p, {
      title: "Legacy capacity",
      role: "ui",
      kind: "ui",
      instructions: "test",
      status: "failed",
      attempt: 3,
      maxAttempts: 3,
      error: "Selected model is at capacity. Please try a different model.",
    });
    const retried = f.e.retryTask(t.id);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempt, 2);
    assert.equal(retried.maxAttempts, 3);
    const bad = f.e.task(f.p, {
      title: "Invalid",
      role: "ui",
      kind: "ui",
      instructions: "test",
      status: "failed",
      attempt: 3,
      maxAttempts: 3,
      error: "Результат не принят: invalid",
    });
    assert.throws(() => f.e.retryTask(bad.id), /Исчерпан лимит/);
  } finally {
    f.close();
  }
});

test("known enum metadata is corrected from the Studio registry without guessing unknown names", () => {
  const m = manifest();
  m.instances[0].properties.Font = {
    type: "Enum",
    value: "Enum.Font.FredokaOne",
    token: 38,
  };
  m.instances[0].properties.Unknown = {
    type: "Enum",
    value: "Missing.Enum",
    token: 7,
  };
  const changes = normalizeEnumTokens(m);
  assert.deepEqual(changes, [
    {
      path: "Workspace/TestPart",
      property: "Font",
      name: "Font.FredokaOne",
      provided: 38,
      expected: 26,
    },
  ]);
  assert.deepEqual(m.instances[0].properties.Unknown, {
    type: "Enum",
    value: "Missing.Enum",
    token: 7,
  });
  assert.match(exportPlace(m), /<token name="Font">26<\/token>/);
  assert.deepEqual(normalizeEnumTokens(m), []);
});

test("serialization failures consume build attempts and stop at the task limit", () => {
  const f = fixture();
  try {
    f.e.setExecution(f.p, "running");
    const m = manifest();
    m.instances[0].properties.Unsupported = { type: "Unrecognized", value: [] };
    const source = f.e.task(f.p, {
      title: "Source",
      role: "gameplay",
      kind: "gameplay",
      instructions: "fixture",
      status: "succeeded",
      result: m,
    });
    const t = f.e.task(f.p, {
      title: "Build",
      role: "orchestrator",
      kind: "build",
      instructions: "fixture",
      dependencies: [source.id],
      maxAttempts: 2,
    });
    f.e.build(f.e.project(f.p.id), t);
    assert.equal(t.attempt, 1);
    assert.equal(t.status, "dependencies");
    const resolver = f.s.get<any>("task", t.dependencies[0])!;
    resolver.status = "succeeded";
    resolver.result = m;
    f.s.put("task", resolver);
    f.e.build(f.e.project(f.p.id), t);
    assert.equal(t.attempt, 2);
    assert.equal(t.status, "failed");
    assert.equal(f.e.project(f.p.id).execution, "error");
    assert.equal(
      f.e.tasks(f.p.id).filter((x) => x.kind === "integration").length,
      1,
    );
  } finally {
    f.close();
  }
});

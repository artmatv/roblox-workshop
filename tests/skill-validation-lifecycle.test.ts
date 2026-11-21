import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { NativeSpecialist } from "../server/native-specialist.js";
import type { NativeSession } from "../server/native-harness.js";
import { balance, reserve } from "../server/budget.js";
import {
  skillValidationReportPath,
  SKILL_VALIDATION_CHECKS,
  SKILL_VALIDATION_PROFILE,
} from "../shared/skill-validation.js";
import type { Command, Task } from "../shared/domain.js";

function fixture() {
  const root = mkdtempSync(
      resolve(process.cwd(), ".tmp-skill-validation-lifecycle-"),
    ),
    store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex),
    project = engine.createProject({
      name: "Skill validation lifecycle fixture",
      genre: "Simulator",
      goal: "Verify a bounded diagnostics profile without changing the game.",
    });
  project.budget.approved = true;
  project.budget.limitMicros = 10_000;
  project.settings.dailyLimitMicros = 10_000;
  project.studioId = "skill-validation-studio";
  store.put("studio", {
    id: project.studioId,
    projectId: project.id,
    documentId: "skill-validation-document",
    capabilities: ["apply", "test", "capture", "snapshot", "import"],
  });
  for (const name of ["concept", "style", "specification", "budget"])
    project.approvals[name] = {
      hash: engine.approvalHash(project, name),
      revision: project.revision,
      at: new Date().toISOString(),
    };
  engine.save(project);
  return {
    root,
    store,
    engine,
    codex,
    project,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  "base64",
);

function priorSession(f: ReturnType<typeof fixture>) {
  const previousTask = f.engine.task(f.project, {
    title: "Previously accepted task",
    role: "designer",
    kind: "studio-development",
    instructions: "fixture only",
  });
  previousTask.status = "succeeded";
  f.store.put("task", previousTask);
  const session = {
    id: f.project.id,
    taskId: previousTask.id,
    threadId: "prior-owner-thread",
    workspace: resolve(f.root, "prior-workspace"),
    status: "review",
    revision: f.project.revision,
  };
  f.store.put("nativeSession", session);
  return session;
}

function runningValidation(f: ReturnType<typeof fixture>) {
  const sessionBefore = priorSession(f),
    task = f.engine.native.startSkillValidation(f.project);
  assert.equal(task.validationProfile, SKILL_VALIDATION_PROFILE);
  task.status = "running";
  task.attempt = 1;
  task.startedAt = new Date(Date.now() - 10).toISOString();
  task.estimateMicros = 1_000;
  task.requirementsHash = f.engine.taskRequirementsHash(
    f.engine.project(f.project.id),
    task,
  );
  task.reservationId = reserve(f.store, f.engine.project(f.project.id), task);
  f.store.put("task", task);
  f.engine.active.add(task.id);

  const workspace = f.engine.native.session(f.project.id)!.workspace,
    reportPath = resolve(workspace, skillValidationReportPath(task.id)),
    traceRoot = f.engine.native.traceRoot(task);
  mkdirSync(resolve(reportPath, ".."), { recursive: true });
  mkdirSync(traceRoot, { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({
      taskId: task.id,
      attempt: task.attempt,
      profile: SKILL_VALIDATION_PROFILE,
      status: "passed",
      humanListening: "not_run",
      checks: SKILL_VALIDATION_CHECKS.map((id) => ({
        id,
        status: "passed",
        evidence: `fixture evidence for ${id}`,
      })),
      commands: [],
    }),
  );
  const labels = [
    "world-desktop",
    "hud-desktop",
    "shop-desktop",
    "collection-desktop",
    "hud-mobile",
  ];
  const probePath = `SoundService.__SyphoSkillProbe_${task.id.slice(0, 8)}`,
    hostResult = (action: string, extra: Record<string, unknown> = {}) => ({
      profile: SKILL_VALIDATION_PROFILE,
      taskId: task.id,
      attempt: task.attempt,
      action,
      ...extra,
    }),
    probeEvent = (action: string, extra: Record<string, unknown> = {}) => ({
      tool: "probe_sfx",
      success: true,
      taskId: task.id,
      attempt: task.attempt,
      arguments: { action },
      result: hostResult(action, { probePath, ...extra }),
    }),
    controlEvent = (action: string, extra: Record<string, unknown> = {}) => ({
      tool: "validation_control",
      success: true,
      taskId: task.id,
      attempt: task.attempt,
      arguments: { action },
      result: hostResult(action, extra),
    });
  const records: any[] = [
    {
      tool: "search_sfx",
      success: true,
      taskId: task.id,
      attempt: task.attempt,
      candidates: [{ id: 445566, name: "UI click", audioType: "SoundEffect" }],
    },
    controlEvent("before", { fingerprint: "a".repeat(64), count: 27 }),
    probeEvent("create", { createdIds: [445566] }),
    probeEvent("measure", {
      measurements: [{ id: 445566, loaded: true, length: 0.23 }],
    }),
    probeEvent("play", { playedId: 445566 }),
    probeEvent("cleanup", { removed: true, remaining: [] }),
    ...labels
      .filter((label) => label !== "hud-mobile")
      .map((label, index) => ({
        tool: "screen_capture",
        success: true,
        taskId: task.id,
        attempt: task.attempt,
        arguments: { capture_id: label },
        captureRecordId: String(index + 1).padStart(24, "0"),
        captures: [`${label}.png`],
        viewport: { device: "default" },
      })),
    controlEvent("mobile", { device: "iphone_17_pro" }),
    {
      tool: "screen_capture",
      success: true,
      taskId: task.id,
      attempt: task.attempt,
      arguments: { capture_id: "hud-mobile" },
      captureRecordId: "000000000000000000000005",
      captures: ["hud-mobile.png"],
      viewport: { device: "iphone_17_pro" },
    },
    controlEvent("default", { device: "default" }),
    controlEvent("after", {
      fingerprint: "a".repeat(64),
      count: 27,
      scenePreserved: true,
    }),
  ];
  for (const label of labels)
    writeFileSync(resolve(traceRoot, `${label}.png`), tinyPng);
  writeFileSync(
    traceRoot + "/tools.jsonl",
    records.map((r) => JSON.stringify(r)).join("\n"),
  );
  return { task, workspace, sessionBefore, records };
}

test("skill validation start conflicts preserve queued and planned game work, while ordinary native start refuses the diagnostic task", () => {
  for (const status of ["planned", "queued"] as const) {
    const f = fixture();
    try {
      const previous = priorSession(f),
        foreign = f.engine.task(f.project, {
          title: "Existing production work",
          role: "designer",
          kind: "build",
          instructions: "keep this task untouched",
        });
      foreign.status = status;
      f.store.put("task", foreign);
      const before = f.engine.project(f.project.id),
        snapshot = {
          stage: before.stage,
          settings: structuredClone(before.settings),
          approvals: structuredClone(before.approvals),
          revision: before.revision,
          execution: before.execution,
          session: structuredClone(f.store.get("nativeSession", f.project.id)),
        };
      assert.throws(
        () => f.engine.native.startSkillValidation(before),
        /завершите другую работу/,
      );
      const after = f.engine.project(f.project.id);
      assert.equal(f.store.get<Task>("task", foreign.id)?.status, status);
      assert.equal(after.stage, snapshot.stage);
      assert.deepEqual(after.settings, snapshot.settings);
      assert.deepEqual(after.approvals, snapshot.approvals);
      assert.equal(after.revision, snapshot.revision);
      assert.equal(after.execution, snapshot.execution);
      assert.deepEqual(
        f.store.get("nativeSession", f.project.id),
        snapshot.session,
      );
      assert.equal(
        f.store.get<NativeSession>("nativeSession", f.project.id)?.taskId,
        previous.taskId,
      );
    } finally {
      f.close();
    }
  }

  const f = fixture();
  try {
    const diagnostic = f.engine.native.startSkillValidation(f.project);
    assert.throws(
      () => f.engine.native.start(f.engine.project(f.project.id)),
      /проверка навыков/,
    );
    assert.equal(f.store.get<Task>("task", diagnostic.id)?.status, "queued");
    assert.equal(
      f.store.get<NativeSession>("nativeSession", f.project.id)?.taskId,
      diagnostic.id,
    );
  } finally {
    f.close();
  }
});

test("current diagnostic completion accepts only profile evidence and restores project state without production gates", async () => {
  const f = fixture(),
    originalRun = NativeSpecialist.prototype.run;
  let visualReviewCalls = 0;
  NativeSpecialist.prototype.run = async function () {
    visualReviewCalls++;
    throw new Error(
      "diagnostic completion must not invoke production visual review",
    );
  } as any;
  try {
    const p = f.engine.project(f.project.id),
      priorState = {
        stage: p.stage,
        settings: structuredClone(p.settings),
        approvals: structuredClone(p.approvals),
        revision: p.revision,
        execution: p.execution,
        versions: f.engine.versions(p.id).length,
        commands: f.store.all<Command>("command").length,
      },
      { task, sessionBefore } = runningValidation(f);
    assert.equal(
      f.engine.versions(p.id).length,
      0,
      "fixture has no accepted art baseline",
    );
    await f.engine.native.completeSkillValidation(task);
    const saved = f.store.get<Task>("task", task.id)!,
      after = f.engine.project(p.id);
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.error, null);
    assert.equal(saved.result?.instances.length, 0);
    assert.deepEqual(after.stage, priorState.stage);
    assert.deepEqual(after.settings, priorState.settings);
    assert.deepEqual(after.approvals, priorState.approvals);
    assert.equal(after.revision, priorState.revision);
    assert.equal(after.execution, priorState.execution);
    assert.deepEqual(f.store.get("nativeSession", p.id), sessionBefore);
    assert.equal(f.store.get("skillValidationContext", task.id), undefined);
    assert.equal(f.engine.active.has(task.id), false);
    assert.equal(balance(f.store, after).reservedMicros, 0);
    assert.equal(
      f.store.get<any>("skillValidation", task.id)?.attempt,
      task.attempt,
    );
    assert.equal(f.engine.versions(p.id).length, priorState.versions);
    assert.equal(f.store.all<Command>("command").length, priorState.commands);
    assert.equal(f.store.all<any>("nativeVisualReview").length, 0);
    assert.equal(visualReviewCalls, 0);
  } finally {
    NativeSpecialist.prototype.run = originalRun;
    f.close();
  }
});

test("stale attempt completion is inert and canceling a queued diagnostic restores its previous session and releases its reservation", async () => {
  const f = fixture();
  try {
    const { task } = runningValidation(f),
      latest = f.store.get<Task>("task", task.id)!;
    latest.attempt = 2;
    latest.status = "running";
    latest.error = "newer attempt owns task";
    latest.requirementsHash = f.engine.taskRequirementsHash(
      f.engine.project(task.projectId),
      latest,
    );
    f.store.put("task", latest);
    await f.engine.native.completeSkillValidation(task);
    assert.equal(f.store.get<Task>("task", task.id)?.attempt, 2);
    assert.equal(
      f.store.get<Task>("task", task.id)?.error,
      "newer attempt owns task",
    );
    assert.equal(f.store.get<any>("skillValidation", task.id), undefined);
    assert.ok(f.store.get("skillValidationContext", task.id));
    assert.equal(f.engine.active.has(task.id), true);
    assert.equal(
      balance(f.store, f.engine.project(task.projectId)).reservedMicros,
      1_000,
    );

    const g = fixture();
    try {
      const previous = priorSession(g),
        queued = g.engine.native.startSkillValidation(g.project);
      queued.estimateMicros = 1_000;
      queued.reservationId = reserve(
        g.store,
        g.engine.project(g.project.id),
        queued,
      );
      g.store.put("task", queued);
      g.engine.control(g.project.id, "cancel");
      assert.equal(g.store.get<Task>("task", queued.id)?.status, "cancelled");
      assert.equal(g.engine.project(g.project.id).execution, "paused");
      assert.deepEqual(g.store.get("nativeSession", g.project.id), previous);
      assert.equal(g.store.get("skillValidationContext", queued.id), undefined);
      assert.equal(g.engine.active.has(queued.id), false);
      assert.equal(
        balance(g.store, g.engine.project(g.project.id)).reservedMicros,
        0,
      );
    } finally {
      g.close();
    }
  } finally {
    f.close();
  }
});

test("paused completion is not accepted, and project changes during validation are preserved and fail acceptance", async () => {
  const f = fixture();
  try {
    const { task } = runningValidation(f);
    const previousSession = f.store.get<any>(
      "skillValidationContext",
      task.id,
    )?.previousSession;
    f.engine.active.delete(task.id);
    f.engine.control(task.projectId, "pause");
    await f.engine.native.completeSkillValidation(task);
    assert.equal(f.store.get<Task>("task", task.id)?.status, "cancelled");
    assert.equal(f.store.get<any>("skillValidation", task.id), undefined);
    assert.equal(f.store.get("skillValidationContext", task.id), undefined);
    assert.deepEqual(
      f.store.get("nativeSession", task.projectId),
      previousSession,
    );
    assert.equal(f.engine.project(task.projectId).execution, "paused");
    assert.equal(
      balance(f.store, f.engine.project(task.projectId)).reservedMicros,
      0,
    );
    assert.equal(f.engine.active.has(task.id), false);
  } finally {
    f.close();
  }

  for (const changed of ["stage", "settings", "revision"] as const) {
    const g = fixture();
    try {
      const { task, sessionBefore } = runningValidation(g),
        project = g.engine.project(task.projectId);
      if (changed === "stage") project.stage = "review";
      else if (changed === "settings") project.settings.timeoutMinutes++;
      else project.revision++;
      g.engine.save(project);
      const afterUserChange = g.engine.project(project.id),
        changedSnapshot = {
          stage: afterUserChange.stage,
          settings: structuredClone(afterUserChange.settings),
          revision: afterUserChange.revision,
        };
      await g.engine.native.completeSkillValidation(task);
      const completed = g.store.get<Task>("task", task.id)!,
        finalProject = g.engine.project(task.projectId);
      assert.notEqual(completed.status, "succeeded", changed);
      assert.match(completed.error || "", /Состояние проекта изменилось/);
      assert.equal(finalProject.stage, changedSnapshot.stage, changed);
      assert.deepEqual(
        finalProject.settings,
        changedSnapshot.settings,
        changed,
      );
      assert.equal(finalProject.revision, changedSnapshot.revision, changed);
      assert.deepEqual(
        g.store.get("nativeSession", task.projectId),
        sessionBefore,
      );
      assert.equal(g.store.get("skillValidationContext", task.id), undefined);
      assert.equal(g.engine.active.has(task.id), false);
      assert.equal(balance(g.store, finalProject).reservedMicros, 0);
      assert.equal(g.store.get<any>("skillValidation", task.id), undefined);
    } finally {
      g.close();
    }
  }
});

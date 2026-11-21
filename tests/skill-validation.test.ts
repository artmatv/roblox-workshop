import { test } from "node:test";
import assert from "node:assert/strict";
import { hash } from "../server/store.js";
import {
  assertNativeCaptures,
  assertSkillValidationReport,
  assertSkillValidationSfxEvidence,
  nativeToolPermissions,
} from "../server/native-harness.js";
import {
  SKILL_VALIDATION_CHECKS,
  SKILL_VALIDATION_PROFILE,
} from "../shared/skill-validation.js";
import { GAME_LANGUAGE_POLICY } from "../server/game-localization.js";
import type { Task } from "../shared/domain.js";

const task = {
  id: "9c99d860-1420-4ba5-9fd0-663d1bf159ad",
  attempt: 2,
  validationProfile: SKILL_VALIDATION_PROFILE,
} as Task;
const report = () => ({
  taskId: task.id,
  attempt: task.attempt,
  profile: SKILL_VALIDATION_PROFILE,
  status: "passed",
  checks: SKILL_VALIDATION_CHECKS.map((id) => ({
    id,
    status: "passed",
    evidence: "verified",
  })),
});
const captureRecords = () =>
  [
    "world-desktop",
    "hud-desktop",
    "shop-desktop",
    "collection-desktop",
    "hud-mobile",
  ].map((label) => ({
    tool: "screen_capture",
    success: true,
    taskId: task.id,
    attempt: task.attempt,
    arguments: { capture_id: label },
    captures: ["capture.png"],
    viewport: { device: label === "hud-mobile" ? "phone" : "default" },
  }));
const sfxRecords = (): any[] => {
  const control = (action: string, scenePreserved = false) => ({
    tool: "validation_control",
    taskId: task.id,
    attempt: task.attempt,
    success: true,
    arguments: { action },
    result: {
      profile: SKILL_VALIDATION_PROFILE,
      taskId: task.id,
      attempt: task.attempt,
      action,
      fingerprint: "a".repeat(64),
      count: 1,
      scenePreserved,
    },
  });
  const probe = [
    { action: "create", createdIds: [123] },
    {
      action: "measure",
      measurements: [{ id: 123, loaded: true, length: 0.5, role: "ui_click" }],
    },
    { action: "play", playedId: 123 },
    {
      action: "cleanup",
      probePath: `SoundService.__SyphoSkillProbe_${task.id.slice(0, 8)}`,
      removed: true,
      remaining: [],
    },
  ].map((data) => ({
    tool: "probe_sfx",
    taskId: task.id,
    attempt: task.attempt,
    success: true,
    arguments: { action: data.action },
    result: {
      profile: SKILL_VALIDATION_PROFILE,
      taskId: task.id,
      attempt: task.attempt,
      ...data,
    },
  }));
  return [
    control("before"),
    {
      tool: "search_sfx",
      taskId: task.id,
      attempt: task.attempt,
      success: true,
      candidates: [{ id: 123 }],
    },
    ...probe,
    control("mobile"),
    {
      tool: "screen_capture",
      taskId: task.id,
      attempt: task.attempt,
      success: true,
      arguments: { capture_id: "hud-mobile" },
    },
    control("default"),
    control("after", true),
  ];
};

test("skill validation requires all 16 unique passed gates for current task and attempt", () => {
  assert.doesNotThrow(() => assertSkillValidationReport(report(), task));
  const wrong = report();
  wrong.attempt++;
  assert.throws(() => assertSkillValidationReport(wrong, task));
  const duplicate = report();
  duplicate.checks[0].id = duplicate.checks[1].id;
  assert.throws(() => assertSkillValidationReport(duplicate, task));
  const failed = report();
  failed.checks[0].status = "failed";
  assert.throws(() => assertSkillValidationReport(failed, task));
});

test("diagnostic capture evidence succeeds without art or asset baseline", () => {
  assert.equal(
    assertNativeCaptures(captureRecords(), task.attempt, task.id).length,
    5,
  );
  assert.throws(() =>
    assertNativeCaptures(captureRecords().slice(0, 4), task.attempt, task.id),
  );
});

test("SFX host evidence must be current and measurements must match search candidates", () => {
  assert.doesNotThrow(() =>
    assertSkillValidationSfxEvidence(sfxRecords(), task),
  );
  const falseProof = sfxRecords();
  falseProof.find(
    (r) => r.tool === "probe_sfx" && r.arguments?.action === "measure",
  )!.result.measurements = [{ id: 999, loaded: true, length: 1 }];
  assert.throws(() => assertSkillValidationSfxEvidence(falseProof, task));
  assert.throws(() =>
    assertSkillValidationSfxEvidence(
      sfxRecords().map((r) => ({ ...r, attempt: 1 })),
      task,
    ),
  );
});

test("profile tool permissions omit asset generation while normal permissions remain", () => {
  const normal = nativeToolPermissions(true, true),
    validation = nativeToolPermissions(true, true, true);
  assert.ok(normal.draw_icon && normal.generate_mesh && normal.ask_specialist);
  assert.ok(
    validation.probe_sfx &&
      validation.validation_control &&
      validation.screen_capture &&
      validation.start_stop_play &&
      validation.user_mouse_input &&
      validation.user_keyboard_input &&
      validation.character_navigation,
  );
  assert.equal(validation.execute_luau, undefined);
  assert.equal(validation.draw_icon, undefined);
  assert.equal(validation.generate_mesh, undefined);
  assert.equal(validation.ask_specialist, undefined);
  assert.equal(validation.upload_image, undefined);
});

test("normal task requirements hashing remains the legacy calculation", async () => {
  const { Engine } = await import("../server/engine.js");
  const p: any = {
    concept: "c",
    goal: "g",
    genre: "genre",
    requiredChecks: ["a"],
    specification: "s",
    selectedStyle: "style",
    styleVersion: 3,
    skillPins: { a: "h" },
  };
  const t: any = {};
  const fake: any = {
    taskRequirementsHash: Engine.prototype.taskRequirementsHash,
  };
  const actual = fake.taskRequirementsHash(p, t);
  const expected = hash({
    concept: p.concept,
    goal: p.goal,
    genre: p.genre,
    requiredChecks: p.requiredChecks,
    specification: p.specification,
    style: p.selectedStyle,
    styleVersion: p.styleVersion,
    skills: p.skillPins,
    gameLanguage: GAME_LANGUAGE_POLICY,
  });
  assert.equal(actual, expected);
  assert.notEqual(
    actual,
    hash({
      concept: p.concept,
      goal: p.goal,
      genre: p.genre,
      requiredChecks: p.requiredChecks,
      specification: p.specification,
      style: p.selectedStyle,
      styleVersion: p.styleVersion,
      skills: p.skillPins,
      gameLanguage: GAME_LANGUAGE_POLICY,
      validationProfile: SKILL_VALIDATION_PROFILE,
    }),
  );
});

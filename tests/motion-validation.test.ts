import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Engine } from "../server/engine.js";
import { Store } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { nativeToolPermissions } from "../server/native-harness.js";
import { motionProbePhaseAllowed } from "../server/agent-studio-mcp.js";
import type { Task } from "../shared/domain.js";
import {
  assertMotionValidationReport,
  assertMotionValidationEvidence,
  MOTION_VALIDATION_CAPTURE_IDS,
  MOTION_VALIDATION_CHECKS,
  MOTION_VALIDATION_PROMPT,
  MOTION_VALIDATION_PROFILE,
  MOTION_VALIDATION_SKILLS,
  motionValidationReportPath,
  motionValidationExportPaths,
} from "../shared/motion-validation.js";

const task = { id: "9c99d860-1420-4ba5-9fd0-663d1bf159ad", attempt: 2 };
const report = () => ({
  taskId: task.id,
  attempt: task.attempt,
  profile: MOTION_VALIDATION_PROFILE,
  status: "passed",
  checks: MOTION_VALIDATION_CHECKS.map((id) => ({ id, status: "passed", evidence: "verified" })),
});

function hostRecord(action: string, result: Record<string, unknown>) {
  return { tool: "motion_probe", success: true, taskId: task.id, attempt: task.attempt, arguments: { action }, result: { profile: MOTION_VALIDATION_PROFILE, taskId: task.id, attempt: task.attempt, action, ...result } };
}
function evidenceRecords() {
  const digest = "a".repeat(64);
  const exports = motionValidationExportPaths(task.id);
  const capture = (id: string, camera: number[], target: number[]) => ({ tool: "screen_capture", success: true, taskId: task.id, attempt: task.attempt, arguments: { capture_id: id, camera_position: camera, look_at_position: target }, captures: ["capture.png"] });
  const records: any[] = [
    { tool: "validation_control", success: true, taskId: task.id, attempt: task.attempt, arguments: { action: "before" }, result: { profile: MOTION_VALIDATION_PROFILE, taskId: task.id, attempt: task.attempt, fingerprint: digest, count: 3 } },
    { tool: "start_stop_play", success: true, taskId: task.id, attempt: task.attempt, arguments: { is_start: true }, ownedStart: true, playModeBefore: "Edit", playModeAfter: "Play" },
    { ...hostRecord("create", { verifiedArtifacts: true, trustedExports: { animation: { sha256: digest }, mesh: { sha256: digest }, vfx: { sha256: digest } } }), arguments: { action: "create", ...exports } },
    hostRecord("pose_rest", { trackPlaying: true, frame: { cameraPosition: [0, 103, 15], lookAtPosition: [0, 101, 0] } }),
    capture("animation-rest", [0, 103, 15], [0, 101, 0]),
    hostRecord("pose_action", { trackPlaying: true, jointChanged: true, frame: { cameraPosition: [0, 103, 15], lookAtPosition: [0, 101, 0] } }),
    capture("animation-action", [0, 103, 15], [0, 101, 0]),
    hostRecord("mesh_sample", { className: "MeshPart", vertexCount: 8, triangleCount: 12, frame: { cameraPosition: [8, 104, 12], lookAtPosition: [4, 100.15, 0] } }),
    capture("mesh-preview", [8, 104, 12], [4, 100.15, 0]),
    hostRecord("vfx", { emitterClass: "ParticleEmitter", emitted: true, propertiesVerified: true, frame: { cameraPosition: [-4, 103, 12], lookAtPosition: [-4, 100, 0] } }),
    capture("vfx-preview", [-4, 103, 12], [-4, 100, 0]),
  ];
  records.push(hostRecord("cleanup", { removed: true, verifiedAbsent: true, studioMode: "Play", remaining: [] }));
  records.push({ tool: "start_stop_play", success: true, taskId: task.id, attempt: task.attempt, arguments: { is_start: false }, playModeBefore: "Play", playModeAfter: "Edit" });
  records.push({ tool: "validation_control", success: true, taskId: task.id, attempt: task.attempt, arguments: { action: "after" }, result: { profile: MOTION_VALIDATION_PROFILE, taskId: task.id, attempt: task.attempt, fingerprint: digest, count: 3, scenePreserved: true } });
  for (const action of ["runtime", "mesh", "texture", "animation"])
    records.push({ tool: "blender_command", success: true, taskId: task.id, attempt: task.attempt, arguments: { action }, result: { action, status: "passed", exitCode: 0, version: "5.2.3", sourceSha256: digest, outputSha256: digest, processId: 1234, outputs: [{ sha256: digest }] } });
  return records;
}

test("motion report pins a distinct exact profile and rejects missing/duplicate/tampered gates", () => {
  assert.equal(motionValidationReportPath(task.id), `reports/sypho-motion-${task.id}/report.json`);
  assert.equal(MOTION_VALIDATION_SKILLS.length, 3);
  assert.equal(new Set(MOTION_VALIDATION_CHECKS).size, 16);
  const permissions = nativeToolPermissions(false, false, true, MOTION_VALIDATION_PROFILE);
  assert.ok("motion_probe" in permissions);
  assert.ok(!("blender_probe" in permissions));
  assert.ok("validation_control" in permissions);
  assert.ok(!("execute_luau" in permissions));
  assert.ok(!("search_sfx" in permissions));
  assert.doesNotThrow(() => assertMotionValidationReport(report(), task));
  assert.throws(() => assertMotionValidationReport({ ...report(), profile: "sypho-skills" }, task));
  assert.throws(() => assertMotionValidationReport({ ...report(), checks: report().checks.slice(1) }, task));
  const tampered = report(); tampered.checks[0]!.status = "blocked";
  assert.throws(() => assertMotionValidationReport(tampered, task));
});

test("motion phase guard allows cleanup after a failed create without relaxing probe order", () => {
  assert.equal(motionProbePhaseAllowed("create", "idle"), true);
  assert.equal(motionProbePhaseAllowed("cleanup", "idle"), true);
  assert.equal(motionProbePhaseAllowed("cleanup", "created"), true);
  assert.equal(motionProbePhaseAllowed("pose_rest", "created"), true);
  assert.equal(motionProbePhaseAllowed("pose_rest", "idle"), false);
  assert.equal(motionProbePhaseAllowed("pose_action", "created"), false);
  assert.equal(motionProbePhaseAllowed("unknown", "idle"), false);
});

test("motion export instructions pin the animation and GLB exporter commands", () => {
  assert.match(MOTION_VALIDATION_PROMPT, /resources\/scripts\/to_roblox\.py/);
  assert.match(MOTION_VALIDATION_PROMPT, /--folder ReplicatedStorage\.__SyphoMotionDiagnostic_Anims --no-verify/);
  assert.match(MOTION_VALIDATION_PROMPT, /resources\/scripts\/glb_tool\.py.*measure --glb.*--json/);
  assert.match(MOTION_VALIDATION_PROMPT, /C:\/Python312\/python\.exe/);
  assert.match(MOTION_VALIDATION_PROMPT, /validation-inputs\/dcc\/attempt-<attempt>\/commands\.json/);
});

test("motion host evidence requires actual movement, mesh, VFX, cleanup, captures and preserved scene", () => {
  assert.doesNotThrow(() => assertMotionValidationEvidence(evidenceRecords(), task));
  const fakeMovement = evidenceRecords();
  fakeMovement.find((r) => r.tool === "motion_probe" && r.arguments.action === "pose_action")!.result.jointChanged = false;
  assert.throws(() => assertMotionValidationEvidence(fakeMovement, task), /суставов/);
  const fakeMesh = evidenceRecords();
  fakeMesh.find((r) => r.tool === "motion_probe" && r.arguments.action === "mesh_sample")!.result.className = "Part";
  assert.throws(() => assertMotionValidationEvidence(fakeMesh, task), /MeshPart/);
  const noCleanup = evidenceRecords().filter((r) => !(r.tool === "motion_probe" && r.arguments.action === "cleanup"));
  assert.throws(() => assertMotionValidationEvidence(noCleanup, task));
});

test("motion validation starts with only its three added pins and restores the prior session when cancelled", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-motion-validation-")), store = new Store(root), engine = new Engine(store, new Codex());
  try {
    const project = engine.createProject({ name: "Motion validation", genre: "Simulator", goal: "Check animation, geometry and VFX." });
    project.budget.approved = true; project.budget.limitMicros = 10_000; project.settings.dailyLimitMicros = 10_000;
    project.studioId = "motion-studio";
    store.put("studio", { id: project.studioId, projectId: project.id, documentId: "motion-document", capabilities: ["apply", "test", "capture", "snapshot", "import"] });
    for (const name of ["concept", "style", "specification", "budget"]) project.approvals[name] = { hash: engine.approvalHash(project, name), revision: project.revision, at: new Date().toISOString() };
    engine.save(project);
    const originalPins = { ...project.skillPins };
    const previous = engine.task(project, { title: "Prior session", role: "designer", kind: "studio-development", instructions: "fixture" });
    previous.status = "succeeded"; store.put("task", previous);
    store.put("nativeSession", { id: project.id, taskId: previous.id, threadId: "prior", workspace: resolve(root, "prior"), status: "review", revision: project.revision });
    const motion = engine.native.startSkillValidation(project, MOTION_VALIDATION_PROFILE);
    assert.equal(motion.validationProfile, MOTION_VALIDATION_PROFILE);
    assert.equal(store.get<any>("nativeSession", project.id).workspace, resolve(root, "motion-work", motion.id));
    assert.deepEqual(motion.skills.map((s) => s.id).sort(), [...MOTION_VALIDATION_SKILLS].sort());
    assert.ok(Object.entries(originalPins).every(([id, hash]) => project.skillPins[id] === hash));
    assert.match(motion.instructions, /не запускай произвольный execute_luau/i);
    motion.status = "cancelled"; store.put("task", motion);
    engine.native.restoreSkillValidation(motion);
    assert.equal(store.get<any>("nativeSession", project.id).taskId, previous.id);
    assert.equal(store.get<any>("skillValidationContext", motion.id), undefined);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

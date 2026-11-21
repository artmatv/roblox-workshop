import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { prepareMotionDccPlan, verifyMotionDccJournal, type MotionDccPlan } from "../server/blender-evidence.js";

const taskId = "task-motion-001";
const attempt = 3;
const fixtureNames = ["runtime_probe.py", "mesh_verify_probe.py", "texture_verify_probe.py", "animation_render_probe.py", "build_fk_animation_fixture.py", "fk_pose_spec.json"];
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function makeCase() {
  const root = mkdtempSync(resolve(tmpdir(), "dcc-journal-test-"));
  const workspace = resolve(root, "workspace"), fixtureRoot = resolve(root, "fixtures"), traceRoot = resolve(root, "trace");
  mkdirSync(fixtureRoot, { recursive: true });
  for (const name of fixtureNames) writeFileSync(resolve(fixtureRoot, name), `fixture:${name}`);
  const blenderPath = resolve(workspace, "bin/blender"), installedBlenderPath = resolve(root, "installed/blender");
  mkdirSync(dirname(blenderPath), { recursive: true }); mkdirSync(dirname(installedBlenderPath), { recursive: true });
  writeFileSync(blenderPath, "blender-test-binary"); writeFileSync(installedBlenderPath, "blender-test-binary");
  const activeSkills = [
    { id: "sypho-roblox-animation", root: "skills/animation", files: [{ path: "resources/scripts/anim_render.py", hash: "" }] },
    { id: "sypho-roblox-3d-model", root: "skills/model", files: [{ path: "resources/scripts/verify.py", hash: "" }, { path: "resources/scripts/verify_texture.py", hash: "" }] },
  ];
  for (const skill of activeSkills) for (const file of skill.files) {
    const path = resolve(workspace, skill.root, file.path); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `pinned:${file.path}`); file.hash = sha(readFileSync(path));
  }
  mkdirSync(workspace, { recursive: true });
  const plan = prepareMotionDccPlan({ workspace, traceRoot, taskId, attempt, blenderPath, installedBlenderPath, activeSkills, fixtureRoot }) as MotionDccPlan;
  return { root, workspace, plan, close: () => rmSync(root, { recursive: true, force: true }) };
}

function put(root: string, rel: string, contents: string) {
  const path = resolve(root, rel); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); return path;
}
function outerCommand(command: string) {
  const quote = (value: string) => `"${value.replace(/["\\$`]/g, "\\$&")}"`;
  return `${quote("/usr/bin/pwsh")} -Command ${quote(command)}`;
}
function outerCommandSingle(command: string) {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return `${quote("/usr/bin/pwsh")} -Command ${quote(command)}`;
}
function archivedWindowsCommand(command: string) {
  const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return `${quote("C:\\Users\\matve\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe")} -Command ${quote(command)}`;
}
function validJournal(c: ReturnType<typeof makeCase>, blenderVersion = "5.2.3") {
  const { plan, workspace } = c;
  const items = plan.commands.map((planned, index) => {
    let evidence: any, extra = "";
    if (planned.action === "runtime") evidence = { kind: "runtime", blenderVersion, blenderBinary: plan.blenderPath };
    if (planned.action === "mesh") {
      extra = "[verify] 19/19 checks passed\n";
      const artifacts = [
        ["report.json", "mesh report"], ["low.glb", "mesh binary"], ["normal.png", "normal map"],
      ].map(([name, contents]) => {
        const path = put(workspace, `${planned.outputDirectory}/artifacts/${name}`, contents!);
        const bytes = readFileSync(path);
        return { name, bytes: bytes.length, sha256: sha(bytes) };
      });
      evidence = { kind: "mesh", checks: "19/19", artifacts };
    }
    if (planned.action === "texture") {
      extra = "9/9 checks passed\n";
      const artifacts = [
        ["report.json", "texture report"], ["color.png", "color map"], ["paint_report.json", "paint report"],
      ].map(([name, contents]) => {
        const path = put(workspace, `${planned.outputDirectory}/artifacts/${name}`, contents!);
        const bytes = readFileSync(path);
        return { name, bytes: bytes.length, sha256: sha(bytes) };
      });
      evidence = { kind: "texture", checks: "9/9", artifacts };
    }
    if (planned.action === "animation") {
      const frameA = put(workspace, `${planned.outputDirectory}/frame-01.png`, "decoded pose one"), frameB = put(workspace, `${planned.outputDirectory}/frame-02.png`, "decoded pose two"), sheet = put(workspace, `${planned.outputDirectory}/contact.png`, "contact sheet");
      evidence = { kind: "animation", frames: [frameA, frameB].map((path) => ({ path, sha256: sha(readFileSync(path)) })), contactSheet: { path: sheet, sha256: sha(readFileSync(sheet)) } };
    }
    return { type: "commandExecution", status: "completed", command: outerCommand(planned.command), exitCode: 0, cwd: workspace, processId: 100 + index, startedAtMs: 1000 + index * 10, completedAtMs: 1005 + index * 10, aggregatedOutput: `${extra}WORKSHOP_DCC_EVIDENCE=${JSON.stringify(evidence)}\n` };
  });
  return { thread: { turns: [{ id: "turn-current", items }] }, turnId: "turn-current", taskId, attempt, workspace, plan };
}
function verify(c: ReturnType<typeof makeCase>, input: any = validJournal(c)) {
  return verifyMotionDccJournal({ thread: input.thread, turnId: input.turnId, plan: input.plan, taskId: input.taskId, attempt: input.attempt, workspace: input.workspace });
}

test("prepareMotionDccPlan copies six fixtures, pins ACTIVE hashes, and scopes outputs and plan to the attempt", () => {
  const c = makeCase();
  try {
    assert.equal(c.plan.attempt, attempt);
    assert.equal(c.plan.commands.length, 4);
    assert.equal(c.plan.inputs.filter((file) => file.path.startsWith(`validation-inputs/dcc/attempt-${attempt}/`)).length, 6);
    assert.ok(c.plan.inputs.some((file) => file.path.endsWith("resources/scripts/verify.py")));
    assert.ok(c.plan.commands.every((command) => command.outputDirectory.includes(`/attempt-${attempt}/`)));
    const saved = JSON.parse(readFileSync(resolve(c.root, "trace", `blender-command-plan-${attempt}.json`), "utf8"));
    assert.deepEqual(saved.commands.map((command: any) => command.action), ["runtime", "mesh", "texture", "animation"]);
    assert.equal(readFileSync(resolve(c.workspace, `validation-inputs/dcc/attempt-${attempt}/fk_pose_spec.json`), "utf8"), "fixture:fk_pose_spec.json");
  } finally { c.close(); }
});

test("journal verifier accepts four exact current-turn executions with real outputs and hashes", () => {
  const c = makeCase();
  try {
    const journal = validJournal(c);
    // POSIX shell's standard close/escape/reopen sequence preserves the exact PowerShell body.
    (journal.thread.turns[0]!.items[2] as any).command = outerCommandSingle(c.plan.commands[2]!.command);
    // Archived commandExecution text doubles Windows path separators inside its outer double quotes.
    (journal.thread.turns[0]!.items[3] as any).command = archivedWindowsCommand(c.plan.commands[3]!.command);
    const records = verify(c, journal);
    assert.deepEqual(records.map((record) => record.result.action), ["runtime", "mesh", "texture", "animation"]);
    assert.ok(records.every((record) => record.tool === "blender_command" && record.success && record.result.status === "passed"));
    assert.ok(records.every((record) => record.result.processId && record.result.sourceSha256 && record.result.outputSha256 && record.result.outputs.length));
    assert.deepEqual(records.find((record) => record.result.action === "mesh")?.result.outputs.map((file: any) => file.path.split("/").slice(-2).join("/")), ["artifacts/report.json", "artifacts/low.glb", "artifacts/normal.png"]);
    assert.deepEqual(records.find((record) => record.result.action === "texture")?.result.outputs.map((file: any) => file.path.split("/").slice(-2).join("/")), ["artifacts/report.json", "artifacts/color.png", "artifacts/paint_report.json"]);
    assert.equal(records.find((record) => record.result.action === "runtime")?.result.version, "5.2.3");
    assert.equal(records.find((record) => record.result.action === "animation")?.result.outputs.length, 3);
  } finally { c.close(); }
});

test("journal verifier rejects missing or mismatched copied mesh artifacts", () => {
  const c = makeCase();
  try {
    const good = validJournal(c), mesh = c.plan.commands.find((command) => command.action === "mesh")!;
    rmSync(resolve(c.workspace, mesh.outputDirectory, "artifacts", "low.glb"));
    assert.throws(() => verify(c, good), /Mesh verifier output is missing/);
  } finally { c.close(); }
  const d = makeCase();
  try {
    const bad = validJournal(d), item = bad.thread.turns[0]!.items[1] as any;
    const evidence = JSON.parse(item.aggregatedOutput.split("WORKSHOP_DCC_EVIDENCE=")[1]);
    evidence.artifacts[0].sha256 = "0".repeat(64);
    item.aggregatedOutput = `[verify] 19/19 checks passed\nWORKSHOP_DCC_EVIDENCE=${JSON.stringify(evidence)}\n`;
    assert.throws(() => verify(d, bad), /copied artifact hash\/size mismatch/);
  } finally { d.close(); }
});

test("runtime verifier accepts Blender 5.2.3 LTS and records its normalized version", () => {
  const c = makeCase();
  try {
    const records = verify(c, validJournal(c, "5.2.3 LTS"));
    assert.equal(records[0]!.result.version, "5.2.3");
    assert.throws(() => verify(c, validJournal(c, "5.2.4")), /runtime identity\/version mismatch/);
  } finally { c.close(); }
});

test("journal verifier rejects another turn, task, or attempt and nested command-shaped tool output", () => {
  const c = makeCase();
  try {
    const good = validJournal(c);
    assert.throws(() => verify(c, { ...good, turnId: "other-turn" }));
    assert.throws(() => verify(c, { ...good, taskId: "other-task" }));
    assert.throws(() => verify(c, { ...good, attempt: attempt + 1 }));
    const nested = { ...good, thread: { turns: [{ id: "turn-current", items: good.thread.turns[0]!.items.map((item: any) => ({ type: "toolResult", result: { type: "commandExecution", ...item } })) }] } };
    assert.throws(() => verify(c, nested));
    const wrongPlan = { ...good, plan: { ...good.plan, attempt: attempt + 1 } };
    assert.throws(() => verify(c, wrongPlan));
  } finally { c.close(); }
});

test("journal verifier requires exact shell argv, full untruncated success, and genuine verifier summaries", () => {
  const c = makeCase();
  try {
    const good = validJournal(c), items = good.thread.turns[0]!.items;
    const alter = (index: number, patch: Record<string, unknown>) => ({ ...good, thread: { turns: [{ id: "turn-current", items: items.map((item: any, i: number) => i === index ? { ...item, ...patch } : item) }] } });
    assert.throws(() => verify(c, alter(0, { command: `${items[0]!.command} ; echo forged` })));
    assert.throws(() => verify(c, alter(0, { command: items[0]!.command.replace("pwsh", "pwsh-extra") })));
    assert.throws(() => verify(c, alter(1, { aggregatedOutput: "WORKSHOP_DCC_EVIDENCE={\"kind\":\"mesh\",\"checks\":\"19/19\"}" })));
    assert.throws(() => verify(c, alter(1, { aggregatedOutput: "[verify] 18/19 checks passed\nWORKSHOP_DCC_EVIDENCE={\"kind\":\"mesh\",\"checks\":\"19/19\"}" })));
    assert.throws(() => verify(c, alter(0, { exitCode: 1 })));
    assert.throws(() => verify(c, alter(0, { status: "failed" })));
    assert.throws(() => verify(c, alter(0, { outputTruncated: true })));
    assert.throws(() => verify(c, alter(0, { aggregatedOutput: "output truncated" })));
  } finally { c.close(); }
});

test("journal verifier rejects stale/mutated pins, changed binary, and mismatched animation hashes", () => {
  const c = makeCase();
  try {
    const good = validJournal(c), pinned = c.plan.inputs.find((file) => file.path.endsWith("resources/scripts/verify.py"))!;
    writeFileSync(resolve(c.workspace, pinned.path), "mutated resource");
    assert.throws(() => verify(c, good), /changed/);
  } finally { c.close(); }
  const d = makeCase();
  try {
    const good = validJournal(d), fixture = d.plan.inputs.find((file) => file.path.endsWith("runtime_probe.py"))!;
    writeFileSync(resolve(d.workspace, fixture.path), "stale attempt fixture");
    assert.throws(() => verify(d, good), /changed/);
  } finally { d.close(); }
  const e = makeCase();
  try {
    const good = validJournal(e); writeFileSync(e.plan.blenderPath, "replaced binary");
    assert.throws(() => verify(e, good), /executable changed/);
  } finally { e.close(); }
  const f = makeCase();
  try {
    const good = validJournal(f), animation = good.thread.turns[0]!.items[3] as any;
    const evidence = JSON.parse(animation.aggregatedOutput.split("WORKSHOP_DCC_EVIDENCE=")[1]); evidence.frames[0].sha256 = "0".repeat(64);
    animation.aggregatedOutput = `WORKSHOP_DCC_EVIDENCE=${JSON.stringify(evidence)}`;
    assert.throws(() => verify(f, good), /artifact hash/);
  } finally { f.close(); }
});

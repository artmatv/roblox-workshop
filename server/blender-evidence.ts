import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const FIXTURES = ["runtime_probe.py", "mesh_verify_probe.py", "texture_verify_probe.py", "animation_render_probe.py", "build_fk_animation_fixture.py", "fk_pose_spec.json"] as const;
const ACTIONS = ["runtime", "mesh", "texture", "animation"] as const;
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hashFile = (path: string) => sha(readFileSync(path));
const ps = (value: string) => `'${value.replace(/'/g, "''")}'`;

export type MotionDccPlan = {
  taskId: string;
  attempt: number;
  blenderPath: string;
  installedBlenderPath: string;
  installedBlenderSha256: string;
  blenderSha256: string;
  commands: Array<{ action: string; command: string; outputDirectory: string; inputs: Array<{ path: string; sha256: string }> }>;
  inputs: Array<{ path: string; sha256: string }>;
};

export function prepareMotionDccPlan(input: { workspace: string; traceRoot: string; taskId: string; attempt: number; blenderPath: string; installedBlenderPath: string; activeSkills: any[]; fixtureRoot: string }) {
  const workspace = resolve(input.workspace), traceRoot = resolve(input.traceRoot), blenderPath = resolve(input.blenderPath), installedBlenderPath = resolve(input.installedBlenderPath);
  const safe = (path: string) => {
    const rel = relative(workspace, resolve(path));
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("DCC plan path escaped workspace");
    return resolve(path);
  };
  const inputDir = resolve(workspace, `validation-inputs/dcc/attempt-${input.attempt}`);
  mkdirSync(inputDir, { recursive: true });
  const inputs: Array<{ path: string; sha256: string }> = [];
  for (const name of FIXTURES) {
    const source = resolve(input.fixtureRoot, name), target = resolve(inputDir, name);
    if (existsSync(target) || lstatSync(dirname(target)).isSymbolicLink()) throw new Error("DCC fixture destination is unsafe or already exists");
    copyFileSync(source, target);
    inputs.push({ path: relative(workspace, target).replaceAll("\\", "/"), sha256: hashFile(target) });
  }
  const pinnedInputs: Array<{ path: string; sha256: string }> = [];
  for (const skillId of ["sypho-roblox-animation", "sypho-roblox-3d-model"]) {
    const active = input.activeSkills.find((item) => item.id === skillId);
    if (!active?.root || !Array.isArray(active.files)) throw new Error(`Missing active pinned resource root: ${skillId}`);
    for (const file of active.files.filter((item: any) => typeof item.path === "string" && item.path.startsWith("resources/"))) {
      const rel = file.path;
      const absolute = resolve(workspace, active.root, ...rel.split("/"));
      if (!absolute.startsWith(resolve(workspace, active.root) + sep) || !statSync(absolute).isFile()) throw new Error("Pinned DCC source path is unsafe");
      const actualHash = hashFile(absolute);
      if (actualHash !== file.hash) throw new Error(`Pinned DCC resource hash differs from ACTIVE.json: ${rel}`);
      pinnedInputs.push({ path: relative(workspace, absolute).replaceAll("\\", "/"), sha256: actualHash });
    }
  }
  const blenderSha256 = hashFile(blenderPath);
  const installedBlenderSha256 = hashFile(installedBlenderPath);
  if (blenderSha256 !== installedBlenderSha256) throw new Error("Task-local Blender copy differs from the installed executable");
  const base = resolve(workspace, `reports/sypho-motion-${input.taskId}/dcc/attempt-${input.attempt}`);
  const animationRoot = resolve(workspace, input.activeSkills.find((item) => item.id === "sypho-roblox-animation")?.root || "");
  const modelRoot = resolve(workspace, input.activeSkills.find((item) => item.id === "sypho-roblox-3d-model")?.root || "");
  const commands: MotionDccPlan["commands"] = [];
  const make = (action: typeof ACTIONS[number], wrapper: string, args: string[]) => {
    const out = resolve(base, action);
    if (existsSync(out)) throw new Error("DCC output directory already exists");
    mkdirSync(out, { recursive: true });
    const wrapperPath = resolve(inputDir, wrapper);
    const command = `& ${ps(blenderPath)} --background --factory-startup --offline-mode --disable-autoexec --python-exit-code 1 --python ${ps(wrapperPath)}${args.length ? ` -- ${args.map(ps).join(" ")}` : ""}`;
    commands.push({ action, command, outputDirectory: relative(workspace, out).replaceAll("\\", "/"), inputs: [...pinnedInputs, ...inputs] });
  };
  make("runtime", "runtime_probe.py", []);
  make("mesh", "mesh_verify_probe.py", [resolve(workspace, modelRoot, "resources/scripts/verify.py"), resolve(base, "mesh")]);
  make("texture", "texture_verify_probe.py", [resolve(workspace, modelRoot, "resources/scripts/verify_texture.py"), resolve(base, "texture")]);
  make("animation", "animation_render_probe.py", [resolve(inputDir, "build_fk_animation_fixture.py"), resolve(workspace, animationRoot, "resources/scripts/anim_render.py"), resolve(inputDir, "fk_pose_spec.json"), resolve(base, "animation")]);
  const plan: MotionDccPlan = { taskId: input.taskId, attempt: input.attempt, blenderPath, blenderSha256, installedBlenderPath, installedBlenderSha256, commands, inputs: [...pinnedInputs, ...inputs] };
  const privatePlan = resolve(traceRoot, `blender-command-plan-${input.attempt}.json`);
  if (existsSync(privatePlan)) throw new Error("Private DCC command plan already exists");
  mkdirSync(dirname(privatePlan), { recursive: true });
  writeFileSync(privatePlan, JSON.stringify(plan, null, 2), { flag: "wx" });
  writeFileSync(resolve(inputDir, "commands.json"), JSON.stringify(commands.map(({ action, command, outputDirectory }) => ({ action, command, outputDirectory })), null, 2), { flag: "wx" });
  return plan;
}

function parseShellWords(command: string): string[] | null {
  const out: string[] = []; let token = "", quote: "'" | '"' | null = null, escaped = false, active = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (escaped) { token += c; escaped = false; active = true; continue; }
    if (quote === "'") { if (c === "'") quote = null; else token += c; active = true; continue; }
    if (quote === '"') { if (c === '"') quote = null; else if (c === "\\" && ['"', "\\", "$", "`"].includes(command[i + 1] || "")) escaped = true; else token += c; active = true; continue; }
    if (c === "\\") { escaped = true; active = true; continue; }
    if (c === "'" || c === '"') { quote = c; active = true; continue; }
    if (/\s/.test(c)) { if (active) { out.push(token); token = ""; active = false; } continue; }
    token += c; active = true;
  }
  if (escaped || quote) return null;
  if (active) out.push(token);
  return out;
}

export function verifyMotionDccJournal(input: { thread: any; turnId: string; plan: MotionDccPlan; taskId: string; attempt: number; workspace: string }) {
  if (input.plan.taskId !== input.taskId || input.plan.attempt !== input.attempt || !input.turnId) throw new Error("DCC command plan is for another task/attempt");
  const turns = input.thread?.thread?.turns || input.thread?.turns || [];
  const turn = turns.find((item: any) => item.id === input.turnId || item.turnId === input.turnId);
  if (!turn) throw new Error("Current Codex turn is missing from the read-only journal");
  const items: any[] = Array.isArray(turn.items) ? turn.items.filter((item: any) => item && (item.type === "commandExecution" || item.type === "command_execution")) : [];
  const results: any[] = []; let runtimeVersion = "";
  for (let index = 0; index < ACTIONS.length; index++) {
    const planned = input.plan.commands[index]!;
    const matches = items.filter((item) => item.status === "completed" && typeof item.command === "string" && item.exitCode === 0);
    const item = matches.find((candidate) => {
      const argv = parseShellWords(candidate.command);
      return argv?.length === 3 && /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(argv[0]!) && argv[1] === "-Command" && argv[2] === planned.command;
    });
    if (!item) throw new Error(`Текущий turn не содержит точный завершённый DCC запуск ${planned.action}`);
    if (item.cwd && resolve(item.cwd) !== resolve(input.workspace)) throw new Error(`DCC command cwd mismatch: ${planned.action}`);
    const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : typeof item.output === "string" ? item.output : "";
    if (!output || item.outputTruncated === true || item.truncated === true || /output (?:was )?truncated/i.test(output)) throw new Error(`Нет полного stdout DCC запуска ${planned.action}`);
    const evidenceLine = output.split(/\r?\n/).find((line: string) => line.startsWith("WORKSHOP_DCC_EVIDENCE="));
    if (!evidenceLine) throw new Error(`Нет DCC evidence stdout для ${planned.action}`);
    let evidence: any; try { evidence = JSON.parse(evidenceLine.slice("WORKSHOP_DCC_EVIDENCE=".length)); } catch { throw new Error("Повреждён DCC stdout evidence"); }
    const base = resolve(input.workspace, planned.outputDirectory), outputs: any[] = [];
    const verifyCopiedArtifacts = (names: string[], kind: string) => {
      const artifactRoot = resolve(base, "artifacts");
      if (!artifactRoot.startsWith(base + sep) || !base.startsWith(resolve(input.workspace) + sep) || !Array.isArray(evidence.artifacts) || evidence.artifacts.length !== names.length) throw new Error(`${kind} verifier workspace or artifact evidence is invalid`);
      const declared = new Map<string, any>();
      for (const item of evidence.artifacts) if (item && typeof item.name === "string" && !declared.has(item.name)) declared.set(item.name, item);
      if (declared.size !== names.length || names.some((name) => !declared.has(name))) throw new Error(`${kind} verifier artifact list does not match its fixed outputs`);
      for (const name of names) {
        const path = resolve(artifactRoot, name), metadata = declared.get(name);
        if (!path.startsWith(artifactRoot + sep) || !existsSync(path) || !statSync(path).isFile()) throw new Error(`${kind} verifier output is missing`);
        const bytes = statSync(path).size, sha256 = hashFile(path);
        if (metadata.bytes !== bytes || metadata.sha256 !== sha256) throw new Error(`${kind} verifier copied artifact hash/size mismatch`);
        outputs.push({ path: relative(input.workspace, path).replaceAll("\\", "/"), sha256, bytes });
      }
    };
    if (planned.action === "runtime") {
      if (evidence.kind !== "runtime" || !/^5\.2\.3(?:\s+LTS)?$/.test(evidence.blenderVersion) || resolve(evidence.blenderBinary) !== input.plan.blenderPath) throw new Error("Blender runtime identity/version mismatch");
      runtimeVersion = "5.2.3";
      outputs.push({ path: relative(input.workspace, input.plan.blenderPath).replaceAll("\\", "/"), sha256: hashFile(input.plan.blenderPath), bytes: statSync(input.plan.blenderPath).size });
    } else if (planned.action === "mesh") {
      if (evidence.kind !== "mesh" || evidence.checks !== "19/19" || !/\[verify\]\s+19\/19 checks passed/.test(output) || /\[verify\]\s+\d+\/19 checks passed/.test(output) === false || /FAILED:|\bFAIL\b/.test(output)) throw new Error("Pinned Blender mesh verifier did not report its genuine 19/19 passing summary");
      verifyCopiedArtifacts(["report.json", "low.glb", "normal.png"], "Mesh");
    } else if (planned.action === "texture") {
      if (evidence.kind !== "texture" || evidence.checks !== "9/9" || !/\b9\/9 checks passed/.test(output) || /\b\d+\/9 checks passed/.test(output) === false || /\bFAIL\b/.test(output)) throw new Error("Pinned Blender texture verifier did not report its genuine 9/9 passing summary");
      verifyCopiedArtifacts(["report.json", "color.png", "paint_report.json"], "Texture");
    }
    else if (planned.action === "animation") {
      if (evidence.kind !== "animation" || !Array.isArray(evidence.frames) || evidence.frames.length < 2 || new Set(evidence.frames.map((f: any) => f.sha256)).size < 2) throw new Error("Animation render lacks distinct decoded pose frames");
      for (const frame of evidence.frames) {
        const path = resolve(frame.path);
        if (!path.startsWith(base + sep) || !statSync(path).isFile() || hashFile(path) !== frame.sha256) throw new Error("Animation frame artifact hash/path mismatch");
        outputs.push({ path: relative(input.workspace, path).replaceAll("\\", "/"), sha256: hashFile(path), bytes: statSync(path).size });
      }
      const sheet = evidence.contactSheet;
      if (!sheet) throw new Error("Animation contact sheet evidence is missing");
      const sheetPath = resolve(sheet.path);
      if (!sheetPath.startsWith(base + sep) || hashFile(sheetPath) !== sheet.sha256) throw new Error("Animation contact sheet hash/path mismatch");
      outputs.push({ path: relative(input.workspace, sheetPath).replaceAll("\\", "/"), sha256: hashFile(sheetPath), bytes: statSync(sheetPath).size });
    }
    const inputs = planned.inputs.map((file) => {
      const path = resolve(input.workspace, file.path);
      if (!statSync(path).isFile() || hashFile(path) !== file.sha256) throw new Error(`DCC pinned source/fixture changed: ${file.path}`);
      return file;
    });
    if (hashFile(input.plan.blenderPath) !== input.plan.blenderSha256 || hashFile(input.plan.installedBlenderPath) !== input.plan.installedBlenderSha256) throw new Error("Blender executable changed during DCC verification");
    if (item.processId == null || !Number.isFinite(item.startedAtMs) || !Number.isFinite(item.completedAtMs) || item.completedAtMs < item.startedAtMs) throw new Error(`DCC journal item lacks process identity/timestamps: ${planned.action}`);
    results.push({ tool: "blender_command", success: true, taskId: input.taskId, attempt: input.attempt, arguments: { action: planned.action }, result: { action: planned.action, status: "passed", exitCode: item.exitCode, version: planned.action === "runtime" ? runtimeVersion : evidence.blenderVersion || runtimeVersion, command: planned.command, processId: item.processId, startedAtMs: item.startedAtMs, completedAtMs: item.completedAtMs, evidence, outputs, verifiedInputs: inputs, sourceSha256: sha(JSON.stringify(inputs)), outputSha256: sha(output), journalItem: { command: item.command, status: item.status, exitCode: item.exitCode, cwd: item.cwd, processId: item.processId, startedAtMs: item.startedAtMs, completedAtMs: item.completedAtMs, aggregatedOutput: output } } });
  }
  return results;
}

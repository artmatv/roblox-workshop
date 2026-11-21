import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMotionStudio,
  motionStudioToolDefinitions,
  parseFixedCube,
  prepareMotionValidationFixtures,
} from "../server/motion-studio.js";

const fixtureRoot = path.resolve("server/validation-fixtures/motion");
const goldenRoot = path.join(fixtureRoot, "golden");

async function makeWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "motion-probe-"));
  const output = path.join(workspace, "outputs", "motion");
  await mkdir(output, { recursive: true });
  await Promise.all([
    copyFile(path.join(goldenRoot, "animation.luau"), path.join(output, "animation.luau")),
    copyFile(path.join(goldenRoot, "mesh.glb"), path.join(output, "mesh.glb")),
    copyFile(path.join(goldenRoot, "vfx.lua"), path.join(output, "vfx.lua")),
  ]);
  return { workspace, output };
}

function context(workspace: string, options: { state?: string; identity?: () => Promise<any>; lease?: () => void; tool?: (name: string, args: any) => Promise<any> } = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const ctx = {
    studioId: "studio-1", taskId: "task-1234", attempt: 2, workspace,
    lease: options.lease ?? (() => {}),
    identity: options.identity ?? (async () => ({ taskId: "task-1234", attempt: 2 })),
    tool: async (name: string, args: any) => {
      calls.push({ name, args });
      if (options.tool) return options.tool(name, args);
      if (name === "get_studio_state") return `Current Studio Mode: ${options.state ?? "Play"}\nAvailable DataModels: Client`;
      return { isError: true, content: [{ type: "text", text: "mocked non-Studio failure" }] };
    },
  };
  return { ctx, calls };
}

function createArgs(output: string) {
  return {
    action: "create",
    animationPath: path.posix.join("outputs/motion", "animation.luau"),
    meshPath: path.posix.join("outputs/motion", "mesh.glb"),
    vfxPath: path.posix.join("outputs/motion", "vfx.lua"),
  };
}

test("fixture preparation copies source inputs and the golden GLB is a real closed 8 vertex, 12 triangle cube", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "motion-fixtures-"));
  try {
    const prepared = await prepareMotionValidationFixtures(workspace);
    assert.equal(prepared.paths.length, 3);
    const mesh = parseFixedCube(await readFile(path.join(workspace, "validation-inputs/motion/mesh.glb")));
    assert.equal(mesh.vertices.length, 8);
    assert.equal(mesh.indices.length / 3, 12);
    assert.deepEqual(mesh.bounds, [2, 2, 2]);
    const generated = await readFile(path.join(fixtureRoot, "golden/mesh.glb"));
    assert.deepEqual(await readFile(path.join(workspace, "validation-inputs/motion/mesh.glb")), generated);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("create rejects a whole-file animation append before any Studio call", async () => {
  const { workspace, output } = await makeWorkspace();
  try {
    await writeFile(path.join(output, "animation.luau"),
      `${await readFile(path.join(output, "animation.luau"), "utf8")}\ngame:GetService("DataStoreService"):GetDataStore("x"):SetAsync("x", 1)\n`);
    const { ctx, calls } = context(workspace);
    await assert.rejects(createMotionStudio(ctx).motionProbe(createArgs(output)), /does not completely match/);
    assert.deepEqual(calls, []);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("create rejects tampering to either remaining complete export before any Studio call", async () => {
  const { workspace, output } = await makeWorkspace();
  try {
    for (const file of ["mesh.glb", "vfx.lua"]) {
      const target = path.join(output, file);
      const original = await readFile(target);
      await writeFile(target, Buffer.concat([original, Buffer.from("\nmalicious trailing bytes\n")]));
      const { ctx, calls } = context(workspace);
      await assert.rejects(createMotionStudio(ctx).motionProbe(createArgs(output)), /does not completely match/);
      assert.deepEqual(calls, []);
      await writeFile(target, original);
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("create accepts only relative safe regular artifact paths and rejects symlinked output directories", async (t) => {
  const { workspace, output } = await makeWorkspace();
  try {
    const { ctx, calls } = context(workspace);
    await assert.rejects(createMotionStudio(ctx).motionProbe({ ...createArgs(output), animationPath: "../outside/animation.luau" }), /relative|Unsafe/);
    assert.deepEqual(calls, []);
    const link = path.join(workspace, "linked");
    try { await symlink(output, link, "junction"); }
    catch (error: any) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) { t.skip("This host does not permit creating a test symlink"); return; }
      throw error;
    }
    const linked = createArgs(output);
    linked.animationPath = "linked/animation.luau";
    await assert.rejects(createMotionStudio(ctx).motionProbe(linked), /symbolic link/);
    assert.deepEqual(calls, []);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("Studio mode and identity are rechecked after awaited state reads before execute_luau", async () => {
  const { workspace, output } = await makeWorkspace();
  try {
    const wrong = context(workspace, { state: "Edit" });
    await assert.rejects(createMotionStudio(wrong.ctx).motionProbe(createArgs(output)), /confirmed Play client/);
    assert.equal(wrong.calls.some((x) => x.name === "execute_luau"), false);

    let identities = 0;
    const raced = context(workspace, { identity: async () => {
      identities++;
      if (identities >= 2) throw new Error("identity changed after awaited state");
      return {};
    } });
    await assert.rejects(createMotionStudio(raced.ctx).motionProbe(createArgs(output)), /identity changed/);
    assert.equal(raced.calls.some((x) => x.name === "execute_luau"), false);

    let leases = 0;
    const leaseRace = context(workspace, { lease: () => {
      leases++;
      if (leases >= 3) throw new Error("lease expired after awaited state");
    } });
    await assert.rejects(createMotionStudio(leaseRace.ctx).motionProbe(createArgs(output)), /lease expired/);
    assert.equal(leaseRace.calls.some((x) => x.name === "execute_luau"), false);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("the fixed schema requires paths only for create and the trusted exporter output is what reaches Studio", async () => {
  const schema = motionStudioToolDefinitions[0].inputSchema as any;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.animationPath.type, "string");
  const { workspace, output } = await makeWorkspace();
  try {
    let code = "";
    let meshCode = "";
    const { ctx, calls } = context(workspace, { tool: async (name, args) => {
      if (name === "get_studio_state") return `Current Studio Mode: Play\nAvailable DataModels: Client`;
      if (!code) code = args.code;
      if (args.code.includes("CreateEditableMesh")) meshCode = args.code;
      return { isError: true };
    } });
    const factory = createMotionStudio(ctx);
    await assert.rejects(factory.motionProbe(createArgs(output)), /Fixed motion Studio operation failed/);
    assert.equal(calls.some((x) => x.name === "execute_luau"), true);
    assert.match(code, /CreateHumanoidModelFromDescriptionAsync/);
    assert.match(code, /RegisterKeyframeSequence/);
    assert.match(code, /LoadAnimation/);
    assert.match(code, /__SyphoMotion_task-1234_A2_Anims/);
    assert.doesNotMatch(code, /DataStoreService/);
    await assert.rejects(factory.motionProbe({ action: "mesh_sample" }), /Fixed motion Studio operation failed/);
    assert.match(meshCode, /CreateEditableMesh/);
    assert.match(meshCode, /CreateMeshPartAsync\(Content\.fromObject\(em\)\)/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("Studio operation failures preserve only a bounded upstream text diagnostic", async () => {
  const { workspace, output } = await makeWorkspace();
  try {
    const diagnostic = "Luau runtime: RightUpperArm transform inspection failed";
    let executions = 0;
    const { ctx } = context(workspace, { tool: async (name) => {
      if (name === "get_studio_state") return `Current Studio Mode: Play\nAvailable DataModels: Client`;
      executions++;
      if (executions === 1)
        return { structuredContent: { created: true, rigType: "R15", trackPlaying: true, trackLength: 1.2 } };
      return { isError: true, content: [{ type: "text", text: `${diagnostic}\n${"x".repeat(5000)}` }] };
    } });
    const factory = createMotionStudio(ctx);
    await factory.motionProbe(createArgs(output));
    await assert.rejects(factory.motionProbe({ action: "pose_rest" }), (error: any) => {
      assert.match(error.message, /Fixed motion Studio operation failed/);
      assert.match(error.message, new RegExp(diagnostic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.ok(error.message.length < 1300);
      return true;
    });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("pose and mesh probes normalize MCP numeric objects and retain AJU joint evidence", async () => {
  const { workspace, output } = await makeWorkspace();
  try {
    const executeCodes: string[] = [];
    const numericMap = (values: number[]) => Object.fromEntries(values.map((value, i) => [String(i + 1), value]));
    const transforms: number[] = Array.from({ length: 12 }, (_, i) => i === 0 || i === 5 || i === 10 ? 1 : 0);
    const movedTransforms = [...transforms]; movedTransforms[3] = 0.2;
    const pose = (upper: number[], world: number[], timePosition: number) => ({
      trackPlaying: true, trackLength: 1.2, upperAngle: 0.2, lowerAngle: 0.1,
      upperTransform: numericMap(upper), lowerTransform: numericMap(transforms),
      upperWorld: numericMap(world), lowerWorld: numericMap(transforms),
      upperJointClass: "AnimationConstraint", lowerJointClass: "Motor6D", timePosition,
    });
    let executions = 0;
    const { ctx } = context(workspace, { tool: async (name, args) => {
      if (name === "get_studio_state") return `Current Studio Mode: Play\nAvailable DataModels: Client`;
      executeCodes.push(args.code);
      executions++;
      if (executions === 1)
        return { structuredContent: { created: true, rigType: "R15", trackPlaying: true, trackLength: 1.2 } };
      if (executions === 2) return { structuredContent: pose(transforms, transforms, 0.05) };
      if (executions === 3) return { structuredContent: pose(movedTransforms, movedTransforms, 0.45) };
      return { structuredContent: {
        className: "MeshPart", vertexCount: 8, triangleCount: 12,
        size: numericMap([2, 2, 2]), geometryBounds: numericMap([2, 2, 2]), editable: true,
      } };
    } });
    const factory = createMotionStudio(ctx);
    await factory.motionProbe(createArgs(output));
    const rest = await factory.motionProbe({ action: "pose_rest" });
    const action = await factory.motionProbe({ action: "pose_action" });
    const mesh = await factory.motionProbe({ action: "mesh_sample" });
    assert.match(executeCodes[1], /x:IsA\("Motor6D"\) or x:IsA\("AnimationConstraint"\)/);
    assert.match(executeCodes[1], /joint\.Attachment1/);
    assert.match(executeCodes[1], /FindFirstAncestorWhichIsA\("BasePart"\)/);
    assert.match(executeCodes[1], /ToObjectSpace\(upperPart\.CFrame\)/);
    assert.deepEqual(rest.jointClasses, { upper: "AnimationConstraint", lower: "Motor6D" });
    assert.equal(action.jointChanged, true);
    assert.deepEqual(mesh.size, [2, 2, 2]);
    assert.deepEqual(mesh.dimensions, [2, 2, 2]);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("numeric MCP tables with gaps or extra keys fail pose evidence validation", async () => {
  const numericMap = (values: number[]) => Object.fromEntries(values.map((value, i) => [String(i + 1), value]));
  for (const malformed of [
    Object.fromEntries(Object.entries(numericMap(Array(12).fill(0))).filter(([key]) => key !== "6")),
    { ...numericMap(Array(12).fill(0)), "13": 0 },
    { ...numericMap(Array(12).fill(0)), extra: 0 },
  ]) {
    const { workspace, output } = await makeWorkspace();
    try {
      let executions = 0;
      const { ctx } = context(workspace, { tool: async (name) => {
        if (name === "get_studio_state") return `Current Studio Mode: Play\nAvailable DataModels: Client`;
        executions++;
        if (executions === 1)
          return { structuredContent: { created: true, rigType: "R15", trackPlaying: true, trackLength: 1.2 } };
        const values = numericMap(Array(12).fill(0));
        return { structuredContent: {
          trackPlaying: true, trackLength: 1.2, upperAngle: 0, lowerAngle: 0,
          upperTransform: malformed, lowerTransform: values, upperWorld: values, lowerWorld: values,
          upperJointClass: "AnimationConstraint", lowerJointClass: "AnimationConstraint", timePosition: 0.05,
        } };
      } });
      const factory = createMotionStudio(ctx);
      await factory.motionProbe(createArgs(output));
      await assert.rejects(factory.motionProbe({ action: "pose_rest" }), /did not confirm real animation-track motion/);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  }
});

test("shutdown inspects an inactive Edit namespace read-only instead of skipping cleanup proof", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "motion-cleanup-"));
  try {
    let code = "";
    const { ctx, calls } = context(workspace, { state: "Edit", tool: async (name, args) => {
      if (name === "get_studio_state") return `Current Studio Mode: Edit\nAvailable DataModels: Edit`;
      code = args.code;
      return { isError: true };
    } });
    await assert.rejects(createMotionStudio(ctx).cleanupOnShutdown(), /absence check failed/);
    assert.deepEqual(calls.map((x) => x.name), ["get_studio_state", "execute_luau"]);
    assert.equal(calls[1].args.datamodel_type, "Edit");
    assert.match(code, /FindFirstChild/);
    assert.doesNotMatch(code, /Destroy|Instance\.new|\.Parent\s*=/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("Play shutdown cleanup removes the owned subtree without rebuilding the VFX recipe", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "motion-cleanup-crlf-"));
  try {
    let cleanupCode = "";
    const { ctx, calls } = context(workspace, { tool: async (name, args) => {
      if (name === "get_studio_state") return `Current Studio Mode: Play\nAvailable DataModels: Client`;
      cleanupCode = args.code;
      return { structuredContent: { removed: true, remaining: false } };
    } });
    const result = await createMotionStudio(ctx).cleanupOnShutdown();
    assert.equal(result.verifiedAbsent, true);
    assert.deepEqual(calls.map((x) => x.name), ["get_studio_state", "get_studio_state", "execute_luau"]);
    assert.doesNotMatch(cleanupCode, /VFXKit\.build|SimpleParticlePreview|Instance\.new/);
    assert.match(cleanupCode, /cleanup ownership mismatch/);
    assert.match(cleanupCode, /animation folder ownership mismatch/);
    assert.match(cleanupCode, /tr:Stop\(0\)/);
    assert.match(cleanupCode, /if c then c:Destroy\(\) end/);
    assert.match(cleanupCode, /if f then f:Destroy\(\) end/);
    assert.match(cleanupCode, /return \{removed=true,remaining=/);
    const firstMutation = Math.min(cleanupCode.indexOf("tr:Stop"), cleanupCode.indexOf(":Destroy"));
    assert.ok(cleanupCode.indexOf("cleanup ownership mismatch") < firstMutation);
    assert.ok(cleanupCode.indexOf("animation folder ownership mismatch") < firstMutation);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

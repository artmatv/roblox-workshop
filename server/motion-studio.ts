import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MotionStudioContext = {
  tool: (name: string, args: any, timeout?: number) => Promise<any>;
  studioId: string;
  taskId: string;
  attempt: number;
  workspace: string;
  lease: () => void;
  identity: () => Promise<any>;
};

const fixtureRoot = fileURLToPath(
  new URL("./validation-fixtures/motion/", import.meta.url),
);
const workspaceInputs = [
  "validation-inputs/motion/animation.json",
  "validation-inputs/motion/mesh.glb",
  "validation-inputs/motion/vfx/simple_particle.json",
] as const;
const trustedInputs = [
  "input/animation.json",
  "input/mesh.glb",
  "input/vfx/simple_particle.json",
] as const;
const goldenFiles = ["golden/animation.luau", "golden/mesh.glb", "golden/vfx.lua"] as const;
const maxBytes: Record<"animation" | "mesh" | "vfx", number> = {
  animation: 128 * 1024,
  mesh: 128 * 1024,
  vfx: 64 * 1024,
};

export const motionStudioToolDefinitions = [
  {
    name: "motion_probe",
    description:
      "Fixed trusted animation, editable mesh, and VFX live-preview probes in the confirmed Play client.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      allOf: [{
        if: { properties: { action: { const: "create" } }, required: ["action"] },
        then: { required: ["animationPath", "meshPath", "vfxPath"] },
        else: { not: { anyOf: [
          { required: ["animationPath"] }, { required: ["meshPath"] }, { required: ["vfxPath"] },
        ] } },
      }],
      properties: {
        action: {
          type: "string",
          enum: ["create", "pose_rest", "pose_action", "mesh_sample", "vfx", "cleanup"],
        },
        animationPath: { type: "string", minLength: 1, maxLength: 512 },
        meshPath: { type: "string", minLength: 1, maxLength: 512 },
        vfxPath: { type: "string", minLength: 1, maxLength: 512 },
      },
    },
  },
] as const;

function sha(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
function canonical(bytes: Buffer, binary = false) {
  if (binary) return bytes;
  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes))
    throw new Error("Motion fixture must be valid UTF-8");
  return Buffer.from(value.replace(/\r\n?/g, "\n"), "utf8");
}
function decode(value: any): any {
  for (let i = 0; i < 4; i++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); continue; } catch { return value; }
    }
    if (value?.structuredContent !== undefined) { value = value.structuredContent; continue; }
    const texts = value?.content?.filter((x: any) => x?.type === "text").map((x: any) => x.text);
    if (texts?.length) { value = texts.join("\n"); continue; }
    if (value?.result !== undefined) { value = value.result; continue; }
    break;
  }
  return value;
}
function numericArray(value: any, length: number): number[] | null {
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value);
  if (keys.length !== length) return null;
  const result = new Array<number>(length);
  if (Array.isArray(value)) {
    for (let i = 0; i < length; i++) {
      if (!(i in value) || typeof value[i] !== "number" || !Number.isFinite(value[i])) return null;
      result[i] = value[i];
    }
    return result;
  }
  for (const key of keys) {
    if (!/^[1-9]\d*$/.test(key)) return null;
    const index = Number(key) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= length ||
        typeof value[key] !== "number" || !Number.isFinite(value[key])) return null;
    result[index] = value[key];
  }
  return result.every((x) => typeof x === "number" && Number.isFinite(x)) ? result : null;
}
function validateArgs(args: any) {
  if (!args || typeof args !== "object" || Array.isArray(args) ||
      !["create", "pose_rest", "pose_action", "mesh_sample", "vfx", "cleanup"].includes(args.action))
    throw new Error("Invalid fixed motion tool input");
  const keys = Object.keys(args);
  const isCreate = args.action === "create";
  if (keys.some((k) => !["action", ...(isCreate ? ["animationPath", "meshPath", "vfxPath"] : [])].includes(k)) ||
      (isCreate && ["animationPath", "meshPath", "vfxPath"].some((k) => typeof args[k] !== "string" || !args[k])) ||
      (!isCreate && keys.length !== 1))
    throw new Error("Invalid fixed motion artifact paths or extra arguments");
  return args.action as "create" | "pose_rest" | "pose_action" | "mesh_sample" | "vfx" | "cleanup";
}

async function safeWorkspaceFile(workspace: string, relative: string, limit: number) {
  if (typeof relative !== "string" || !relative || relative.length > 512 || path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative))
    throw new Error("Motion artifact path must be relative to the current task workspace");
  const parts = relative.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe motion artifact path");
  const root = await realpath(workspace);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error("Unsafe motion artifact path");
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const st = await lstat(cursor);
    if (st.isSymbolicLink()) throw new Error("Motion artifact path contains a symbolic link");
    if (cursor === target && !st.isFile()) throw new Error("Motion artifact is not a regular file");
  }
  const actual = await realpath(target);
  if (actual !== target) throw new Error("Motion artifact escaped the task workspace");
  const st = await lstat(target);
  if (st.size === 0 || st.size > limit) throw new Error("Motion artifact size is outside the fixed bounds");
  return readFile(target, { flag: constants.O_RDONLY });
}

export async function prepareMotionValidationFixtures(workspace: string) {
  const root = await realpath(workspace);
  const base = path.join(root, "validation-inputs", "motion");
  let cursor = root;
  for (const part of ["validation-inputs", "motion", "vfx"]) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); } catch (error: any) { if (error?.code !== "EEXIST") throw error; }
    const st = await lstat(cursor);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Unsafe motion fixture directory");
  }
  for (let i = 0; i < workspaceInputs.length; i++) {
    const destination = path.join(root, workspaceInputs[i]);
    try {
      const st = await lstat(destination);
      if (st.isSymbolicLink() || !st.isFile()) throw new Error("Unsafe existing motion fixture destination");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      await writeFile(destination, await readFile(path.join(fixtureRoot, trustedInputs[i])), { flag: "wx" });
    }
  }
  return { paths: [...workspaceInputs] };
}

type ExportEvidence = { path: string; rawSha256: string; canonicalSha256: string; bytes: number };
type VerifiedExports = { evidence: ExportEvidence[]; trustedExports: Record<string, any>; files: Record<"animation" | "mesh" | "vfx", Buffer> };
async function verifyTrustedExports(workspace: string, args: any): Promise<VerifiedExports> {
  const evidence: ExportEvidence[] = [];
  const files = {} as VerifiedExports["files"];
  const trustedExports: Record<string, any> = {};
  const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"));
  for (const relative of goldenFiles) {
    const bytes = await readFile(path.join(fixtureRoot, relative));
    const canon = canonical(bytes, relative.endsWith(".glb"));
    const expected = manifest.goldens[relative];
    if (!expected || sha(bytes) !== expected.rawSha256 || sha(canon) !== expected.canonicalSha256)
      throw new Error(`Trusted motion golden ${relative} failed its pinned digest (raw=${sha(bytes)}, canonical=${sha(canon)})`);
  }
  const entries = [
    ["animation", args.animationPath, "golden/animation.luau", ".luau"],
    ["mesh", args.meshPath, "golden/mesh.glb", ".glb"],
    ["vfx", args.vfxPath, "golden/vfx.lua", ".lua"],
  ] as const;
  for (const [name, relative, goldenPath, ext] of entries) {
    if (path.posix.extname(relative.replace(/\\/g, "/")).toLowerCase() !== ext)
      throw new Error(`Motion ${name} artifact has an unexpected file extension`);
    const bytes = await safeWorkspaceFile(workspace, relative, maxBytes[name]);
    const canon = canonical(bytes, name === "mesh");
    const goldenBytes = await readFile(path.join(fixtureRoot, goldenPath));
    const goldenCanonical = canonical(goldenBytes, name === "mesh");
    const expected = manifest.goldens[goldenPath];
    if (!expected || sha(goldenBytes) !== expected.rawSha256 || sha(goldenCanonical) !== expected.canonicalSha256)
      throw new Error(`Trusted motion golden ${goldenPath} failed its pinned digest`);
    if (sha(canon) !== expected.canonicalSha256 || !canon.equals(goldenCanonical))
      throw new Error(`Motion ${name} artifact ${relative} does not completely match its trusted exporter golden`);
    files[name] = bytes;
    const item = { path: relative, rawSha256: sha(bytes), canonicalSha256: sha(canon), bytes: bytes.length };
    evidence.push(item);
    trustedExports[name] = { sha256: expected.rawSha256, rawSha256: expected.rawSha256, canonicalSha256: expected.canonicalSha256 };
  }
  return { evidence, trustedExports, files };
}

function validTaskName(taskId: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(taskId)) throw new Error("Invalid task ID for motion preview ownership");
  return `__SyphoMotion_${taskId}`;
}
function lua(value: unknown) { return JSON.stringify(value); }
function basePrelude(folder: string, ctx: MotionStudioContext) {
  return `local RunService=game:GetService("RunService"); assert(RunService:IsRunning(),"Play runtime required")
local Workspace=game:GetService("Workspace"); local RS=game:GetService("ReplicatedStorage")
local taskId=${lua(ctx.taskId)}; local attempt=${ctx.attempt}; local name=${lua(folder)}
local container=Workspace:FindFirstChild(name); assert(container and container:GetAttribute("TaskId")==taskId and container:GetAttribute("Attempt")==attempt,"owned motion preview missing")`;
}

export function parseFixedCube(bytes: Buffer) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw new Error("Trusted mesh fixture is not a valid GLB 2 file");
  let pos = 12, doc: any, bin: Buffer | undefined;
  while (pos < bytes.length) {
    const n = bytes.readUInt32LE(pos); const type = bytes.toString("ascii", pos + 4, pos + 8); pos += 8;
    const chunk = bytes.subarray(pos, pos + n); pos += n;
    if (type === "JSON") doc = JSON.parse(chunk.toString("utf8").trim());
    else if (type === "BIN\0") bin = chunk;
  }
  const [pa, ia] = doc?.accessors ?? [];
  const pv = doc?.bufferViews?.[pa?.bufferView]; const iv = doc?.bufferViews?.[ia?.bufferView];
  if (!bin || pa?.componentType !== 5126 || pa?.type !== "VEC3" || pa.count !== 8 || ia?.componentType !== 5123 || ia?.type !== "SCALAR" || ia.count !== 36)
    throw new Error("Trusted mesh fixture geometry does not match the fixed 8 vertex / 12 triangle probe");
  const vertices = Array.from({ length: pa.count }, (_, j) => [0, 1, 2].map((k) => bin!.readFloatLE((pv.byteOffset ?? 0) + j * 12 + k * 4)));
  const indices = Array.from({ length: ia.count }, (_, j) => bin!.readUInt16LE((iv.byteOffset ?? 0) + j * 2));
  if (indices.some((x: number) => x >= vertices.length)) throw new Error("Trusted mesh index out of bounds");
  const bounds = [0, 1, 2].map((k) => Math.max(...vertices.map((v: any) => v[k])) - Math.min(...vertices.map((v: any) => v[k])));
  if (bounds.some((n) => Math.abs(n - 2) > 1e-6)) throw new Error("Trusted mesh fixture dimensions changed");
  return { vertices, indices, bounds };
}

export function createMotionStudio(context: MotionStudioContext) {
  const ownerName = validTaskName(context.taskId) + `_A${context.attempt}`;
  const animName = ownerName + "_Anims";
  let active = false;
  let restPose: { upperAngle: number; lowerAngle: number; upperTransform: number[]; lowerTransform: number[]; upperWorld: number[]; lowerWorld: number[] } | null = null;
  let evidence: ExportEvidence[] = [];
  let exports: VerifiedExports | null = null;
  const cleanupBaseCode = `local RunService=game:GetService("RunService"); assert(RunService:IsRunning(),"Play runtime required")
local Workspace=game:GetService("Workspace"); local RS=game:GetService("ReplicatedStorage"); local taskId=${lua(context.taskId)}; local attempt=${context.attempt}; local name=${lua(ownerName)}; local animName=${lua(animName)}
local c=Workspace:FindFirstChild(name); local f=RS:FindFirstChild(animName)
if c then assert(c:GetAttribute("TaskId")==taskId and c:GetAttribute("Attempt")==attempt,"cleanup ownership mismatch") end
if f then assert(f:GetAttribute("TaskId")==taskId and f:GetAttribute("Attempt")==attempt,"animation folder ownership mismatch") end
if c then for _,x in ipairs(c:GetDescendants()) do if x:IsA("Animator") then for _,tr in ipairs(x:GetPlayingAnimationTracks()) do pcall(function() tr:Stop(0) end) end end end end`;
  const cleanupTail = `
if c then c:Destroy() end
if f then f:Destroy() end
return {removed=true,remaining=(Workspace:FindFirstChild(name)~=nil or RS:FindFirstChild(animName)~=nil)}`;
  async function ownedCleanupCode() {
    return `${cleanupBaseCode}${cleanupTail}`;
  }

  async function studioCall(code: string, allowCancelled = false) {
    if (!allowCancelled) context.lease();
    await context.identity();
    if (!allowCancelled) context.lease();
    const state = decode(await context.tool("get_studio_state", { studio_id: context.studioId }));
    if (!allowCancelled) context.lease();
    const raw = typeof state === "string" ? state : JSON.stringify(state);
    const mode = raw.match(/Current Studio Mode\s*:\s*([^\r\n"]+)/i)?.[1]?.trim();
    const available = raw.match(/Available DataModels\s*:\s*([^\r\n"]+)/i)?.[1] ?? "";
    if (!/^Play\b/i.test(mode ?? "") || !/\bClient\b/i.test(available))
      throw new Error("Studio is not in a confirmed Play client session");
    if (!allowCancelled) context.lease();
    await context.identity();
    if (!allowCancelled) context.lease();
    const result = await context.tool("execute_luau", {
      studio_id: context.studioId,
      datamodel_type: "Client",
      code,
    });
    if (!allowCancelled) context.lease();
    await context.identity();
    if (!allowCancelled) context.lease();
    if (result?.isError) {
      const detail = Array.isArray(result?.content)
        ? result.content
            .filter((item: any) => item?.type === "text" && typeof item.text === "string")
            .map((item: any) => item.text.trim())
            .filter(Boolean)
            .join("\n")
            .slice(0, 1200)
        : "";
      throw new Error(detail
        ? `Fixed motion Studio operation failed: ${detail}`
        : "Fixed motion Studio operation failed");
    }
    return decode(result);
  }
  const meta = (action: string, data: any = {}) => ({
    profile: "sypho-motion", taskId: context.taskId, attempt: context.attempt, action,
    artifactDigests: evidence, ...data,
  });

  async function motionProbe(args: any) {
    const action = validateArgs(args);
    if (action === "create") {
      if (active) throw new Error("Motion preview is already active");
      // All three actor-produced export files are fully inspected before any Studio call or mutation.
      const checked = await verifyTrustedExports(context.workspace, args);
      exports = checked;
      evidence = checked.evidence;
      const meshInfo = parseFixedCube(checked.files.mesh);
      const animationText = canonical(checked.files.animation).toString("utf8");
      const expectedFolder = "__SyphoMotionDiagnostic_Anims";
      if (animationText.split(expectedFolder).length !== 2) throw new Error("Trusted animation golden folder token is invalid");
      const safeAnimation = animationText.replace(expectedFolder, animName);
      const trustedExports = {
        ...checked.trustedExports,
        animation: { ...checked.trustedExports.animation, executedSha256: sha(Buffer.from(safeAnimation, "utf8")) },
      };
      const createCode = `local RunService=game:GetService("RunService"); assert(RunService:IsRunning(),"Play runtime required")
local Workspace=game:GetService("Workspace"); local RS=game:GetService("ReplicatedStorage")
local taskId=${lua(context.taskId)}; local attempt=${context.attempt}; local name=${lua(ownerName)}; local animName=${lua(animName)}
assert(not Workspace:FindFirstChild(name) and not RS:FindFirstChild(animName),"motion preview name collision")
local container=Instance.new("Folder"); container.Name=name; container:SetAttribute("TaskId",taskId); container:SetAttribute("Attempt",attempt); container.Parent=Workspace
local af=Instance.new("Folder"); af.Name=animName; af:SetAttribute("TaskId",taskId); af:SetAttribute("Attempt",attempt); af.Parent=RS
local base=Instance.new("Part"); base.Name="MotionStage"; base.Size=Vector3.new(14,0.3,10); base.Anchored=true; base.CanCollide=false; base.Position=Vector3.new(0,99,0); base.Parent=container
local Players=game:GetService("Players"); local desc=Instance.new("HumanoidDescription")
local rig=Players:CreateHumanoidModelFromDescriptionAsync(desc,Enum.HumanoidRigType.R15); rig.Name="MotionR15"; rig:SetAttribute("TaskId",taskId); rig:SetAttribute("Attempt",attempt)
for _,x in ipairs(rig:GetDescendants()) do if x:IsA("Script") or x:IsA("LocalScript") then x:Destroy() elseif x:IsA("BasePart") then x.CanCollide=false; if x.Name=="HumanoidRootPart" then x.Anchored=true end end end
rig:PivotTo(CFrame.new(0,100,0)); local bb,bs=rig:GetBoundingBox(); local floorY=99.15; rig:PivotTo(rig:GetPivot()+Vector3.new(0,floorY-(bb.Position.Y-bs.Y/2),0)); rig.Parent=container
local buildAnimation = function()
` + safeAnimation + `
end
buildAnimation()
local seq=af:FindFirstChild("Wave"); assert(seq and seq:IsA("KeyframeSequence"),"animation exporter did not build sequence")
local aid=game:GetService("KeyframeSequenceProvider"):RegisterKeyframeSequence(seq)
local anim=Instance.new("Animation"); anim.AnimationId=aid; anim.Parent=container
local hum=rig:FindFirstChildOfClass("Humanoid"); assert(hum,"R15 humanoid missing")
local animator=hum:FindFirstChildOfClass("Animator") or Instance.new("Animator",hum)
local track=animator:LoadAnimation(anim); track.Looped=true; track.Priority=Enum.AnimationPriority.Action; track:Play(0)
local untilAt=os.clock()+3; while track.Length<=0 and os.clock()<untilAt do task.wait(0.05) end; assert(track.Length>0,"registered sequence did not produce a loaded animation track")
track:AdjustSpeed(0); track.TimePosition=0.05; task.wait(); task.wait()
return {created=true,rigClass=rig.ClassName,rigType=hum.RigType.Name,trackPlaying=track.IsPlaying,trackLength=track.Length,container=name,animFolder=animName,baseline=true}`;
      active = true;
      let result: any;
      try {
        result = await studioCall(createCode);
        if (result?.created !== true || result?.rigType !== "R15" || result?.trackPlaying !== true)
          throw new Error("Studio did not confirm the real R15 animation preview");
      } catch (error) {
        try {
          const removed = await studioCall(await ownedCleanupCode());
          if (removed?.removed === true && removed?.remaining === false) active = false;
        } catch { /* Lease/identity loss means only the owning runtime can safely finish cleanup. */ }
        throw error;
      }
      return meta(action, { verifiedArtifacts: true, trustedExports, animationLength: result.trackLength, rigType: result.rigType, trackPlaying: true });
    }
    if (action === "cleanup") {
      const out = await studioCall(await ownedCleanupCode());
      if (out?.removed !== true || out?.remaining !== false) throw new Error("Studio did not confirm owned motion cleanup");
      active = false;
      restPose = null;
      return meta(action, { removed: true, verifiedAbsent: true, studioMode: "Play", remaining: [] });
    }
    if (!active) throw new Error("No host-created motion preview is active");
    if (!exports) throw new Error("Validated motion exports are unavailable");
    const p = basePrelude(ownerName, context);
    if (action === "pose_rest" || action === "pose_action") {
      const t = action === "pose_rest" ? 0.05 : 0.45;
      if (action === "pose_action" && !restPose) throw new Error("pose_rest must be sampled before pose_action");
      const code = `${p}
local rig=container:FindFirstChild("MotionR15"); assert(rig and rig:GetAttribute("TaskId")==taskId and rig:GetAttribute("Attempt")==attempt,"rig ownership mismatch")
local tracks={}; for _,x in ipairs(rig:GetDescendants()) do if x:IsA("Animator") then for _,tr in ipairs(x:GetPlayingAnimationTracks()) do table.insert(tracks,tr) end end end; assert(#tracks==1,"expected one actual AnimationTrack")
local track=tracks[1]; track:AdjustSpeed(0); track.TimePosition=${t}; task.wait(); task.wait()
local function targetPart(joint)
  if joint:IsA("Motor6D") then return joint.Part1 end
  local attachment=joint.Attachment1; return attachment and attachment:FindFirstAncestorWhichIsA("BasePart") or nil
end
local upper,lower,upperPart,lowerPart
for _,x in ipairs(rig:GetDescendants()) do
  if x:IsA("Motor6D") or x:IsA("AnimationConstraint") then
    local part=targetPart(x)
    if part and part.Name=="RightUpperArm" then upper=x; upperPart=part
    elseif part and part.Name=="RightLowerArm" then lower=x; lowerPart=part end
  end
end
assert(upper and lower and upperPart and lowerPart,"R15 arm animation joints missing")
local _,signature=upper.Transform:ToAxisAngle(); local _,lowerSignature=lower.Transform:ToAxisAngle()
local root=rig:FindFirstChild("HumanoidRootPart"); assert(root,"R15 root missing")
local ut={upper.Transform:GetComponents()}; local lt={lower.Transform:GetComponents()}; local uw={root.CFrame:ToObjectSpace(upperPart.CFrame):GetComponents()}; local lw={root.CFrame:ToObjectSpace(lowerPart.CFrame):GetComponents()}
return {trackPlaying=track.IsPlaying,trackLength=track.Length,upperAngle=signature,lowerAngle=lowerSignature,upperTransform=ut,lowerTransform=lt,upperWorld=uw,lowerWorld=lw,upperJointClass=upper.ClassName,lowerJointClass=lower.ClassName,timePosition=track.TimePosition,phase=${lua(action)}}`;
      const out = await studioCall(code);
      const upperTransform = numericArray(out?.upperTransform, 12);
      const lowerTransform = numericArray(out?.lowerTransform, 12);
      const upperWorld = numericArray(out?.upperWorld, 12);
      const lowerWorld = numericArray(out?.lowerWorld, 12);
      if (out?.trackPlaying !== true || typeof out?.trackLength !== "number" || !(out.trackLength > 0) ||
          typeof out?.upperAngle !== "number" || typeof out?.lowerAngle !== "number" ||
          ![out?.upperJointClass, out?.lowerJointClass].every((x: any) => x === "Motor6D" || x === "AnimationConstraint") ||
          !upperTransform || !lowerTransform || !upperWorld || !lowerWorld)
        throw new Error("Studio did not confirm real animation-track motion");
      if (action === "pose_rest") restPose = { upperAngle: out.upperAngle, lowerAngle: out.lowerAngle, upperTransform, lowerTransform, upperWorld, lowerWorld };
      const moved = (a: number[], b: number[]) => a.some((x, i) => Math.abs(x - b[i]) > 0.01);
      const jointTransformDelta = action === "pose_action" && !!restPose &&
        (moved(upperTransform, restPose.upperTransform) || moved(lowerTransform, restPose.lowerTransform));
      const worldArmDelta = action === "pose_action" && !!restPose &&
        (moved(upperWorld, restPose.upperWorld) || moved(lowerWorld, restPose.lowerWorld));
      const jointChanged = jointTransformDelta && worldArmDelta;
      if (action === "pose_action" && !jointChanged) throw new Error("AnimationTrack did not change its actual joint transforms from the rest sample");
      return meta(action, { trackPlaying: out.trackPlaying, trackLength: out.trackLength, jointChanged,
        jointTransformDelta, worldArmDelta,
        jointAngles: { upper: out.upperAngle, lower: out.lowerAngle },
        jointClasses: { upper: out.upperJointClass, lower: out.lowerJointClass },
        phase: action === "pose_rest" ? "animation-rest" : "animation-action", timePosition: out.timePosition,
        camera_position: [0, 103, 15], look_at_position: [0, 101, 0],
        frame: { cameraPosition: [0, 103, 15], lookAtPosition: [0, 101, 0] } });
    }
    if (action === "mesh_sample") {
      const meshInfo = parseFixedCube(exports.files.mesh);
      const code = `${p}
local AssetService=game:GetService("AssetService")
local em=AssetService:CreateEditableMesh(); local vs={${meshInfo.vertices.map((v: any) => `Vector3.new(${v.map((n: number) => n.toFixed(8)).join(",")})`).join(",")}}
local ids={}; for i,v in ipairs(vs) do ids[i]=em:AddVertex(v) end
local ix={${meshInfo.indices.map((i: number) => i + 1).join(",")}}; for i=1,#ix,3 do em:AddTriangle(ids[ix[i]],ids[ix[i+1]],ids[ix[i+2]]) end
local part=AssetService:CreateMeshPartAsync(Content.fromObject(em)); part.Name="MeshSample"; part.Anchored=true; part.CanCollide=false; part:SetAttribute("TaskId",taskId); part:SetAttribute("Attempt",attempt); part.Size=Vector3.new(${meshInfo.bounds.join(",")}); part.CFrame=CFrame.new(4,100.15,0); part.Parent=container
local inspected=AssetService:CreateEditableMeshAsync(part.MeshContent); local vertices=inspected:GetVertices(); local faces=inspected:GetFaces(); assert(#vertices==8 and #faces==12,"real editable mesh geometry mismatch")
local mn=Vector3.new(math.huge,math.huge,math.huge); local mx=Vector3.new(-math.huge,-math.huge,-math.huge); for _,id in ipairs(vertices) do local q=inspected:GetPosition(id); mn=Vector3.new(math.min(mn.X,q.X),math.min(mn.Y,q.Y),math.min(mn.Z,q.Z)); mx=Vector3.new(math.max(mx.X,q.X),math.max(mx.Y,q.Y),math.max(mx.Z,q.Z)) end
local d=mx-mn; return {className=part.ClassName,vertexCount=#vertices,triangleCount=#faces,size={part.Size.X,part.Size.Y,part.Size.Z},geometryBounds={d.X,d.Y,d.Z},editable=true}`;
      const out = await studioCall(code);
      const size = numericArray(out?.size, 3);
      const geometryBounds = numericArray(out?.geometryBounds, 3);
      if (out?.className !== "MeshPart" || out.vertexCount !== 8 || out.triangleCount !== 12 ||
          !size || !geometryBounds || [...size, ...geometryBounds].some((x) => Math.abs(x - 2) > 0.01))
        throw new Error("Studio did not confirm the real editable mesh preview");
      return meta(action, { className: out.className, vertexCount: out.vertexCount, triangleCount: out.triangleCount,
        size, dimensions: geometryBounds, phase: "mesh-preview", camera_position: [8, 104, 12], look_at_position: [4, 100.15, 0],
        frame: { cameraPosition: [8, 104, 12], lookAtPosition: [4, 100.15, 0] } });
    }
    // The module bytes are a trusted, pinned exporter result. Only its exact return is replaced by this fixed call.
    const vfxGolden = canonical(exports.files.vfx).toString("utf8");
    const marker = "return VFXKit\n";
    if (!vfxGolden.endsWith(marker)) throw new Error("Trusted VFX module marker is invalid");
    const call = `
local base=Instance.new("Part"); base.Name="VFXBase"; base.Size=Vector3.new(1,1,1); base.Anchored=true; base.CanCollide=false; base.Position=Vector3.new(-4,99.65,0); base:SetAttribute("TaskId",taskId); base:SetAttribute("Attempt",attempt); base.Parent=container
local handle=VFXKit.build("SimpleParticlePreview",base,{suffix=taskId.."_"..tostring(attempt)}); assert(handle,"trusted VFX recipe did not build")
local tag="SimpleParticlePreview"..taskId.."_"..tostring(attempt); local emitter
for _,x in ipairs(base:GetDescendants()) do if x:IsA("ParticleEmitter") and x:GetAttribute("VFXTag")==tag then emitter=x end end
assert(emitter,"trusted VFX recipe did not create a real emitter"); handle.emit(); task.wait(0.25)
local ok=emitter.Parent and emitter.Parent:GetAttribute("VFXTag")==tag and emitter.Texture=="rbxasset://textures/particles/sparkles_main.dds" and emitter.Lifetime.Min==15 and emitter.Lifetime.Max==18 and emitter.Speed.Min==4 and emitter.Speed.Max==8 and emitter.Rate==0 and emitter:GetAttribute("EmitCount")==40 and emitter.Acceleration==Vector3.new(0,0,0) and #emitter.Color.Keypoints==2 and #emitter.Transparency.Keypoints==2
return {emitterClass=emitter.ClassName,emitted=true,propertiesVerified=ok,emitCount=emitter:GetAttribute("EmitCount"),tag=tag}`;
    const code = `${p}\n${vfxGolden.slice(0, -marker.length)}${call}`;
    const out = await studioCall(code);
    if (out?.emitterClass !== "ParticleEmitter" || out?.emitted !== true || out?.propertiesVerified !== true) throw new Error("Studio did not confirm the trusted VFX recipe preview");
    return meta(action, { emitterClass: out.emitterClass, emitted: true, propertiesVerified: true, emitCount: out.emitCount,
      phase: "vfx-preview", camera_position: [-4, 103, 12], look_at_position: [-4, 100, 0],
      frame: { cameraPosition: [-4, 103, 12], lookAtPosition: [-4, 100, 0] } });
  }
  async function cleanupOnShutdown() {
    // Cancellation can occur before create() or after an explicit cleanup, so inspect the
    // bound Studio namespace every time rather than trusting this factory's in-memory flag.
    await context.identity();
    const state = decode(await context.tool("get_studio_state", { studio_id: context.studioId }));
    await context.identity();
    const raw = typeof state === "string" ? state : JSON.stringify(state);
    const mode = raw.match(/Current Studio Mode\s*:\s*([^\r\n"]+)/i)?.[1]?.trim();
    const available = raw.match(/Available DataModels\s*:\s*([^\r\n"]+)/i)?.[1] ?? "";
    if (/^Play\b/i.test(mode ?? "") && /\bClient\b/i.test(available)) {
      const out = await studioCall(await ownedCleanupCode(), true);
      if (out?.removed !== true || out?.remaining !== false) throw new Error("Studio did not confirm owned motion cleanup during shutdown");
      active = false;
      restPose = null;
      return meta("cleanup", { removed: true, verifiedAbsent: true, studioMode: "Play", remaining: [] });
    }
    if (/^Edit\b/i.test(mode ?? "") && /\bEdit\b/i.test(available)) {
      const readOnly = `local W=game:GetService("Workspace"); local R=game:GetService("ReplicatedStorage"); local RunService=game:GetService("RunService"); assert(not RunService:IsRunning(),"read-only Edit verification required")
local a=W:FindFirstChild(${lua(ownerName)}); local b=R:FindFirstChild(${lua(animName)}); return {motionRootPresent=a~=nil,animationFolderPresent=b~=nil}`;
      await context.identity();
      const rawOut = await context.tool("execute_luau", { studio_id: context.studioId, datamodel_type: "Edit", code: readOnly });
      await context.identity();
      if (rawOut?.isError) throw new Error("Studio Edit namespace absence check failed");
      const out = decode(rawOut);
      if (typeof out?.motionRootPresent !== "boolean" || typeof out?.animationFolderPresent !== "boolean")
        throw new Error("Studio returned invalid Edit namespace absence evidence");
      const remaining = [out?.motionRootPresent ? ownerName : null, out?.animationFolderPresent ? animName : null].filter(Boolean);
      const verifiedAbsent = out?.motionRootPresent === false && out?.animationFolderPresent === false;
      if (verifiedAbsent) { active = false; restPose = null; }
      return meta("cleanup", { removed: false, verifiedAbsent, studioMode: "Edit", remaining });
    }
    throw new Error("Cannot verify motion cleanup outside the bound Studio Play Client or Edit session");
  }
  return { motionProbe, cleanupOnShutdown };
}

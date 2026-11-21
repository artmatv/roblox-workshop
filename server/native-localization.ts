import { createHash } from "node:crypto";
import { z } from "zod";
import type { Manifest } from "../shared/domain.js";
import {
  prepareGameLocalization,
  gameLocalizationLuaString,
} from "./game-localization.js";
import { hash } from "./store.js";

const entry = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/),
  source: z.string().min(1).max(4000),
  context: z.string().max(1000).optional(),
  example: z.string().max(4000).optional(),
}).strict();
export const nativeLocalizationInputSchema = z.object({
  sourceLocaleId: z.literal("en-us"),
  entries: z.array(entry).min(1).max(2000),
}).strict();

export type NativeLocalizationArtifact = {
  sourceLocaleId: "en-us";
  entries: Array<{ key: string; source: string; context: string; example: string }>;
  data: Record<string, unknown>;
  files: Array<{ path: string; content: string }>;
  sources: Record<string, { className: string; source: string }>;
  sourceHashes: Record<string, string>;
  artifactHash: string;
};

const ownedPaths = [
  "ReplicatedStorage/AutomationLocaleCatalog",
  "ReplicatedStorage/AutomationI18n",
  "StarterPlayer/StarterPlayerScripts/AutomationLocalization",
] as const;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function nativeLocalizationProtocolEnabled(value: unknown) {
  return value === "1";
}
export function nativeLocalizationAccessAllowed(protocol: unknown, activeNativeTask: boolean) {
  return nativeLocalizationProtocolEnabled(protocol) && activeNativeTask;
}

export function prepareNativeLocalization(input: unknown): NativeLocalizationArtifact {
  const parsed = nativeLocalizationInputSchema.parse(input);
  const manifest: Manifest = {
    summary: "Task-owned English localization catalog",
    deletions: [], files: [], instances: [], checks: [], findings: [],
    data: { localization: parsed },
  };
  prepareGameLocalization(manifest);
  const sources: NativeLocalizationArtifact["sources"] = {};
  for (const path of ownedPaths) {
    const instance = manifest.instances.find((item) => item.path === path);
    if (!instance?.source) throw new Error("Не создан обязательный официальный модуль локализации: " + path);
    sources[path] = { className: instance.className, source: instance.source };
  }
  const localization = manifest.data.localization as NativeLocalizationArtifact["data"];
  const files = manifest.files.filter((file) => file.path === "localization/en-us.csv" || file.path === "localization/ROBLOX_SETUP.md");
  const sourceHashes = Object.fromEntries(Object.entries(sources).map(([path, value]) => [path, sha256(value.source)]));
  const artifact = {
    sourceLocaleId: "en-us" as const,
    entries: (localization as any).entries,
    data: localization,
    files,
    sources,
    sourceHashes,
  };
  return { ...artifact, artifactHash: hash(artifact) };
}

export function nativeLocalizationInstallerCode(
  artifact: NativeLocalizationArtifact,
  created: string[] = [],
) {
  const values = ownedPaths.map((path) => ({
    path,
    className: artifact.sources[path].className,
    source: artifact.sources[path].source,
  }));
  const encoded = "{" + values.map((value) => "{path=" + gameLocalizationLuaString(value.path) + ",className=" + gameLocalizationLuaString(value.className) + ",source=" + gameLocalizationLuaString(value.source) + "}").join(",") + "}";
  const fresh = "{" + created.map((path) => "[" + gameLocalizationLuaString(path) + "]=true").join(",") + "}";
  return `local targets=${encoded}
local fresh=${fresh}
local rs=game:GetService("ReplicatedStorage")
local sp=game:GetService("StarterPlayer")
local sps=sp:FindFirstChild("StarterPlayerScripts")
if not sps or not sps:IsA("StarterPlayerScripts") then error("StarterPlayerScripts has an unexpected class") end
local parents={ReplicatedStorage=rs,StarterPlayer=sp,["StarterPlayer/StarterPlayerScripts"]=sps}
local canonicalI18n=${gameLocalizationLuaString(artifact.sources[ownedPaths[1]].source)}
local canonicalInitializer=${gameLocalizationLuaString(artifact.sources[ownedPaths[2]].source)}
local function pathParent(path) return parents[string.match(path,"^(.*)/[^/]+$")] end
local objects={}
for _,target in ipairs(targets) do
 local parent=pathParent(target.path)
 if not parent then error("Unexpected reserved localization parent") end
 local name=string.match(target.path,"([^/]+)$")
 local existing=parent:FindFirstChild(name)
 local matches=0
 for _,child in ipairs(parent:GetChildren()) do if child.Name==name then matches+=1 end end
 if matches>1 then error("Duplicate reserved localization objects: "..target.path) end
 if existing and not existing:IsA(target.className) then error("Reserved localization object has unexpected class: "..target.path) end
 if existing and not fresh[target.path] then
  if target.path=="ReplicatedStorage/AutomationI18n" and existing.Source~=canonicalI18n then error("AutomationI18n is not the official module") end
  if target.path=="StarterPlayer/StarterPlayerScripts/AutomationLocalization" and existing.Source~=canonicalInitializer then error("AutomationLocalization is not the official initializer") end
  if target.path=="ReplicatedStorage/AutomationLocaleCatalog" then
   local header='return {sourceLocaleId="en-us",entries={'..string.char(10)
   local footer=string.char(10)..'}}'..string.char(10)
   local old=existing.Source
   if string.sub(old,1,#header)~=header or string.sub(old,-#footer)~=footer then error("AutomationLocaleCatalog is not an official generated catalog") end
   local body=string.sub(old,#header+1,#old-#footer)
   local count=0
   for line in string.gmatch(body,"[^\\n]+") do
    if not string.match(line,'^%{Key=.+,Source=.+,Context=.*,Example=.*,Values=%{%}%},$') then error("AutomationLocaleCatalog is not an official generated catalog") end
    count+=1
   end
   if #body>0 and count==0 then error("AutomationLocaleCatalog is not an official generated catalog") end
  end
 end
 table.insert(objects,{parent=parent,name=name,existing=existing,target=target})
end
for _,item in ipairs(objects) do
 local object=item.existing or Instance.new(item.target.className)
 object.Name=item.name
 object.Source=item.target.source
 if object.Parent~=item.parent then object.Parent=item.parent end
end
return {paths={"ReplicatedStorage/AutomationLocaleCatalog","ReplicatedStorage/AutomationI18n","StarterPlayer/StarterPlayerScripts/AutomationLocalization"},catalogHash=${gameLocalizationLuaString(artifact.sourceHashes[ownedPaths[0]])}}`;
}

// Lists which reserved localization objects do not exist yet. Joined into a
// string: Studio serialises Luau arrays as {"1":...} objects.
export function nativeLocalizationProbeCode() {
  return `local out={} for _,p in ipairs({${ownedPaths.map((p) => gameLocalizationLuaString(p)).join(",")}}) do local parts=string.split(p,"/") local cur=game:GetService(parts[1]) for i=2,#parts do cur=cur and cur:FindFirstChild(parts[i]) end if not cur then table.insert(out,p) end end return {missing=table.concat(out,"|")}`;
}

export async function applyNativeLocalizationUnderLease(
  artifact: NativeLocalizationArtifact,
  controls: {
    lease: () => void;
    identity: () => Promise<unknown>;
    studioState: () => Promise<string>;
    apply: (code: string) => Promise<void>;
    // Studio's execute_luau thread may not reparent new objects into
    // ReplicatedStorage (capability "Network"); missing objects are created
    // through the script editing tool with their canonical source first.
    probe?: (code: string) => Promise<{ missing?: unknown }>;
    create?: (path: string, className: string, source: string) => Promise<void>;
  },
) {
  controls.lease();
  await controls.identity();
  controls.lease();
  const mode = await controls.studioState();
  if (!/^\s*Edit\b/i.test(mode.trim()) && !/Current Studio Mode\s*:\s*Edit\b/i.test(mode))
    throw new Error("Официальную локализацию можно установить только в подтверждённом Edit mode");
  await controls.identity();
  controls.lease();
  const created: string[] = [];
  if (controls.probe && controls.create) {
    const probed = await controls.probe(nativeLocalizationProbeCode());
    const missing =
      typeof probed?.missing === "string" && probed.missing
        ? probed.missing.split("|")
        : [];
    for (const path of missing) {
      if (typeof path !== "string" || !ownedPaths.includes(path as any))
        throw new Error("Studio вернула неожиданный путь локализации");
      controls.lease();
      const target = artifact.sources[path]!;
      await controls.create(path, target.className, target.source);
      created.push(path);
    }
    controls.lease();
  }
  await controls.apply(nativeLocalizationInstallerCode(artifact, created));
  controls.lease();
  await controls.identity();
}

export function verifyNativeLocalizationSnapshot(artifact: unknown, instances: Array<{ path: string; className: string; source?: string }>) {
  const saved = artifact as NativeLocalizationArtifact;
  if (!saved || saved.sourceLocaleId !== "en-us" || !saved.sources || !saved.sourceHashes || !Array.isArray(saved.files))
    throw new Error("Нет подтверждённого артефакта локализации текущей задачи");
  const regenerated = prepareNativeLocalization({ sourceLocaleId: "en-us", entries: saved.entries });
  if (regenerated.artifactHash !== saved.artifactHash || hash(regenerated) !== hash(saved))
    throw new Error("Артефакт локализации не совпадает с официальным генератором");
  for (const path of ownedPaths) {
    const matches = instances.filter((item) => item.path === path);
    if (matches.length !== 1)
      throw new Error("Снимок Studio должен содержать ровно один официальный объект: " + path);
    const instance = matches[0];
    if (!instance || instance.className !== saved.sources[path].className || !instance.source || sha256(instance.source) !== saved.sourceHashes[path])
      throw new Error("Снимок Studio не содержит проверенный официальный модуль: " + path);
  }
  return { data: saved.data, files: saved.files };
}

export function assertNativeLocalizationUnchanged(
  previous: Array<{ path: string; className: string; source?: string }>,
  current: Array<{ path: string; className: string; source?: string }>,
) {
  for (const path of ownedPaths) {
    const oldItems = previous.filter((item) => item.path === path);
    const newItems = current.filter((item) => item.path === path);
    if (oldItems.length > 1 || newItems.length > 1)
      throw new Error("Найдены повторные зарезервированные объекты локализации: " + path);
    if (oldItems.length !== newItems.length)
      throw new Error("Зарезервированные объекты локализации изменены без подтверждённого prepare_localization текущей попытки; запустите prepare_localization перед снимком: " + path);
    if (oldItems.length === 1) {
      const oldItem = oldItems[0]!;
      const newItem = newItems[0]!;
      if (oldItem.className !== newItem.className || !oldItem.source || !newItem.source || sha256(oldItem.source) !== sha256(newItem.source))
        throw new Error("Зарезервированные объекты локализации изменены без подтверждённого prepare_localization текущей попытки; запустите prepare_localization перед снимком: " + path);
    }
  }
}

export function generatedEmptyNativeCatalogSource() {
  const manifest: Manifest = {
    summary: "Empty official catalog fixture",
    deletions: [], files: [], instances: [], checks: [], findings: [],
    data: { localization: { sourceLocaleId: "en-us", entries: [] } },
  };
  prepareGameLocalization(manifest);
  return manifest.instances.find((item) => item.path === ownedPaths[0])!.source!;
}

export function nativeLocalizationArtifactFromJournal(records: any[], taskId: string, attempt: number) {
  const record = [...records].reverse().find((item) =>
    item.tool === "prepare_localization" && item.success === true && item.taskId === taskId && item.attempt === attempt,
  );
  if (!record) return undefined;
  const localization = record.generatedLocalization;
  const regenerated = prepareNativeLocalization({
    sourceLocaleId: localization?.sourceLocaleId,
    entries: localization?.entries,
  });
  if (record.artifactHash !== regenerated.artifactHash || hash(record.generatedFiles) !== hash(regenerated.files) || hash(record.generatedSourceHashes) !== hash(regenerated.sourceHashes))
    throw new Error("Журнал официальной локализации не совпадает с каноническим генератором");
  return regenerated;
}

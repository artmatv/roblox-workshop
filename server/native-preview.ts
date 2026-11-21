import { z } from "zod";
import { manifestSchema, type Manifest, type Task } from "../shared/domain.js";
import { hash } from "./store.js";
export const LIGHTING_PROPERTIES = [
  "Brightness",
  "ClockTime",
  "Ambient",
  "OutdoorAmbient",
  "FogColor",
  "FogStart",
  "FogEnd",
] as const;
export function validateServiceProperties(manifest: Manifest) {
  for (const node of manifest.instances.filter((i) => !i.path.includes("/"))) {
    if (node.path !== "Lighting" || node.className !== "Lighting")
      throw new Error(
        "Свойства сервисов разрешены только в корневом Lighting; остальные объекты задаются дочерними путями",
      );
    const unsupported = Object.keys(node.properties).filter(
      (key) =>
        !(key === "Name" && node.properties.Name === node.path) &&
        !(LIGHTING_PROPERTIES as readonly string[]).includes(key),
    );
    if (unsupported.length)
      throw new Error(
        "Lighting: не поддерживаются " +
          unsupported.join(", ") +
          ". Разрешены " +
          LIGHTING_PROPERTIES.join(", ") +
          "; эффекты оформляйте дочерними объектами Lighting.",
      );
  }
}

export function isCompleteNativePreview(m: Manifest | null | undefined) {
  return (
    !!m &&
    m.data.complete !== false &&
    m.instances.some(
      (i) =>
        i.path.startsWith("Workspace/") &&
        ["Model", "Part", "MeshPart", "WedgePart"].includes(i.className),
    ) &&
    m.instances.some((i) => i.className === "ScreenGui") &&
    m.instances.some((i) =>
      ["TextLabel", "TextButton"].includes(i.className),
    ) &&
    m.instances.some(
      (i) => i.path === "ServerStorage/AutomationTests" && i.source,
    )
  );
}

export function mergeNativePreviewPatch(
  result: Manifest,
  task: Task,
  base?: Task,
): Manifest {
  if (!result.data.previewPatch) return result;
  const patch = z
    .object({ baseTaskId: z.string(), baseHash: z.string().length(64) })
    .parse(result.data.previewPatch);
  if (
    !base?.result ||
    patch.baseTaskId !== task.previewBaseTaskId ||
    patch.baseTaskId !== base.id ||
    patch.baseHash !== task.previewBaseHash ||
    hash(base.result) !== patch.baseHash ||
    base.projectId !== task.projectId ||
    base.previewStyleId !== task.previewStyleId ||
    !isCompleteNativePreview(base.result)
  )
    throw new Error(
      "Основа исправления демонстрации устарела или принадлежит другому стилю",
    );
  const nodes = new Map(
    base.result.instances.map((i) => [i.path, structuredClone(i)]),
  );
  for (const path of result.deletions)
    for (const key of nodes.keys())
      if (key === path || key.startsWith(path + "/")) nodes.delete(key);
  for (const i of result.instances) nodes.set(i.path, i);
  const files = new Map(base.result.files.map((f) => [f.path, f]));
  for (const f of result.files) files.set(f.path, f);
  const data = { ...base.result.data, ...result.data };
  delete data.previewPatch;
  return manifestSchema.parse({
    ...result,
    instances: [...nodes.values()],
    files: [...files.values()],
    data,
  });
}

import { readFileSync } from "node:fs";
import { hash } from "./store.js";
import type { Manifest } from "../shared/domain.js";
const source = () =>
  readFileSync(new URL("./preview-environment.luau", import.meta.url), "utf8");
const scriptPath =
  "StarterPlayer/StarterPlayerScripts/AutomationPreviewEnvironment";
const parts = new Set([
  "Part",
  "WedgePart",
  "CornerWedgePart",
  "MeshPart",
  "SpawnLocation",
  "Seat",
  "VehicleSeat",
  "TrussPart",
  "UnionOperation",
]);
export function preparePreviewEnvironment(
  manifest: Manifest,
  baseline?: Manifest,
) {
  const before = hash(manifest.instances),
    declared = new Set(manifest.instances.map((i) => i.path));
  const paths = (baseline?.instances || [])
    .filter(
      (i) =>
        i.path.startsWith("Workspace/") &&
        parts.has(i.className) &&
        !declared.has(i.path),
    )
    .map((i) => i.path);
  manifest.instances = manifest.instances.filter((i) => i.path !== scriptPath);
  if (!declared.has("StarterPlayer/StarterPlayerScripts"))
    manifest.instances.push({
      path: "StarterPlayer/StarterPlayerScripts",
      className: "StarterPlayerScripts",
      properties: {},
    });
  manifest.instances.push({
    path: scriptPath,
    className: "LocalScript",
    properties: {},
    source: source().replace(
      "__BASELINE_PATHS__",
      paths.map((p) => "[" + JSON.stringify(p) + "]=true").join(","),
    ),
  });
  return before !== hash(manifest.instances);
}

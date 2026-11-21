import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store, hash } from "./store.js";
import { importSkill } from "./skills.js";
import { now, type Project, type Skill } from "../shared/domain.js";

export const DEFAULT_SKILL_IDS = [
  "game-ui-ux",
  "roblox-luau",
  "roblox-datastores",
  "roblox-ui",
  "create-game-assets",
  "roblox-ui-styles",
  "sypho-roblox-map",
  "sypho-roblox-sfx",
  "sypho-roblox-ui-tools",
  "sypho-roblox-animation",
  "sypho-roblox-3d-model",
  "sypho-roblox-vfx",
] as const;
const commit = "19d93f97c9c1ea0f8b306e77aa81e0d3e352d3e9";
const syphoCommit = "5aad881d1e6553cc3671ad549fdf01b8191bdc37";
const approvedPackages: Record<string, string> = {
  "roblox-ui-styles":
    "5030175855e4c1e771ced345929b281b6a65f0a8ba4daaaaf55548c629a19848",
  "game-ui-ux":
    "0453e5c1c55eae89f31cd4d5ecb350e8feb52de1279936690bb093cd589015be",
  "roblox-luau":
    "c6ecfed41e03c09eb9fbffa7a7c1ddfbeb420e35cfdb3d989196fb3f8126f484",
  "roblox-datastores":
    "e9caa8ecf21fbcd2acc83629f96f2cdf1c2a744042513e1c581913bb1292ee2d",
  "roblox-ui":
    "2fb33044851cb2a26e542bbf2d1dfd5735ee84addd0351f0a6f462cb4ce360f6",
  "create-game-assets":
    "bfec6a304211d710afd1d4584527642f103e19dbc7b12e54cde8fe869c91b348",
  "sypho-roblox-map":
    "faeaf38fe93feee52ad897dcd3cc385ee68dade5e16b5ed2cf02eca86ebada04",
  "sypho-roblox-sfx":
    "c5557f43ffadcc89d50fde04cb804de5e750810634a62ec412c73c4a835acb90",
  "sypho-roblox-ui-tools":
    "6fd14945177d9b23b19130dfada892488aa33ac2623654c20be502e4ee9ae669",
  "sypho-roblox-animation":
    "7a960eaf3f14489c441a737e98addec5388bbb9878f18920e1609138532da6d8",
  "sypho-roblox-3d-model":
    "7ba9ec4342e011d08fe5da798705c506841cddcc9a648377ae8d5f1cf76f3825",
  "sypho-roblox-vfx":
    "788868a56d78a831e807c372b4f8ff3b6964e26102511842a3700a5f3b3a903b",
};
// Only the locally bundled, reviewed revision is seeded. No network or bundled scripts run here.
export function seedDefaultSkills(store: Store) {
  const root = resolve(import.meta.dirname, "../docs/skill-imports");
  for (const id of DEFAULT_SKILL_IDS) {
    const existing = store.get<Skill>("skill", id);
    if (existing?.status === "disabled" || existing?.instructions) continue;
    const path = resolve(root, id + ".json");
    if (!existsSync(path)) {
      store.event(null, "skill.default.unavailable", {
        id,
        reason: "Bundled package missing",
      });
      continue;
    }
    const pack = JSON.parse(readFileSync(path, "utf8"));
    if (
      pack.id !== id ||
      pack.version !==
        (id.startsWith("sypho-")
          ? syphoCommit + "-workshop.1"
          : id === "roblox-ui-styles"
            ? "1.0.0"
            : commit) ||
      hash(
        pack.files
          .slice()
          .sort((a: any, b: any) => a.path.localeCompare(b.path)),
      ) !== approvedPackages[id]
    )
      throw new Error("Изменён проверенный пакет навыка " + id);
    const { skill } = importSkill(store, pack);
    skill.status = "reviewed";
    skill.checkedAt = now();
    store.put("skill", skill);
    store.event(null, "skill.default.loaded", {
      id,
      version: skill.version,
      hash: skill.hash,
      profileValidation: "pending",
    });
  }
}
export function assignDefaultSkills(store: Store, p: Project) {
  const added: Skill[] = [];
  for (const id of DEFAULT_SKILL_IDS) {
    if (p.skillPins[id]) continue;
    if (id === "roblox-ui" && p.skillPins["roblox-gui"]) continue;
    const s = store.get<Skill>("skill", id);
    if (
      !s ||
      !["reviewed", "connected", "incompatible"].includes(s.status) ||
      !s.checkedAt ||
      !s.instructions ||
      hash(s.instructions) !== s.hash
    )
      continue;
    if (s.dependencies.some((dep) => !p.skillPins[dep])) continue;
    p.skillPins[id] = s.hash;
    added.push(s);
  }
  if (p.skillPins["roblox-ui"] || p.skillPins["roblox-gui"])
    delete p.skillPins["local-ui"];
  if (added.length) {
    store.put("project", p);
    store.event(p.id, "skill.autoAssigned", {
      skills: added.map((s) => ({
        id: s.id,
        version: s.version,
        hash: s.hash,
        roles: s.roles,
      })),
      selection: "task-role",
      executionCompatibility: "checked before execution",
    });
  }
  return added;
}

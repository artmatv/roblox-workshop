import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const request = async (path: string, body: any) => {
  const r = await fetch("http://127.0.0.1:4317/api" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
};
const controls = JSON.parse(
    readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
  ),
  report = [];
for (const id of [
  "game-ui-ux",
  "roblox-luau",
  "roblox-datastores",
  "roblox-ui",
  "create-game-assets",
]) {
  const pack = JSON.parse(
    readFileSync(resolve(root, "docs/skill-imports", id + ".json"), "utf8"),
  );
  const imported = await request("/skills/import", pack);
  const verified = await request("/skills/" + id + "/verify", {});
  if (verified.skill.status !== "connected")
    throw new Error(id + ": missing " + verified.missing.join(", "));
  for (const project of controls.projects)
    await request("/projects/" + project.id + "/skills/pin", { skillId: id });
  report.push({
    id,
    source: pack.source,
    version: pack.version,
    license: pack.license,
    files: pack.files.length,
    hash: imported.skill.hash,
    packageHash: imported.packageHash,
    compatibilityCheckedAt: verified.skill.checkedAt,
    profileTaskValidated: false,
  });
}
writeFileSync(
  resolve(root, "docs/skill-imports/installed.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      review:
        "Source instructions, references, fixture data and Python source reviewed. Scripts not executed. One Roblox UI primary per project; Studio profile validation remains separate.",
      packages: report,
      projects: controls.projects.map((p: any) => p.id),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    report.map((p) => ({
      id: p.id,
      files: p.files,
      version: p.version.slice(0, 12),
      profileTaskValidated: p.profileTaskValidated,
    })),
    null,
    2,
  ),
);

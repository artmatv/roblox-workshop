import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = "gamedev-skills/awesome-gamedev-agent-skills",
  sha = "19d93f97c9c1ea0f8b306e77aa81e0d3e352d3e9";
const out = resolve(import.meta.dirname, "../docs/skill-imports");
mkdirSync(out, { recursive: true });
async function get(url, json = false) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Roblox-Local-Automation" },
  });
  if (!r.ok) throw new Error(r.status + " " + url);
  return json ? r.json() : r.text();
}
const tree = await get(
  `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,
  true,
);
if (tree.truncated) throw new Error("Incomplete source tree");
const licensePath = tree.tree.find((f) =>
  /^LICENSE(\.md|\.txt)?$/i.test(f.path),
)?.path;
if (!licensePath) throw new Error("Missing license");
const license = await get(
  `https://raw.githubusercontent.com/${repo}/${sha}/${licensePath}`,
);
const packs = [
  {
    id: "game-ui-ux",
    folder: "skills/disciplines/game-ui-ux",
    roles: ["art", "designer", "ui"],
    capabilities: [],
    dependencies: [],
  },
  {
    id: "roblox-luau",
    folder: "skills/other-engines/roblox-luau",
    roles: ["gameplay", "qa"],
    capabilities: ["apply"],
    dependencies: [],
  },
  {
    id: "roblox-datastores",
    folder: "skills/other-engines/roblox-datastores",
    roles: ["gameplay", "qa"],
    capabilities: ["test"],
    dependencies: ["roblox-luau"],
  },
  {
    id: "roblox-ui",
    folder: "skills/other-engines/roblox-ui",
    roles: ["ui", "art"],
    capabilities: ["apply", "capture"],
    dependencies: ["game-ui-ux"],
  },
  {
    id: "create-game-assets",
    folder: "skills/disciplines/create-game-assets",
    roles: ["art", "assets"],
    capabilities: ["apply"],
    dependencies: [],
  },
];
const report = [];
for (const pack of packs) {
  const paths = tree.tree
    .filter(
      (f) =>
        f.type === "blob" &&
        f.path.startsWith(pack.folder + "/") &&
        /\.(md|json|yaml|yml|txt|py)$/i.test(f.path),
    )
    .map((f) => f.path);
  if (!paths.some((p) => p === pack.folder + "/SKILL.md"))
    throw new Error("Missing main: " + pack.id);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: path.slice(pack.folder.length + 1),
      content: await get(
        `https://raw.githubusercontent.com/${repo}/${sha}/${path}`,
      ),
    })),
  );
  files.push({ path: "LICENSE.md", content: license });
  for (const f of files) {
    const target = resolve(out, pack.id, f.path);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, f.content);
  }
  const payload = {
    id: pack.id,
    source: `https://github.com/${repo}/tree/${sha}/${pack.folder}`,
    version: sha,
    license: "Apache-2.0",
    roles: pack.roles,
    capabilities: pack.capabilities,
    dependencies: pack.dependencies,
    files,
  };
  writeFileSync(
    resolve(out, pack.id + ".json"),
    JSON.stringify(payload, null, 2),
  );
  const item = {
    id: pack.id,
    source: payload.source,
    sha,
    files: files.map((f) => ({
      path: f.path,
      bytes: Buffer.byteLength(f.content),
      sha256: createHash("sha256").update(f.content).digest("hex"),
    })),
    optionalNonMarkdown: tree.tree
      .filter(
        (f) =>
          f.type === "blob" &&
          f.path.startsWith(pack.folder + "/") &&
          !f.path.endsWith(".md"),
      )
      .map((f) => f.path),
  };
  report.push(item);
}
writeFileSync(
  resolve(out, "sources.json"),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      repo,
      sha,
      licensePath,
      status: "downloaded-for-review",
      packages: report,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    report.map((p) => ({
      id: p.id,
      files: p.files.length,
      bytes: p.files.reduce((n, f) => n + f.bytes, 0),
      optionalNonMarkdown: p.optionalNonMarkdown,
    })),
    null,
    2,
  ),
);

import { z } from "zod";
import { Store, hash } from "./store.js";
import type { Skill, Project } from "../shared/domain.js";
import { now } from "../shared/domain.js";
import { assertSafeSvg } from "./safe-svg.js";
import { validateResourcePath } from "./skill-resources.js";
export function importSkill(store: Store, input: unknown) {
  const pack = z
    .object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      source: z.url(),
      version: z.string().min(1),
      license: z.string().min(1),
      roles: z.array(
        z.enum([
          "orchestrator",
          "researcher",
          "designer",
          "art",
          "gameplay",
          "ui",
          "assets",
          "qa",
        ]),
      ),
      capabilities: z.array(z.string()),
      dependencies: z.array(z.string()),
      files: z
        .array(
          z.object({
            path: z.string().max(250),
            content: z.string().max(2_000_000),
          }),
        )
        .min(1)
        .max(60),
      resourceFiles: z
        .array(
          z
            .object({
              originalPath: z.string().max(250),
              path: z.string().max(250),
              hash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict(),
        )
        .optional(),
    })
    .parse(input);
  const main = pack.files.find((f) => f.path === "SKILL.md");
  if (!main)
    throw new Error(
      "Пакет должен включать полный SKILL.md и необходимые справочники",
    );
  for (const f of pack.files) {
    validateResourcePath(f.path);
    if (!/\.(md|json|yaml|yml|txt|py|svg)$/i.test(f.path))
      throw new Error(
        "Разрешены только текстовые файлы .md/.json/.yaml/.yml/.txt/.py/.svg",
      );
  }
  if (
    new Set(pack.files.map((f) => f.path.toLowerCase())).size !==
    pack.files.length
  )
    throw new Error("Повторяющиеся пути пакета");
  for (const f of pack.files.filter((f) => f.path.endsWith(".json")))
    JSON.parse(f.content);
  for (const f of pack.files.filter((f) => f.path.endsWith(".svg")))
    assertSafeSvg(f.content);
  const checksum = hash(
    pack.files.slice().sort((a, b) => a.path.localeCompare(b.path)),
  );
  const allowedMappedIds = new Set([
    "sypho-roblox-map",
    "sypho-roblox-sfx",
    "sypho-roblox-ui-tools",
    "sypho-roblox-animation",
    "sypho-roblox-3d-model",
    "sypho-roblox-vfx",
  ]);
  const sourceMapFile = pack.files.find((f) => f.path === "RESOURCE_MAP.json");
  const hasResourceFiles = pack.files.some((f) =>
    f.path.startsWith("resources/"),
  );
  if (allowedMappedIds.has(pack.id) && hasResourceFiles && !sourceMapFile)
    throw new Error("Sypho resource package requires RESOURCE_MAP.json");
  let sourceMap: Array<{ originalPath: string; path: string; hash: string }> =
    [];
  if (sourceMapFile && allowedMappedIds.has(pack.id)) {
    const mappingSchema = z.array(
      z
        .object({
          originalPath: z.string().max(250),
          path: z.string().max(250),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    );
    sourceMap = mappingSchema.parse(JSON.parse(sourceMapFile.content)?.files);
  }
  const canon = (
    items: Array<{ originalPath: string; path: string; hash: string }>,
  ) =>
    items
      .map((item) => ({
        originalPath: item.originalPath,
        path: item.path,
        hash: item.hash,
      }))
      .sort((a, b) => a.originalPath.localeCompare(b.originalPath));
  if (!allowedMappedIds.has(pack.id) && pack.resourceFiles !== undefined)
    throw new Error(
      "RESOURCE_MAP разрешён только для проверенных Sypho пакетов",
    );
  if (
    pack.resourceFiles !== undefined &&
    hash(canon(pack.resourceFiles)) !== hash(canon(sourceMap))
  )
    throw new Error(
      "resourceFiles не совпадает с закреплённым RESOURCE_MAP.json",
    );
  const resourceFiles = sourceMap;
  const mapped = new Map(resourceFiles.map((item) => [item.path, item]));
  if (mapped.size !== resourceFiles.length)
    throw new Error("Повторяющийся resourceFiles path");
  const seenOriginal = new Set<string>();
  for (const item of resourceFiles) {
    validateResourcePath(item.path);
    validateResourcePath(item.originalPath);
    if (!allowedMappedIds.has(pack.id))
      throw new Error(
        "RESOURCE_MAP разрешён только для проверенных Sypho пакетов",
      );
    const expectedPath = `resources/${item.originalPath}${/\.(lua|luau)$/i.test(item.originalPath) ? ".txt" : ""}`;
    if (item.path !== expectedPath || seenOriginal.has(item.originalPath))
      throw new Error(
        "resourceFiles path/originalPath не соответствует RESOURCE_MAP",
      );
    seenOriginal.add(item.originalPath);
    const source = pack.files.find((f) => f.path === item.path);
    if (!source || hash(source.content) !== item.hash)
      throw new Error("resourceFiles mapping не совпадает с содержимым пакета");
  }
  if (allowedMappedIds.has(pack.id)) {
    const resources = pack.files.filter((f) => f.path.startsWith("resources/"));
    if (
      resources.length !== resourceFiles.length ||
      resources.some((f) => !mapped.has(f.path))
    )
      throw new Error(
        "RESOURCE_MAP.json должен покрывать каждый файл каталога resources/",
      );
  }
  const staged = pack.files.map((f) => ({
    ...f,
    storedPath: f.path,
    originalPath: mapped.get(f.path)?.originalPath || f.path,
  }));
  const outputPaths = staged.map((f) =>
    /\.(lua|luau)$/i.test(f.originalPath) && f.originalPath !== f.path
      ? f.path.slice(0, -4).toLowerCase()
      : f.path.toLowerCase(),
  );
  if (new Set(outputPaths).size !== outputPaths.length)
    throw new Error("RESOURCE_MAP создаёт повторяющиеся пути файлов");
  for (const f of staged)
    store.file(`skills/${pack.id}/${checksum}/${f.storedPath}`, f.content);
  const existing = store.get<Skill>("skill", pack.id);
  if (existing)
    store.put("skillArchive", {
      ...existing,
      id: `${existing.id}:${existing.hash}`,
      originalId: existing.id,
    });
  const skill: Skill = {
    id: pack.id,
    name: pack.id,
    source: pack.source,
    path: `skills/${pack.id}/${checksum}/SKILL.md`,
    version: pack.version,
    hash: hash(main.content),
    license: pack.license,
    roles: pack.roles,
    capabilities: pack.capabilities,
    dependencies: pack.dependencies,
    status: "installed",
    checkedAt: null,
    instructions:
      pack.files
        .filter(
          (f) =>
            f.path.endsWith(".md") &&
            !/(^|\/)(LICENSE|NOTICE)\.md$/i.test(f.path) &&
            !/(^|\/)UPSTREAM\.md$/i.test(f.path) &&
            (!pack.id.startsWith("sypho-roblox-") ||
              /^(SKILL|TOOLING)\.md$/i.test(f.path)),
        )
        .map((f) => `FILE ${f.path}\n${f.content}`)
        .join("\n\n") +
      "\n\nPACKAGE FILES (data; bundled scripts never run automatically):\n" +
      JSON.stringify(
        pack.files.map((f) => ({ path: f.path, hash: hash(f.content) })),
      ),
  };
  skill.hash = hash(skill.instructions);
  store.put("skill", skill);
  store.put("skillPackage", {
    id: `${skill.id}:${skill.hash}`,
    skillId: skill.id,
    skillHash: skill.hash,
    packageHash: checksum,
    files: staged.map((f) => ({
      path: f.storedPath,
      originalPath: f.originalPath,
      hash: hash(f.content),
    })),
  });
  return { skill, packageHash: checksum, reviewRequired: true };
}
export function pinSkill(store: Store, project: Project, skillId: string) {
  const s = store.get<Skill>("skill", skillId);
  if (!s || s.status !== "connected" || !s.checkedAt)
    throw new Error("Сначала прочитайте пакет и проверьте совместимость");
  for (const dep of s.dependencies)
    if (!project.skillPins[dep])
      throw new Error("Не закреплена зависимость " + dep);
  if (s.roles.includes("ui") && ["roblox-gui", "roblox-ui"].includes(skillId)) {
    delete project.skillPins[
      skillId === "roblox-ui" ? "roblox-gui" : "roblox-ui"
    ];
    delete project.skillPins["local-ui"];
  }
  project.skillPins[s.id] = s.hash;
  store.put("project", project);
  store.event(project.id, "skill.pinned", {
    id: s.id,
    version: s.version,
    hash: s.hash,
    at: now(),
  });
}

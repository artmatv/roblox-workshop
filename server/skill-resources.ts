import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { renameSync, unlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { hash, safePath, type Store } from "./store.js";
import type { Skill } from "../shared/domain.js";

export type SkillPackage = {
  id: string;
  skillId: string;
  skillHash: string;
  packageHash: string;
  files: Array<{ path: string; originalPath: string; hash: string }>;
};

export function validateResourcePath(path: string) {
  if (
    !path ||
    path.length > 250 ||
    path.includes("\\") ||
    path.includes(":") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path)
  )
    throw new Error("Недопустимый путь ресурса навыка");
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith(".")))
    throw new Error("Недопустимый путь ресурса навыка");
  if (!/\.(md|json|yaml|yml|txt|py|svg|lua|luau)(\.txt)?$/i.test(path))
    throw new Error("Неподдерживаемый текстовый ресурс навыка");
  return path;
}

function inside(root: string, file: string) {
  const base = realpathSync(root),
    actual = realpathSync(file),
    rel = relative(base, actual);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Ресурс вышел за пределы каталога навыка");
  return actual;
}

function ensureSafeDirectory(root: string, destination: string) {
  const base = realpathSync(root);
  const rel = relative(base, destination);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Каталог ресурсов вне workspace");
  let cursor = base;
  for (const part of rel.split(sep)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("Ссылки и файлы в пути ресурсов запрещены");
      inside(base, cursor);
    } else mkdirSync(cursor);
  }
}

export function resetActiveSkills(workspace: string) {
  const skillsDir = resolve(workspace, "skills");
  ensureSafeDirectory(workspace, skillsDir);
  writeManagedActive(workspace, { managedBy: "roblox-workshop", active: [] });
}

// Every run materializes its own copy of each pinned package and ACTIVE.json
// lists only those, so the copies of earlier runs are never read again. Links
// inside are removed as links; their targets are not touched.
export async function clearSkillCopies(workspace: string) {
  const skillsDir = resolve(workspace, "skills");
  ensureSafeDirectory(workspace, skillsDir);
  for (const name of ["packages", "instructions"])
    await rm(resolve(skillsDir, name), {
      recursive: true,
      force: true,
      maxRetries: 2,
    });
}

export function writeActiveSkills(workspace: string, active: any[]) {
  writeManagedActive(workspace, { managedBy: "roblox-workshop", active });
}

export function materializeSkillResources(
  store: Store,
  workspace: string,
  skill: Skill,
  packageRecord?: SkillPackage,
) {
  if (
    !skill.path.startsWith(`skills/${skill.id}/`) ||
    hash(skill.instructions) !== skill.hash
  )
    throw new Error(`Закреплённый навык ${skill.id} повреждён`);
  const sourceRoot = dirname(safePath(store.root, skill.path));
  const pkg = packageRecord || legacyPackage(skill);
  if (!pkg) {
    const generation = randomBytes(5).toString("hex");
    const instructionPath = `skills/instructions/${skill.id}/${skill.hash}/${generation}.md`;
    writeSafe(
      workspace,
      resolve(workspace, ...instructionPath.split("/")),
      skill.instructions,
    );
    const active = {
      id: skill.id,
      hash: skill.hash,
      instructionPath,
      root: null,
      packageHash: null,
      files: [],
    };
    return active;
  }
  if (pkg.skillHash !== skill.hash || pkg.skillId !== skill.id)
    throw new Error(
      `Метаданные ресурсов ${skill.id} не соответствуют закреплённому навыку`,
    );
  const packageBytes = pkg.files
    .map((f) => ({
      path: f.path,
      content: readCacheFile(store, skill, sourceRoot, f),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const actualPackageHash = hash(packageBytes);
  if (pkg.packageHash && actualPackageHash !== pkg.packageHash)
    throw new Error(`Контрольная сумма пакета ${skill.id} не совпала`);
  const storedContents = new Map(packageBytes.map((f) => [f.path, f.content]));
  const mappedFiles = pkg.files.filter((f) => f.originalPath !== f.path);
  const resourceMapContent = storedContents.get("RESOURCE_MAP.json");
  if (mappedFiles.length) {
    if (!resourceMapContent)
      throw new Error(`Нет закреплённого RESOURCE_MAP.json у ${skill.id}`);
    let listed: any;
    try {
      listed = JSON.parse(resourceMapContent)?.files;
    } catch {
      throw new Error(`Повреждён RESOURCE_MAP.json у ${skill.id}`);
    }
    const canon = (files: any[]) =>
      files
        .map((f) => ({
          originalPath: f.originalPath,
          path: f.path,
          hash: f.hash,
        }))
        .sort((a, b) => a.originalPath.localeCompare(b.originalPath));
    if (
      !Array.isArray(listed) ||
      hash(canon(listed)) !==
        hash(
          canon(
            mappedFiles.map((f) => ({
              originalPath: f.originalPath,
              path: f.path,
              hash: f.hash,
            })),
          ),
        )
    )
      throw new Error(
        `Закреплённый RESOURCE_MAP.json не совпадает с metadata ${skill.id}`,
      );
  }
  if (
    ["sypho-roblox-map", "sypho-roblox-sfx", "sypho-roblox-ui-tools", "sypho-roblox-animation", "sypho-roblox-3d-model", "sypho-roblox-vfx"].includes(
      skill.id,
    )
  ) {
    const resources = pkg.files.filter((f) => f.path.startsWith("resources/"));
    if (
      resources.length !== mappedFiles.length ||
      resources.some((f) => !mappedFiles.includes(f))
    )
      throw new Error(`Неполное сопоставление ресурсов ${skill.id}`);
  }
  const generation = randomBytes(5).toString("hex");
  const packageRoot = `skills/packages/${skill.id}/${skill.hash}/${generation}`;
  const instructionPath = `skills/instructions/${skill.id}/${skill.hash}/${generation}.md`;
  const targetRoot = resolve(workspace, ...packageRoot.split("/"));
  ensureSafeDirectory(workspace, dirname(targetRoot));
  mkdirSync(targetRoot);
  const manifestFiles = [];
  const outputPaths = new Set<string>();
  for (const entry of pkg.files) {
    validateResourcePath(entry.path);
    validateResourcePath(entry.originalPath);
    const content = storedContents.get(entry.path)!;
    const isLuaMapping =
      entry.originalPath !== entry.path &&
      /\.(lua|luau)$/i.test(entry.originalPath);
    const expectedPath =
      entry.originalPath !== entry.path
        ? `resources/${entry.originalPath}${isLuaMapping ? ".txt" : ""}`
        : entry.path;
    if (entry.originalPath !== entry.path && entry.path !== expectedPath)
      throw new Error(`RESOURCE_MAP path mismatch: ${entry.path}`);
    const outputPath = isLuaMapping ? entry.path.slice(0, -4) : entry.path;
    validateResourcePath(outputPath);
    if (outputPaths.has(outputPath))
      throw new Error(`Повторяющийся путь ресурса ${outputPath}`);
    outputPaths.add(outputPath);
    const destination = resolve(targetRoot, ...outputPath.split("/"));
    writeSafe(workspace, destination, content);
    manifestFiles.push({
      path: outputPath,
      originalPath: entry.originalPath,
      hash: entry.hash,
    });
  }
  writeSafe(
    workspace,
    resolve(workspace, ...instructionPath.split("/")),
    skill.instructions,
  );
  const active = {
    id: skill.id,
    hash: skill.hash,
    instructionPath,
    root: packageRoot,
    packageHash: actualPackageHash,
    files: manifestFiles,
  };
  return active;
}

function writeSafe(root: string, file: string, content: string) {
  const parent = dirname(file);
  ensureSafeDirectory(root, parent);
  if (pathExists(file))
    throw new Error("Файл уже существует в уникальном каталоге ресурсов");
  const temp = resolve(parent, `.skill-${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}

function writeManagedActive(workspace: string, index: any) {
  const file = resolve(workspace, "skills", "ACTIVE.json");
  ensureSafeDirectory(workspace, dirname(file));
  if (pathExists(file)) {
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 256_000 ||
      realpathSync(file).toLowerCase() !== file.toLowerCase()
    )
      throw new Error(
        "ACTIVE.json должен быть обычным файлом мастерской без ссылок",
      );
    let prior: any;
    try {
      prior = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error("Некорректный ACTIVE.json");
    }
    if (prior.managedBy !== "roblox-workshop") {
      if (
        !prior ||
        typeof prior !== "object" ||
        !Array.isArray(prior.active) ||
        Object.keys(prior).some((key) => key !== "active")
      )
        throw new Error(
          "ACTIVE.json не принадлежит мастерской и не поддерживает безопасную миграцию",
        );
      index.migratedLegacy = prior;
    } else if (prior.migratedLegacy && !index.migratedLegacy)
      index.migratedLegacy = prior.migratedLegacy;
  }
  const temp = resolve(
    dirname(file),
    `.skill-active-${randomBytes(8).toString("hex")}.tmp`,
  );
  writeFileSync(temp, JSON.stringify(index, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}

function pathExists(file: string) {
  try {
    lstatSync(file);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readCacheFile(
  store: Store,
  skill: Skill,
  sourceRoot: string,
  entry: SkillPackage["files"][number],
) {
  const path = validateResourcePath(entry.path);
  const absolute = resolve(sourceRoot, ...path.split("/"));
  if (!existsSync(absolute))
    throw new Error(`Отсутствует ресурс ${skill.id}/${path}`);
  const checked = inside(resolve(store.root, "skills"), absolute);
  const content = readFileSync(checked, "utf8");
  if (hash(content) !== entry.hash)
    throw new Error(`Изменён кэшированный ресурс ${skill.id}/${path}`);
  return content;
}

function legacyPackage(skill: Skill): SkillPackage | undefined {
  const marker =
    "PACKAGE FILES (data; bundled scripts never run automatically):\n";
  const start = skill.instructions.lastIndexOf(marker);
  if (start < 0) return undefined;
  try {
    const listed = JSON.parse(
      skill.instructions.slice(start + marker.length).trim(),
    );
    if (!Array.isArray(listed)) throw new Error();
    const files = listed.map((item: any) => ({
      path: item.path,
      originalPath: item.path,
      hash: item.hash,
    }));
    return {
      id: `${skill.id}:${skill.hash}`,
      skillId: skill.id,
      skillHash: skill.hash,
      packageHash: "",
      files,
    };
  } catch {
    throw new Error(`Некорректный manifest ресурсов навыка ${skill.id}`);
  }
}

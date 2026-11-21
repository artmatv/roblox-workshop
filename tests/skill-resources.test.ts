import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Store, hash } from "../server/store.js";
import { importSkill } from "../server/skills.js";
import {
  clearSkillCopies,
  materializeSkillResources,
  resetActiveSkills,
  validateResourcePath,
  writeActiveSkills,
} from "../server/skill-resources.js";

function pack(
  id: string,
  version: string,
  more: Array<{ path: string; content: string }> = [],
) {
  return {
    id,
    source: "https://example.test/repo",
    version,
    license: "MIT",
    roles: ["ui"],
    capabilities: [],
    dependencies: [],
    files: [
      { path: "SKILL.md", content: `# ${version}\nUse this skill.` },
      {
        path: "UPSTREAM.md",
        content: "Do not inject upstream docs into instructions.",
      },
      { path: "refs/guide.md", content: "A useful reference." },
      { path: "scripts/check.py", content: "print('ok')" },
      { path: "data/sample.txt", content: "sample" },
      ...more,
    ],
  };
}
function setup() {
  const root = mkdtempSync(resolve(process.cwd(), ".tmp-skill-resources-"));
  const store = new Store(resolve(root, "store"));
  const workspace = resolve(root, "workspace");
  mkdirSync(workspace);
  return {
    root,
    store,
    workspace,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("materializes exact current/archive pins and all package resources without upstream markdown aggregation", () => {
  const f = setup();
  try {
    const old = importSkill(f.store, pack("archive-demo", "v1")).skill;
    importSkill(f.store, pack("archive-demo", "v2"));
    const current = importSkill(f.store, pack("current-demo", "v1")).skill;
    const archived = f.store.get<any>(
      "skillArchive",
      `archive-demo:${old.hash}`,
    )!;
    const archiveActive = materializeSkillResources(
      f.store,
      f.workspace,
      { ...archived, id: "archive-demo" },
      f.store.get<any>("skillPackage", `archive-demo:${old.hash}`),
    );
    const currentActive = materializeSkillResources(
      f.store,
      f.workspace,
      current,
      f.store.get<any>("skillPackage", `current-demo:${current.hash}`),
    );
    resetActiveSkills(f.workspace);
    writeActiveSkills(f.workspace, [archiveActive, currentActive]);
    assert.equal(archiveActive?.hash, old.hash);
    assert.equal(currentActive?.hash, current.hash);
    const index = JSON.parse(
      readFileSync(resolve(f.workspace, "skills/ACTIVE.json"), "utf8"),
    );
    assert.deepEqual(
      new Set(index.active.map((x: any) => x.id)),
      new Set(["archive-demo", "current-demo"]),
    );
    const archiveIndex = index.active.find((x: any) => x.id === "archive-demo");
    const instructions = readFileSync(
      resolve(f.workspace, archiveIndex.instructionPath),
      "utf8",
    );
    assert.equal(instructions.includes("Do not inject upstream docs"), false);
    assert.equal(instructions.includes("A useful reference."), true);
    assert.equal(
      readFileSync(
        resolve(f.workspace, archiveIndex.root, "scripts/check.py"),
        "utf8",
      ),
      "print('ok')",
    );
    assert.equal(
      readFileSync(
        resolve(f.workspace, archiveIndex.root, "data/sample.txt"),
        "utf8",
      ),
      "sample",
    );
  } finally {
    f.close();
  }
});

test("clears the package copies of earlier runs without following a link out of the workspace", async () => {
  const f = setup();
  try {
    const skill = importSkill(f.store, pack("current-demo", "v1")).skill;
    const record = f.store.get<any>("skillPackage", `current-demo:${skill.hash}`);
    const first = materializeSkillResources(f.store, f.workspace, skill, record)!;
    const outside = resolve(f.root, "outside");
    mkdirSync(outside);
    writeFileSync(resolve(outside, "keep.txt"), "preserve me");
    symlinkSync(outside, resolve(f.workspace, "skills/packages/linked"), "junction");
    await clearSkillCopies(f.workspace);
    assert.equal(existsSync(resolve(f.workspace, first.root!)), false);
    assert.equal(existsSync(resolve(f.workspace, first.instructionPath)), false);
    assert.equal(readFileSync(resolve(outside, "keep.txt"), "utf8"), "preserve me");
    const second = materializeSkillResources(f.store, f.workspace, skill, record)!;
    assert.equal(
      readFileSync(resolve(f.workspace, second.root!, "scripts/check.py"), "utf8"),
      "print('ok')",
    );
  } finally {
    f.close();
  }
});

test("migrates a plain legacy active list and rejects dangling links, junctions, and hardlinks without touching their targets", () => {
  const f = setup();
  try {
    const skills = resolve(f.workspace, "skills");
    mkdirSync(skills);
    const index = resolve(skills, "ACTIVE.json");
    writeFileSync(
      index,
      JSON.stringify({ active: [{ id: "old-skill", hash: "a".repeat(64) }] }),
    );
    resetActiveSkills(f.workspace);
    const migrated = JSON.parse(readFileSync(index, "utf8"));
    assert.deepEqual(migrated.active, []);
    assert.equal(migrated.migratedLegacy.active[0].id, "old-skill");
  } finally {
    f.close();
  }

  for (const kind of ["junction", "dangling-junction", "hardlink"] as const) {
    const f = setup();
    try {
      const skills = resolve(f.workspace, "skills");
      mkdirSync(skills);
      const index = resolve(skills, "ACTIVE.json");
      const target = resolve(f.root, `outside-${kind}`);
      if (kind === "junction") {
        mkdirSync(target);
        writeFileSync(resolve(target, "keep.txt"), "preserve me");
        symlinkSync(target, index, "junction");
      }
      if (kind === "dangling-junction") symlinkSync(target, index, "junction");
      if (kind === "hardlink") {
        writeFileSync(target, "preserve me");
        linkSync(target, index);
      }
      assert.throws(
        () => resetActiveSkills(f.workspace),
        /ACTIVE.json должен быть обычным файлом/,
      );
      if (kind === "junction")
        assert.equal(
          readFileSync(resolve(target, "keep.txt"), "utf8"),
          "preserve me",
        );
      if (kind === "hardlink")
        assert.equal(readFileSync(target, "utf8"), "preserve me");
      if (kind === "dangling-junction") assert.equal(existsSync(target), false);
    } finally {
      f.close();
    }
  }
});

test("rejects a changed cached resource before materialization", () => {
  const f = setup();
  try {
    const skill = importSkill(f.store, pack("tamper-demo", "v1")).skill;
    f.store.file(
      `skills/tamper-demo/${skill.path.split("/")[2]}/scripts/check.py`,
      "changed",
    );
    assert.throws(
      () =>
        materializeSkillResources(
          f.store,
          f.workspace,
          skill,
          f.store.get<any>("skillPackage", `tamper-demo:${skill.hash}`),
        ),
      /Изменён кэшированный ресурс/,
    );
  } finally {
    f.close();
  }
});

test("rejects traversal, Windows device syntax, and a junction inside the workspace", () => {
  for (const path of [
    "../escape.txt",
    "a/../escape.txt",
    "C:/escape.txt",
    "//server/share.txt",
    "a\\b.txt",
    "file:stream.txt",
    ".hidden.txt",
  ])
    assert.throws(() => validateResourcePath(path));
  const f = setup();
  try {
    const skill = importSkill(f.store, pack("junction-demo", "v1")).skill;
    const link = resolve(f.workspace, "skills");
    mkdirSync(resolve(f.root, "outside"));
    symlinkSync(resolve(f.root, "outside"), link, "junction");
    assert.throws(
      () =>
        materializeSkillResources(
          f.store,
          f.workspace,
          skill,
          f.store.get<any>("skillPackage", `junction-demo:${skill.hash}`),
        ),
      /Ссылки|ссылки|Каталог ресурсов/,
    );
  } finally {
    f.close();
  }
});

test("rejects binary and executable file extensions at import", () => {
  const f = setup();
  try {
    const p = pack("bad-file", "v1");
    p.files.push({ path: "payload.exe", content: "not allowed" });
    assert.throws(() => importSkill(f.store, p), /ресурс|файлы/);
  } finally {
    f.close();
  }
});

test("pins RESOURCE_MAP metadata, keeps mapped resources under resources/, and restores Lua suffix", () => {
  const f = setup();
  try {
    const python = "print('ok')";
    const lua = "return { ok = true }";
    const resourceFiles = [
      {
        originalPath: "scripts/check.py",
        path: "resources/scripts/check.py",
        hash: hash(python),
      },
      {
        originalPath: "scripts/luau/check.lua",
        path: "resources/scripts/luau/check.lua.txt",
        hash: hash(lua),
      },
    ];
    const p: any = {
      id: "sypho-roblox-sfx",
      source: "https://example.test/repo",
      version: "pin-v1",
      license: "MIT",
      roles: ["assets"],
      capabilities: [],
      dependencies: [],
      resourceFiles,
      files: [
        {
          path: "SKILL.md",
          content: "# Search SFX\nUse resources/scripts/check.py.",
        },
        {
          path: "UPSTREAM.md",
          content: "Upstream instructions are provenance only.",
        },
        { path: "resources/scripts/check.py", content: python },
        { path: "resources/scripts/luau/check.lua.txt", content: lua },
        {
          path: "RESOURCE_MAP.json",
          content: JSON.stringify({ files: resourceFiles }),
        },
      ],
    };
    const skill = importSkill(f.store, {
      ...p,
      resourceFiles: undefined,
    }).skill;
    assert.throws(
      () => importSkill(f.store, { ...p, resourceFiles: [] }),
      /не совпадает/,
    );
    assert.equal(skill.instructions.includes("Upstream instructions"), false);
    const packageRecord = f.store.get<any>(
      "skillPackage",
      `${skill.id}:${skill.hash}`,
    )!;
    const tamperedRecord = {
      ...packageRecord,
      files: packageRecord.files.map((file: any) =>
        file.originalPath === "scripts/check.py"
          ? { ...file, originalPath: "scripts/other.py" }
          : file,
      ),
    };
    assert.throws(
      () =>
        materializeSkillResources(f.store, f.workspace, skill, tamperedRecord),
      /RESOURCE_MAP/,
    );
    const activeEntry = materializeSkillResources(
      f.store,
      f.workspace,
      skill,
      packageRecord,
    );
    writeActiveSkills(f.workspace, [activeEntry]);
    const active = JSON.parse(
      readFileSync(resolve(f.workspace, "skills/ACTIVE.json"), "utf8"),
    ).active.find((x: any) => x.id === skill.id);
    assert.equal(
      active.files.every(
        (file: any) =>
          JSON.stringify(Object.keys(file).sort()) ===
          JSON.stringify(["hash", "originalPath", "path"]),
      ),
      true,
    );
    assert.equal(
      active.files.find((file: any) => file.originalPath.endsWith(".lua")).path,
      "resources/scripts/luau/check.lua",
    );
    assert.equal(
      active.files.some((file: any) => "storedPath" in file),
      false,
    );
    const root = resolve(f.workspace, active.root);
    assert.equal(
      readFileSync(resolve(root, "resources/scripts/check.py"), "utf8"),
      python,
    );
    assert.equal(
      readFileSync(resolve(root, "resources/scripts/luau/check.lua"), "utf8"),
      lua,
    );
    assert.equal(
      existsSync(resolve(root, "resources/scripts/luau/check.lua.txt")),
      false,
    );
    const storedMap = JSON.parse(
      readFileSync(resolve(root, "RESOURCE_MAP.json"), "utf8"),
    );
    assert.equal(
      storedMap.files[1].path,
      "resources/scripts/luau/check.lua.txt",
    );
  } finally {
    f.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Engine } from "../server/engine.js";
import { Store, hash } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { importSkill } from "../server/skills.js";
import { developmentStatus } from "../server/development-status.js";
import { prepareGameLocalization } from "../server/game-localization.js";
import {
  manifestSchema,
  type Version,
  type StudioConnection,
} from "../shared/domain.js";
import { studioOnline } from "../shared/studio-status.js";

test("dashboard reports the actual pinned skill after upgrade and respects a disabled package", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-policy-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  try {
    const project = engine.createProject({
      name: "Policy fixture",
      genre: "Obby",
      goal: "Review project rules",
    });
    const pinned = developmentStatus(store, project).skills.find(
      (s) => s.id === "roblox-ui",
    )!;
    importSkill(store, {
      id: "roblox-ui",
      version: "new",
      source: "https://example.com/skills",
      license: "MIT",
      roles: ["ui"],
      capabilities: [],
      dependencies: [],
      files: [{ path: "SKILL.md", content: "New instruction" }],
    });
    const archived = developmentStatus(store, project).skills.find(
      (s) => s.id === "roblox-ui",
    )!;
    assert.equal(archived.hash, pinned.hash);
    assert.equal(archived.version, pinned.version);
    assert.equal(archived.status, "ready");
    const current = store.get<any>("skill", "roblox-ui");
    current.status = "disabled";
    store.put("skill", current);
    assert.equal(
      developmentStatus(store, project).skills.find(
        (s) => s.id === "roblox-ui",
      )!.status,
      "disabled",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard distinguishes configured localization, a real check, and outdated integration; downloads exist on disk", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-policy-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  try {
    const project = engine.createProject({
      name: "Language fixture",
      genre: "Simulator",
      goal: "English UI",
    });
    project.revision = 1;
    const manifest = manifestSchema.parse({
      summary: "English interface",
      instances: [
        { path: "StarterGui/HUD", className: "ScreenGui", properties: {} },
        {
          path: "StarterGui/HUD/Title",
          className: "TextLabel",
          properties: { Text: "Crystal Nursery" },
        },
      ],
    });
    const version: Version = {
      id: "fixture",
      projectId: project.id,
      revision: 1,
      hash: hash(manifest),
      createdAt: new Date().toISOString(),
      reason: "fixture",
      manifest,
      specification: "",
      concept: "",
      styleId: null,
      styleVersion: 0,
      skillPins: project.skillPins,
      checks: [],
      phone: null,
      findings: [],
      assets: [],
    };
    assert.equal(
      developmentStatus(store, project, version).localization.status,
      "needs_update",
    );
    prepareGameLocalization(manifest);
    let status = developmentStatus(store, project, version).localization;
    assert.equal(status.status, "not_run");
    assert.equal(status.entries, 1);
    assert.equal(status.csv, null);
    for (const file of manifest.files)
      store.file(
        `projects/${project.id}/versions/1/${file.path}`,
        file.content,
      );
    version.checks.push({
      id: "localization",
      name: "English and Roblox translation",
      required: true,
      status: "passed",
      evidence: null,
    });
    assert.equal(
      developmentStatus(store, project, version).localization.status,
      "not_run",
    );
    version.checks[0].evidence = "Actual native client audit";
    status = developmentStatus(store, project, version).localization;
    assert.equal(status.status, "passed");
    assert.match(store.read(status.csv!), /Crystal Nursery/);
    assert.match(store.read(status.setup!), /Creator Hub/);
    manifest.instances = manifest.instances.filter(
      (i) => i.path !== "ReplicatedStorage/AutomationI18n",
    );
    assert.equal(
      developmentStatus(store, project, version).localization.status,
      "needs_update",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Studio indicator requires a fresh live connection, including during Play", () => {
  const at = Date.now(),
    studio: StudioConnection = {
      id: "fixture",
      name: "Place1",
      projectId: null,
      placeId: "0",
      universeId: "0",
      version: 0,
      fingerprint: "baseline",
      capabilities: [],
      stopped: false,
      lastSeen: new Date(at).toISOString(),
      playMode: true,
    };
  assert.equal(studioOnline(studio, at), true);
  assert.equal(studioOnline(studio, at + 15001), false);
  assert.equal(studioOnline({ ...studio, stopped: true }, at), false);
  assert.equal(studioOnline({ ...studio, replacedBy: "another" }, at), false);
  assert.equal(studioOnline(undefined, at), false);
});

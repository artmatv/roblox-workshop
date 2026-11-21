import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { Vault } from "../server/vault.js";
import { OpenAIProvider } from "../server/providers.js";
import { importSkill, pinSkill } from "../server/skills.js";
import { createBackup } from "../server/backup.js";
test("complete skill bundles retain reviewed tools without running them and use one primary UI skill", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-skill-bundle-")),
    s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const payload = {
      id: "roblox-ui",
      source: "https://example.com/ui",
      version: "commit",
      license: "Apache-2.0",
      roles: ["ui", "art"],
      capabilities: [],
      dependencies: [],
      files: [
        { path: "SKILL.md", content: "Read responsive UI instructions" },
        { path: "assets/fixture.json", content: '{"editable":true}' },
        {
          path: "scripts/review.py",
          content: 'raise RuntimeError("must not execute")',
        },
      ],
    };
    const imported = importSkill(s, payload);
    assert.equal(
      s.read(`skills/roblox-ui/${imported.packageHash}/scripts/review.py`),
      payload.files[2].content,
    );
    assert.doesNotMatch(imported.skill.instructions, /raise RuntimeError/);
    assert.match(imported.skill.instructions, /scripts\/review.py/);
    const p = e.createProject({
      name: "Skill bundle fixture",
      genre: "Obby",
      goal: "test primary skill",
    });
    imported.skill.status = "connected";
    imported.skill.checkedAt = new Date().toISOString();
    s.put("skill", imported.skill);
    pinSkill(s, p, "roblox-ui");
    assert.ok(p.skillPins["roblox-ui"]);
    assert.equal(p.skillPins["local-ui"], undefined);
    assert.throws(
      () =>
        importSkill(s, {
          ...payload,
          files: [...payload.files, { path: "SKILL.md", content: "duplicate" }],
        }),
      /Повторяющиеся/,
    );
    assert.throws(() =>
      importSkill(s, {
        ...payload,
        files: [payload.files[0], { path: "data.json", content: "invalid" }],
      }),
    );
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("a skill upgrade retains the pinned older instruction package", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-skills-"));
  const s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const p = e.createProject({
      name: "Skill fixture",
      genre: "test",
      goal: "test instructions",
    });
    const previous = s.get<any>("skill", "local-art");
    const t = e.task(p, {
      title: "test",
      kind: "test",
      role: "art",
      instructions: "test",
    });
    p.studioId = "studio";
    s.put("studio", { id: "studio", capabilities: ["apply", "capture"] });
    importSkill(s, {
      id: "local-art",
      source: "https://example.com/package",
      version: "2",
      license: "MIT",
      roles: ["art"],
      capabilities: ["apply", "capture"],
      dependencies: [],
      files: [{ path: "SKILL.md", content: "New instruction" }],
    });
    assert.equal(p.skillPins["local-art"], previous.hash);
    assert.ok(e.skillContext(p, t).includes(previous.instructions));
    assert.equal(t.skills[0].version, "1.0.0");
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("external API generation cannot bypass approved budget or spend on unknown free-credit applicability", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-provider-"));
  const s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const p = e.createProject({
      name: "API fixture",
      genre: "test",
      goal: "test API limits",
    });
    const adapter = new OpenAIProvider(s, new Vault(s));
    await assert.rejects(
      adapter.generate(p, { operation: "responses", prompt: "test" }),
      /бюджет/,
    );
    p.budget.approved = true;
    p.settings.freeCreditsOnly = true;
    s.put("setting", {
      id: "openai-pricing",
      value: {
        model: "user-selected-model",
        inputMicrosPerMillion: 1,
        outputMicrosPerMillion: 1,
        source: "https://developers.openai.com/api/docs/pricing",
        verifiedAt: new Date().toISOString(),
      },
    });
    await assert.rejects(
      adapter.generate(p, { operation: "responses", prompt: "test" }),
      /кредитов/,
    );
    assert.equal(s.all("providerOperation").length, 0);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("backup contains an independently readable consistent SQLite database", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-backup-"));
  const s = new Store(root);
  try {
    s.put("project", { id: "p", name: "Persist me" });
    s.file("projects/p/manifest.json", "{}");
    const b = await createBackup(s);
    const saved = new Store(resolve(root, "backups", b.id));
    assert.equal(saved.get<any>("project", "p").name, "Persist me");
    assert.equal(
      saved.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
    saved.close();
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

import { effortModels } from "./effort-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Engine } from "../server/engine.js";
import { Store, hash } from "../server/store.js";
import { Codex } from "../server/codex.js";
import {
  DEFAULT_SKILL_IDS,
  assignDefaultSkills,
} from "../server/default-skills.js";
import type { Skill } from "../shared/domain.js";
test("new projects automatically receive complete pinned Roblox skills and tasks load instructions by role", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-auto-skills-")),
    s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const awaitingTools = s.get<Skill>("skill", "roblox-ui")!;
    awaitingTools.status = "incompatible";
    s.put("skill", awaitingTools);
    const p = e.createProject({
      name: "Automatic skills fixture",
      genre: "Obby",
      goal: "No manual skill setup",
    });
    for (const id of DEFAULT_SKILL_IDS) {
      const skill = s.get<Skill>("skill", id)!;
      assert.equal(p.skillPins[id], skill.hash);
      assert.ok(skill.instructions.length > 1000);
    }
    const installed = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../docs/skill-imports/installed.json"), "utf8"),
    );
    for (const previous of installed.packages) {
      const skill = s.get<Skill>("skill", previous.id)!;
      assert.equal(skill.hash, previous.hash, `seed changed prior instructions: ${previous.id}`);
    }
    assert.equal(p.skillPins["local-ui"], undefined);
    const specTask = e.task(p, {
      title: "Map concept",
      role: "designer",
      kind: "styles",
      instructions: "Specify the map layout and movement assumptions",
    });
    const specContext = e.skillContext(p, specTask);
    assert.match(specContext, /SKILL sypho-roblox-map@/);
    assert.match(specContext, /Карты Roblox/);
    assert.match(specContext, /не запускать скрипты/);
    const art = e.task(p, {
        title: "Style directions",
        role: "art",
        kind: "styles",
        instructions: "test",
      }),
      artContext = e.skillContext(p, art);
    assert.match(artContext, /SKILL roblox-ui@/);
    assert.match(artContext, /SKILL create-game-assets@/);
    assert.doesNotMatch(artContext, /SKILL roblox-datastores@/);
    const ui = e.task(p, {
      title: "HUD",
      role: "ui",
      kind: "ui",
      instructions: "test",
    });
    assert.throws(() => e.skillContext(p, ui), /недоступны/);
    p.studioId = "fixture";
    s.put("studio", {
      id: "fixture",
      capabilities: ["apply", "capture", "test"],
    });
    const context = e.skillContext(p, ui);
    assert.match(context, /ScreenGui/);
    assert.match(context, /SKILL roblox-luau@/);
    assert.ok(ui.skills.some((v) => v.id === "roblox-ui"));
    const gameplay = e.task(p, {
      title: "Progress",
      role: "gameplay",
      kind: "gameplay",
      instructions: "Implement progression",
    });
    const gameContext = e.skillContext(p, gameplay);
    assert.match(gameContext, /SKILL roblox-luau@/);
    assert.match(gameContext, /SKILL roblox-datastores@/);
    assert.doesNotMatch(gameContext, /SKILL roblox-ui@/);
    const assets = e.task(p, {
      title: "World",
      role: "assets",
      kind: "assets",
      instructions: "Build world",
    });
    assert.match(e.skillContext(p, assets), /SKILL create-game-assets@/);
    assert.match(e.skillContext(p, assets), /SKILL roblox-luau@/);
    assert.doesNotMatch(e.skillContext(p, assets), /SKILL roblox-datastores@/);
    const old = p.skillPins["roblox-ui"],
      updated = s.get<Skill>("skill", "roblox-ui")!;
    updated.instructions += "\nNew version";
    updated.hash = hash(updated.instructions);
    updated.version = "new";
    s.put("skill", updated);
    assignDefaultSkills(s, p);
    assert.equal(p.skillPins["roblox-ui"], old);
    const events = s.events(p.id);
    assert.ok(events.some((v: any) => v.type === "skill.autoAssigned"));
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("resumed Codex sessions receive the actual current skill instructions", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-resumed-skills-")),
    s = new Store(root),
    codex = new Codex();
  const calls: Array<{ method: string; params: any }> = [];
  codex.isolatedConfig = async () => ({
    web_search: "disabled",
    mcp_servers: {},
    features: { shell_tool: false, apps: false, collab: false },
  });
  codex.request = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "thread/resume")
      return { thread: { id: "resumed-fixture" } };
    if (method === "turn/start") return { turn: { id: "fixture-turn" } };
    if (method === "config/read")
      return { config: { model: "test-model", model_reasoning_effort: "low" } };
    throw new Error("Unexpected method " + method);
  };
  const e = new Engine(s, codex);
  try {
    const p = e.createProject({
      name: "Resume skills",
      genre: "Obby",
      goal: "Use actual instructions on resume",
    });
    e.account = { account: { type: "chatgpt", id: "fixture" } };
    e.setExecution(p, "running");
    const t = e.task(p, {
      title: "Revised directions",
      kind: "styles",
      role: "art",
      instructions: "test",
      threadId: "resumed-fixture",
    });
    e.models = effortModels;
    await e.runAgent(p, t);
    const resume = calls.find((c) => c.method === "thread/resume")!;
    assert.match(resume.params.developerInstructions, /SKILL roblox-ui@/);
    assert.match(
      resume.params.developerInstructions,
      /SKILL create-game-assets@/,
    );
    assert.match(resume.params.developerInstructions, /ScreenGui/);
    assert.match(resume.params.developerInstructions, /en-us/);
    assert.match(resume.params.developerInstructions, /I18n\.set/);
    assert.doesNotMatch(
      resume.params.developerInstructions,
      /SKILL roblox-datastores@/,
    );
    assert.equal(s.get<any>("task", t.id).status, "running");
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

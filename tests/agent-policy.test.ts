import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { SPECIALIST_POLICY } from "../shared/agent-policy.js";
import { effortModels } from "./effort-fixture.js";
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "agent-policy-")),
    store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  const p = engine.createProject({
    name: "Policy",
    genre: "Simulator",
    goal: "Small bounded change",
  });
  engine.models = effortModels;
  return {
    root,
    store,
    codex,
    engine,
    p,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("new projects use specialist models with fixed Medium even after rejected or complex work", async () => {
  const f = fixture();
  try {
    assert.equal(f.p.settings.agentPolicy, SPECIALIST_POLICY);
    f.p.settings.model = "gpt-6-astra";
    for (const [role, kind, model] of [
      ["designer", "studio-development", "gpt-6.1-sol"],
      ["designer", "specification", "gpt-6.1-sol"],
      ["ui", "ui", "gpt-6-luna"],
      ["gameplay", "gameplay", "gpt-6-luna"],
    ] as const) {
      const t = f.engine.task(f.p, {
        title: kind,
        role,
        kind,
        instructions: "Change only requested files",
        effortClass: "complex",
        effortOverride: "max",
        attempt: 4,
      });
      f.store.put("resultReview", {
        id: t.id,
        taskId: t.id,
        status: "rejected",
      });
      const result = await f.engine.effortConfig(f.p, t);
      assert.equal(result.model, model);
      assert.equal(result.effort, "medium");
      assert.equal(
        (await f.engine.effortConfig(f.p, t, true)).model,
        "gpt-6.1-sol",
      );
    }
  } finally {
    f.close();
  }
});
test("specialist policy does not silently substitute missing models or allow effort escalation", async () => {
  const f = fixture();
  try {
    const t = f.engine.task(f.p, {
      title: "UI",
      role: "ui",
      kind: "ui",
      instructions: "Fix one control",
    });
    f.engine.models = [effortModels[0]];
    await assert.rejects(() => f.engine.effortConfig(f.p, t), /каталог/);
    assert.throws(
      () =>
        f.engine.configureTaskEffort(t.id, {
          complexity: "complex",
          override: "high",
          reason: "Retry",
        }),
      /фиксированный Medium/,
    );
    f.p.settings.agentPolicy = "legacy";
    f.p.settings.model = "gpt-6-astra";
    f.engine.models = effortModels;
    await assert.rejects(
      () => f.engine.effortConfig(f.p, t),
      /Astra разрешена только/,
    );
  } finally {
    f.close();
  }
});

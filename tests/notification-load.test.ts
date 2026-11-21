import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Engine } from "../server/engine.js";
import { Store } from "../server/store.js";
import { Codex } from "../server/codex.js";
test("streaming deltas never rescan saved builds and relevant events load only active tasks", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-events-")),
    s = new Store(root),
    e = new Engine(s, new Codex());
  try {
    const p = e.createProject({
        name: "Event load fixture",
        genre: "Obby",
        goal: "Responsive background service",
      }),
      t = e.task(p, {
        title: "Active task",
        kind: "styles",
        role: "art",
        instructions: "test",
      });
    t.threadId = "active-thread";
    t.status = "running";
    s.put("task", t);
    e.active.add(t.id);
    let reads = 0;
    const originalGet = s.get.bind(s);
    s.get = ((kind: string, key: string) => {
      if (kind === "task") reads++;
      return originalGet(kind, key);
    }) as typeof s.get;
    s.all = (() => {
      throw new Error("Event handler scanned the full table");
    }) as typeof s.all;
    for (let i = 0; i < 10000; i++)
      e.onNotification({
        method: "item/agentMessage/delta",
        params: { threadId: t.threadId, delta: "token" },
      });
    assert.equal(reads, 0);
    e.onNotification({
      method: "thread/tokenUsage/updated",
      params: { threadId: t.threadId, usage: { totalTokens: 100 } },
    });
    assert.equal(reads, 1);
    assert.ok(originalGet("usage", t.id));
    e.onNotification({
      method: "item/completed",
      params: {
        threadId: t.threadId,
        item: { type: "reasoning", text: "not a result" },
      },
    });
    assert.equal(reads, 1);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

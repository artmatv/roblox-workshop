import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ClaudeCode } from "../server/claude.js";

// A scripted stand-in for `claude -p --output-format stream-json`.
const FAKE = String.raw`
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.84 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "dev@example.com", subscriptionType: "max" }));
  process.exit(0);
}
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const session = flag("--session-id") || flag("--resume");
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), apiKey: process.env.ANTHROPIC_API_KEY ?? null, env: { MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT ?? null, EXTRA: process.env.EXTRA ?? null } }) + "\n");
const say = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line).message;
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ content: message.content.map((b) => b.type) }) + "\n");
  if (text.includes("HANG")) return;
  const dir = resolve(process.env.CLAUDE_CONFIG_DIR, "projects", "fake");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, session + ".jsonl"), "{}");
  say({ type: "system", subtype: "init", session_id: session });
  say({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "working: " + text }] } });
  say({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.25, resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
  const failed = text.includes("FAIL");
  say({ type: "result", subtype: "success", is_error: failed, result: failed ? "model refused" : "done", session_id: session,
    usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 0, output_tokens: 7 },
    ...(flag("--json-schema") && !failed ? { structured_output: { ok: true, text } } : {}) });
});
`;

function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "automation-claude-"));
  const script = resolve(root, "fake-claude.mjs");
  writeFileSync(script, FAKE);
  process.env.WORKSHOP_CLAUDE_HOME = resolve(root, "home");
  process.env.FAKE_LOG = resolve(root, "log.jsonl");
  process.env.ANTHROPIC_API_KEY = "must-not-leak";
  const claude = new ClaudeCode([process.execPath, script]);
  const events: any[] = [];
  claude.on("notification", (m) => events.push(m));
  const log = () =>
    readFileSync(process.env.FAKE_LOG!, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  const completed = (turnId: string) =>
    new Promise<any>((accept) => {
      const check = (m: any) => {
        if (m.method === "turn/completed" && m.params.turn.id === turnId) {
          claude.off("notification", check);
          accept(m.params.turn);
        }
      };
      claude.on("notification", check);
    });
  const waitFor = async <T>(read: () => T | undefined) => {
    for (let i = 0; i < 200; i++) {
      const value = read();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("timed out");
  };
  return { root, claude, events, log, completed, waitFor };
}

test("Claude Code adapter runs a read-only structured turn like Codex", async () => {
  const { root, claude, events, log, completed } = setup();
  const work = resolve(root, "work");
  mkdirSync(work);
  const image = resolve(root, "frame.png");
  writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal((await claude.account()).account?.type, "claude");
  const thread = await claude.request("thread/start", {
    cwd: work,
    model: "claude-opus-5-5",
    sandbox: "read-only",
    developerInstructions: "Rules",
    config: await claude.isolatedConfig(work),
  });
  const turn = await claude.request("turn/start", {
    threadId: thread.thread.id,
    effort: "xhigh",
    input: [
      { type: "text", text: "task", text_elements: [] },
      { type: "localImage", path: image },
    ],
    outputSchema: { type: "object" },
  });
  const done = await completed(turn.turn.id);
  assert.equal(done.status, "completed");
  const messages = events.filter(
    (m) => m.method === "item/completed" && m.params.turnId === turn.turn.id,
  );
  assert.deepEqual(JSON.parse(messages.at(-1).params.item.text), {
    ok: true,
    text: "task",
  });
  const usage = events.find((m) => m.method === "thread/tokenUsage/updated");
  assert.equal(usage.params.tokenUsage.total.inputTokens, 15);
  assert.equal(usage.params.tokenUsage.total.outputTokens, 7);
  const [run, input] = log();
  assert.equal(run.apiKey, null);
  assert.equal(run.cwd.toLowerCase(), work.toLowerCase());
  const arg = (name: string) => run.args[run.args.indexOf(name) + 1];
  assert.equal(arg("--session-id"), thread.thread.id);
  assert.equal(arg("--effort"), "high");
  assert.equal(arg("--permission-mode"), "dontAsk");
  assert.equal(arg("--tools"), "Read,Glob,Grep,WebSearch,WebFetch");
  assert.ok(
    readFileSync(arg("--append-system-prompt-file"), "utf8").includes("Rules"),
  );
  assert.deepEqual(input.content, ["text", "image"]);
  const limits = await claude.limits();
  assert.equal(limits.rateLimitsByLimitId.five_hour.primary.usedPercent, 25);

  await assert.rejects(
    claude.request("thread/resume", {
      threadId: "00000000-0000-0000-0000-000000000000",
    }),
    /no rollout found for thread id/,
  );
  await claude.request("thread/resume", {
    threadId: thread.thread.id,
    cwd: work,
  });
  const second = await claude.request("turn/start", {
    threadId: thread.thread.id,
    input: [{ type: "text", text: "FAIL", text_elements: [] }],
  });
  const failed = await completed(second.turn.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error.message, /model refused/);
  const resumed = log()
    .filter((entry) => entry.args)
    .at(-1);
  assert.equal(
    resumed.args[resumed.args.indexOf("--resume") + 1],
    thread.thread.id,
  );
});

test("Claude Code adapter maps workspace tools, MCP, steering and interrupt", async (t) => {
  const { root, claude, log, completed, waitFor } = setup();
  t.after(() => claude.close());
  const thread = await claude.request("thread/start", {
    cwd: root,
    sandbox: "workspace-write",
    config: {
      features: { shell_tool: true },
      shell_environment_policy: { set: { EXTRA: "1" } },
      mcp_servers: {
        disabled: { enabled: false },
        workshop: {
          command: "node",
          args: ["mcp.ts"],
          env: { WORKSHOP_TASK_ID: "t1" },
          tools: { screen_capture: { approval_mode: "approve" } },
          tool_timeout_sec: 1200,
        },
      },
    },
  });
  const turn = await claude.request("turn/start", {
    threadId: thread.thread.id,
    input: [{ type: "text", text: "first", text_elements: [] }],
  });
  await claude.request("turn/steer", {
    threadId: thread.thread.id,
    expectedTurnId: turn.turn.id,
    input: [{ type: "text", text: "remark", text_elements: [] }],
  });
  assert.equal((await completed(turn.turn.id)).status, "completed");
  const run = log()[0];
  const arg = (name: string) => run.args[run.args.indexOf(name) + 1];
  assert.equal(arg("--permission-mode"), "acceptEdits");
  assert.equal(arg("--tools"), "Read,Glob,Grep,Edit,Write,Bash");
  assert.equal(
    arg("--allowedTools"),
    "Read,Glob,Grep,Bash,mcp__workshop__screen_capture",
  );
  assert.equal(run.env.MCP_TOOL_TIMEOUT, "1200000");
  assert.equal(run.env.EXTRA, "1");
  const mcp = JSON.parse(readFileSync(arg("--mcp-config"), "utf8"));
  assert.deepEqual(Object.keys(mcp.mcpServers), ["workshop"]);
  assert.equal(mcp.mcpServers.workshop.env.WORKSHOP_AGENT, "claude");
  assert.equal(log().filter((entry) => entry.content).length, 2);

  const fork = await claude.request("thread/fork", {
    threadId: thread.thread.id,
    cwd: root,
  });
  const hanging = await claude.request("turn/start", {
    threadId: fork.thread.id,
    input: [{ type: "text", text: "HANG", text_elements: [] }],
  });
  const forked = await waitFor(
    () => log().filter((entry) => entry.args)[1]?.args,
  );
  assert.ok(forked.includes("--fork-session"));
  assert.equal(forked[forked.indexOf("--session-id") + 1], fork.thread.id);
  const stopped = completed(hanging.turn.id);
  assert.equal(await claude.stopTask(fork.thread.id, hanging.turn.id), true);
  assert.equal((await stopped).status, "interrupted");
});

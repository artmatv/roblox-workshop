import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { extname, resolve } from "node:path";

// Claude Code CLI as the workshop's agent. It implements the part of the Codex
// App Server protocol the service uses (threads, turns, steering, interrupt,
// account, models), so the engine has one execution path for both backends.
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", isDefault: true },
  { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5" },
];
// Effort levels the Claude Code CLI accepts with --effort.
const CLAUDE_EFFORTS = ["low", "medium", "high", "max"];
const WINDOW_MINUTES: Record<string, number> = {
  five_hour: 300,
  seven_day: 10080,
  seven_day_opus: 10080,
  seven_day_sonnet: 10080,
};

export function findClaude() {
  return process.env.CLAUDE_BINARY || "claude";
}
// Own login, settings and sessions, separate from the owner's ~/.claude: the
// owner's hooks, plugins, skills and memory never reach workshop agents.
export function workshopClaudeHome() {
  const home = resolve(
    process.env.WORKSHOP_CLAUDE_HOME ||
      resolve(
        process.env.AUTOMATION_DATA_DIR ||
          resolve(import.meta.dirname, "../data"),
        "claude-home",
      ),
  );
  mkdirSync(home, { recursive: true });
  return home;
}
function childEnv(extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: workshopClaudeHome(),
    WORKSHOP_AGENT: "claude",
    ...extra,
  };
  // The subscription login is the engine; an inherited API key would silently
  // switch the agents to API billing.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env as NodeJS.ProcessEnv;
}
function run(
  command: string[],
  args: string[],
  timeout = 20_000,
): Promise<string> {
  return new Promise((accept, reject) =>
    execFile(
      command[0],
      [...command.slice(1), ...args],
      { env: childEnv(), windowsHide: true, timeout, encoding: "utf8" },
      (error, stdout, stderr) =>
        error && !stdout
          ? reject(new Error((stderr || error.message).trim()))
          : accept(stdout),
    ),
  );
}
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
function contentBlocks(input: any[]) {
  return (input || []).flatMap((item: any): any[] => {
    if (item?.type === "text") return [{ type: "text", text: item.text }];
    if (item?.type === "localImage") {
      const mediaType = IMAGE_TYPES[extname(item.path).toLowerCase()];
      if (!mediaType)
        throw new Error("Неподдерживаемый формат изображения: " + item.path);
      return [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: readFileSync(item.path).toString("base64"),
          },
        },
      ];
    }
    if (item?.type === "image" && item.url)
      return [{ type: "image", source: { type: "url", url: item.url } }];
    throw new Error("Claude: неизвестный тип ввода " + item?.type);
  });
}
function userMessage(input: any[]) {
  return (
    JSON.stringify({
      type: "user",
      message: { role: "user", content: contentBlocks(input) },
    }) + "\n"
  );
}
function cliEffort(effort: unknown) {
  if (typeof effort !== "string") return null;
  if (CLAUDE_EFFORTS.includes(effort)) return effort;
  return effort === "xhigh" ? "high" : "low";
}
type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
const emptyUsage = (): Usage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});
type Turn = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  pending: number;
  status: "completed" | "failed" | "interrupted" | null;
  error: string | null;
  stderr: string;
  done: Promise<void>;
};
type Thread = {
  id: string;
  cwd: string;
  model: string | null;
  instructions: string;
  sandbox: string;
  config: any;
  ephemeral: boolean;
  persisted: boolean;
  forkFrom: string | null;
  usage: Usage;
  turn: Turn | null;
};

export class ClaudeCode extends EventEmitter {
  readonly backend = "claude" as const;
  ready = false;
  version: string | null = null;
  error: string | null = null;
  threads = new Map<string, Thread>();
  rateLimits = new Map<string, any>();
  private loginProcess: ReturnType<typeof spawn> | null = null;
  // The binary and any leading arguments; tests substitute a scripted CLI.
  constructor(private command = [findClaude()]) {
    super();
  }
  async start() {
    if (this.ready) return;
    try {
      this.version = (await run(this.command, ["--version"], 10_000))
        .trim()
        .split(/\s+/)[0];
    } catch {
      throw new Error(
        `Claude Code CLI не найден: ${this.command[0]}. Установите Claude Code или укажите путь в CLAUDE_BINARY.`,
      );
    }
    this.ready = true;
    this.error = null;
  }
  async request(
    method: string,
    params: any = {},
    _timeout?: number,
  ): Promise<any> {
    await this.start();
    switch (method) {
      case "thread/start":
        return {
          thread: { id: this.open(randomUUID(), params, false, null).id },
        };
      case "thread/resume":
        this.assertSession(params.threadId);
        return {
          thread: { id: this.open(params.threadId, params, true, null).id },
        };
      case "thread/fork":
        this.assertSession(params.threadId);
        return {
          thread: {
            id: this.open(randomUUID(), params, false, params.threadId).id,
          },
        };
      case "turn/start":
        return { turn: { id: this.startTurn(params) } };
      case "turn/steer":
        return this.steer(params);
      case "turn/interrupt":
        await this.stopTask(params.threadId, params.turnId);
        return {};
      case "thread/unsubscribe":
        return {};
      case "config/read":
        return {
          config: {
            model: process.env.WORKSHOP_CLAUDE_MODEL || CLAUDE_MODELS[0].id,
          },
        };
      case "model/list":
        return this.models();
      case "account/read":
        return this.account();
      case "account/rateLimits/read":
        return this.limits();
      case "account/login/start":
        return this.login();
      case "account/logout":
        await run(this.command, ["auth", "logout"]);
        return {};
      default:
        throw new Error(`Исполнитель Claude не поддерживает ${method}`);
    }
  }
  private open(
    id: string,
    params: any,
    persisted: boolean,
    forkFrom: string | null,
  ) {
    const previous = this.threads.get(id);
    if (previous?.turn) throw new Error("Claude: у треда уже идёт ход");
    const thread: Thread = {
      id,
      cwd: params.cwd || previous?.cwd || process.cwd(),
      model: params.model || previous?.model || null,
      instructions:
        params.developerInstructions || previous?.instructions || "",
      sandbox: params.sandbox || previous?.sandbox || "read-only",
      config: params.config || previous?.config || {},
      ephemeral: params.ephemeral === true,
      persisted,
      forkFrom,
      usage: previous?.usage || emptyUsage(),
      turn: null,
    };
    this.threads.set(id, thread);
    return thread;
  }
  // Claude stores a session as projects/<cwd>/<id>.jsonl. The error text is
  // the one Codex returns, so the existing "start a new thread" paths apply.
  private assertSession(id: string) {
    const projects = resolve(workshopClaudeHome(), "projects");
    const found =
      existsSync(projects) &&
      readdirSync(projects).some((dir) =>
        existsSync(resolve(projects, dir, `${id}.jsonl`)),
      );
    if (!found) throw new Error(`no rollout found for thread id ${id}`);
  }
  private plan(thread: Thread) {
    const config = thread.config || {};
    const tools = ["Read", "Glob", "Grep"];
    const allowed = [...tools];
    const writable = thread.sandbox !== "read-only";
    if (writable) tools.push("Edit", "Write");
    if (config.features?.shell_tool) {
      tools.push("Bash");
      allowed.push("Bash");
    }
    if (config.web_search === "live" || config.web_search === "cached") {
      tools.push("WebSearch", "WebFetch");
      allowed.push("WebSearch", "WebFetch");
    }
    const mcpServers: Record<string, any> = {};
    let toolTimeout = 0,
      startupTimeout = 0;
    for (const [name, server] of Object.entries<any>(
      config.mcp_servers || {},
    )) {
      if (!server?.command || server.enabled === false) continue;
      mcpServers[name] = {
        type: "stdio",
        command: server.command,
        args: server.args || [],
        env: {
          ...server.env,
          CLAUDE_CONFIG_DIR: workshopClaudeHome(),
          WORKSHOP_AGENT: "claude",
        },
      };
      const listed = Object.keys(server.tools || {});
      allowed.push(
        ...(listed.length
          ? listed.map((tool) => `mcp__${name}__${tool}`)
          : [`mcp__${name}`]),
      );
      toolTimeout = Math.max(toolTimeout, Number(server.tool_timeout_sec) || 0);
      startupTimeout = Math.max(
        startupTimeout,
        Number(server.startup_timeout_sec) || 0,
      );
    }
    const env: Record<string, string> = {
      ...(config.shell_environment_policy?.set || {}),
      ...(toolTimeout ? { MCP_TOOL_TIMEOUT: String(toolTimeout * 1000) } : {}),
      ...(startupTimeout ? { MCP_TIMEOUT: String(startupTimeout * 1000) } : {}),
    };
    return {
      tools,
      allowed,
      mcpServers,
      env,
      // Edits are accepted only inside the working folder; anything not
      // allowed above is denied, as nobody answers prompts in print mode.
      permissionMode: writable ? "acceptEdits" : "dontAsk",
    };
  }
  private startTurn(params: any) {
    const thread = this.threads.get(params.threadId);
    if (!thread) throw new Error("Claude: тред не найден " + params.threadId);
    if (thread.turn) throw new Error("Claude: у треда уже идёт ход");
    const plan = this.plan(thread);
    const runDir = resolve(workshopClaudeHome(), "runs", thread.id);
    mkdirSync(runDir, { recursive: true });
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--setting-sources",
      "user",
      "--strict-mcp-config",
      "--permission-mode",
      plan.permissionMode,
      "--tools",
      plan.tools.join(","),
      "--allowedTools",
      plan.allowed.join(","),
    ];
    if (thread.persisted) args.push("--resume", thread.id);
    else if (thread.forkFrom)
      args.push(
        "--resume",
        thread.forkFrom,
        "--fork-session",
        "--session-id",
        thread.id,
      );
    else args.push("--session-id", thread.id);
    if (thread.ephemeral) args.push("--no-session-persistence");
    const model = params.model || thread.model;
    if (model) args.push("--model", model);
    const effort = cliEffort(params.effort);
    if (effort) args.push("--effort", effort);
    if (thread.instructions) {
      const file = resolve(runDir, "instructions.md");
      writeFileSync(file, thread.instructions);
      args.push("--append-system-prompt-file", file);
    }
    if (Object.keys(plan.mcpServers).length) {
      const file = resolve(runDir, "mcp.json");
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: plan.mcpServers }, null, 2),
      );
      args.push("--mcp-config", file);
    }
    if (params.outputSchema)
      args.push("--json-schema", JSON.stringify(params.outputSchema));
    const message = userMessage(params.input);
    const child = spawn(this.command[0], [...this.command.slice(1), ...args], {
      cwd: thread.cwd,
      env: childEnv(plan.env),
      windowsHide: true,
      stdio: "pipe",
    });
    const id = randomUUID();
    let finish!: () => void;
    const turn: Turn = {
      id,
      child,
      pending: 1,
      status: null,
      error: null,
      stderr: "",
      done: new Promise((accept) => (finish = accept)),
    };
    thread.turn = turn;
    const notify = (method: string, extra: any) =>
      this.emit("notification", {
        method,
        params: { threadId: thread.id, turnId: id, ...extra },
      });
    const complete = (status: Turn["status"], error: string | null) => {
      if (turn.status) return;
      turn.status = status;
      turn.error = error;
      if (status === "completed" && !thread.ephemeral) {
        thread.persisted = true;
        thread.forkFrom = null;
      }
    };
    child.stderr.on("data", (chunk) => {
      turn.stderr = (turn.stderr + chunk).slice(-4000);
    });
    child.on("error", (e) => complete("failed", e.message));
    child.stdin.on("error", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type === "rate_limit_event") this.rateLimit(m.rate_limit_info);
      if (m.type === "assistant" && !m.parent_tool_use_id)
        for (const block of m.message?.content || [])
          if (block?.type === "text" && block.text?.trim())
            notify("item/completed", {
              item: {
                id: randomUUID(),
                type: "agentMessage",
                text: block.text,
              },
            });
      if (m.type !== "result") return;
      const u = m.usage || {};
      const last: Usage = {
        inputTokens:
          (u.input_tokens || 0) +
          (u.cache_creation_input_tokens || 0) +
          (u.cache_read_input_tokens || 0),
        cachedInputTokens: u.cache_read_input_tokens || 0,
        outputTokens: u.output_tokens || 0,
        totalTokens: 0,
      };
      last.totalTokens = last.inputTokens + last.outputTokens;
      for (const key of Object.keys(last) as (keyof Usage)[])
        thread.usage[key] += last[key];
      notify("thread/tokenUsage/updated", {
        tokenUsage: {
          total: { ...thread.usage },
          last,
          costUsd: m.total_cost_usd ?? null,
        },
      });
      if (m.structured_output !== undefined)
        notify("item/completed", {
          item: {
            id: randomUUID(),
            type: "agentMessage",
            text: JSON.stringify(m.structured_output),
          },
        });
      if (m.is_error || m.subtype !== "success")
        complete(
          "failed",
          String(m.result || m.subtype || "Claude: ошибка хода"),
        );
      if (--turn.pending <= 0) child.stdin.end();
    });
    child.on("close", (code) => {
      complete(
        code === 0 ? "completed" : "failed",
        `Claude Code завершился с кодом ${code}: ${turn.stderr.trim()}`.trim(),
      );
      thread.turn = null;
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: thread.id,
          turn: {
            id,
            status: turn.status,
            error: turn.status === "completed" ? null : { message: turn.error },
          },
        },
      });
      finish();
    });
    child.stdin.write(message);
    return id;
  }
  private steer(params: any) {
    const turn = this.threads.get(params.threadId)?.turn;
    if (
      !turn ||
      turn.status ||
      (params.expectedTurnId && params.expectedTurnId !== turn.id)
    )
      throw new Error("Claude: нет активного хода для уточнения");
    turn.pending++;
    turn.child.stdin.write(userMessage(params.input));
    return { turnId: turn.id };
  }
  async stopTask(threadId: string, turnId: string): Promise<boolean> {
    const turn = this.threads.get(threadId)?.turn;
    if (!turn || turn.id !== turnId) return false;
    if (!turn.status) turn.status = "interrupted";
    turn.error = "Ход остановлен";
    turn.child.kill();
    const stopped = await Promise.race([
      turn.done.then(() => true),
      new Promise<boolean>((accept) => setTimeout(() => accept(false), 10_000)),
    ]);
    return stopped;
  }
  // Rolling windows reported by the CLI during turns. A window past its reset
  // time is dropped as unknown rather than assumed to be full again.
  private rateLimit(info: any) {
    const type = info?.rateLimitType;
    if (!type) return;
    const used =
      typeof info.utilization === "number"
        ? info.utilization * 100
        : info.status === "rejected"
          ? 100
          : null;
    if (used === null) return;
    const window = {
      limitId: type,
      limitName: "Claude " + type.replace(/_/g, " "),
      primary: {
        usedPercent: used,
        windowDurationMins: WINDOW_MINUTES[type] ?? null,
        resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : null,
      },
    };
    this.rateLimits.set(type, window);
    this.emit("notification", {
      method: "account/rateLimits/updated",
      params: { rateLimits: window },
    });
  }
  async limits() {
    const nowSeconds = Date.now() / 1000;
    const windows = Object.fromEntries(
      [...this.rateLimits].filter(
        ([, v]) =>
          v.primary.resetsAt === null || v.primary.resetsAt > nowSeconds,
      ),
    );
    return {
      rateLimits: Object.values(windows)[0] || null,
      rateLimitsByLimitId: windows,
    };
  }
  async account() {
    await this.start();
    const status = JSON.parse(await run(this.command, ["auth", "status"]));
    if (!status?.loggedIn) return { account: null };
    return {
      account: {
        type: status.authMethod === "claude.ai" ? "claude" : "apiKey",
        email: status.email || null,
        planType: status.subscriptionType || null,
      },
    };
  }
  async models() {
    return {
      data: CLAUDE_MODELS.map((m) => ({
        ...m,
        model: m.id,
        isDefault:
          m.id === (process.env.WORKSHOP_CLAUDE_MODEL || CLAUDE_MODELS[0].id),
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: CLAUDE_EFFORTS.map((reasoningEffort) => ({
          reasoningEffort,
        })),
      })),
    };
  }
  async isolatedConfig(_cwd: string) {
    return {
      web_search: "live",
      mcp_servers: {},
      features: { shell_tool: false, apps: false, collab: false },
    };
  }
  // The CLI opens the official sign-in page itself; the URL it prints is also
  // returned for the dashboard. The password never passes through the service.
  async login() {
    await this.start();
    this.loginProcess?.kill();
    const child = spawn(
      this.command[0],
      [...this.command.slice(1), "auth", "login", "--claudeai"],
      {
        env: childEnv(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.loginProcess = child;
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (this.loginProcess === child) this.loginProcess = null;
      if (code === 0)
        this.emit("notification", { method: "account/updated", params: {} });
    });
    const authUrl = await new Promise<string | null>((accept) => {
      let output = "";
      const read = (chunk: Buffer) => {
        output += chunk;
        const url = output.match(/https:\/\/\S+/)?.[0];
        if (url) accept(url);
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("close", () => accept(null));
      setTimeout(() => accept(null), 15_000);
    });
    return { type: "claude", authUrl };
  }
  close() {
    for (const thread of this.threads.values()) thread.turn?.child.kill();
    this.loginProcess?.kill();
    this.ready = false;
  }
}

import {
  spawn,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
export const PINNED_CODEX = "0.167.0-alpha.3.2";
// The workshop runs its own pinned Codex copy, independent of the desktop
// app's auto-updates; a new version is copied in and probed explicitly.
export function findCodex() {
  if (process.env.CODEX_BINARY) return process.env.CODEX_BINARY;
  return resolve(
    import.meta.dirname,
    "../.tools/codex",
    PINNED_CODEX,
    process.platform === "win32" ? "codex.exe" : "codex",
  );
}
// Own login, config and sessions, separate from the owner's ~/.codex. It is
// assigned (never inherited) on process.env, so every Codex child and the image
// reader use it; the MCP proxy also gets it explicitly.
export function workshopCodexHome() {
  const home = resolve(
    process.env.WORKSHOP_CODEX_HOME ||
      resolve(
        process.env.AUTOMATION_DATA_DIR || resolve(import.meta.dirname, "../data"),
        "codex-home",
      ),
  );
  mkdirSync(home, { recursive: true });
  const config = resolve(home, "config.toml");
  if (!existsSync(config))
    writeFileSync(
      config,
      'cli_auth_credentials_store = "file"\n\n[windows]\nsandbox = "elevated"\n',
    );
  process.env.CODEX_HOME = home;
  return home;
}
export class Codex extends EventEmitter {
  readonly backend = "codex" as const;
  child: ChildProcessWithoutNullStreams | null = null;
  pending = new Map<
    number,
    {
      resolve: (x: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  counter = 0;
  ready = false;
  version: string | null = null;
  error: string | null = null;
  starting: Promise<void> | null = null;
  async start() {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.connect();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }
  private async connect() {
    const binary = findCodex();
    try {
      this.version = execFileSync(binary, ["--version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      })
        .trim()
        .split(/\r?\n/)
        .at(-1)!
        .replace("codex-cli ", "");
    } catch {
      throw new Error(
        `Codex CLI не найден: ${binary}. Скопируйте проверенный Codex ${PINNED_CODEX} в .tools/codex/${PINNED_CODEX} или укажите CODEX_BINARY.`,
      );
    }
    if (this.version !== PINNED_CODEX)
      throw new Error(
        `Версия Codex ${this.version}; проверена ${PINNED_CODEX}. Выполните проверку совместимости перед сменой закреплённой версии.`,
      );
    if (
      process.platform === "win32" &&
      !existsSync(resolve(dirname(binary), "codex-code-mode-host.exe"))
    )
      throw new Error(`Неполная копия Codex: рядом с ${binary} нет codex-code-mode-host.exe`);
    workshopCodexHome();
    this.child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      windowsHide: true,
      stdio: "pipe",
    });
    this.child.on("error", (e) => this.disconnected(e));
    this.child.on("exit", () =>
      this.disconnected(new Error("Соединение Codex закрыто")),
    );
    this.child.stderr.on("data", () => {});
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id !== undefined && !m.method) {
        const p = this.pending.get(m.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      } else if (m.method && m.id !== undefined) {
        this.emit("request", m);
        this.respond(
          m.id,
          m.method === "item/commandExecution/requestApproval"
            ? { decision: "decline" }
            : m.method === "item/fileChange/requestApproval"
              ? { decision: "decline" }
              : null,
          true,
        );
      } else if (m.method) this.emit("notification", m);
    });
    await this.request("initialize", {
      clientInfo: {
        name: "roblox_autonomous_studio",
        title: "Мастерская Roblox",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    this.ready = true;
    this.error = null;
  }
  disconnected(e: Error) {
    this.ready = false;
    this.error = e.message;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.emit("disconnected", e.message);
  }
  request(method: string, params: unknown, timeout = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error("Codex не подключён"));
      const n = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(n);
        reject(new Error(`Codex: таймаут ${method}`));
      }, timeout);
      this.pending.set(n, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id: n, method, params }) + "\n");
    });
  }
  notify(method: string, params: unknown) {
    this.child?.stdin.write(JSON.stringify({ method, params }) + "\n");
  }
  respond(requestId: number, result: unknown, unsupported = false) {
    this.child?.stdin.write(
      JSON.stringify(
        unsupported && result === null
          ? {
              id: requestId,
              error: {
                code: -32601,
                message: "Interactive tool not supported by this host",
              },
            }
          : { id: requestId, result },
      ) + "\n",
    );
  }
  async account() {
    await this.start();
    return this.request("account/read", { refreshToken: false });
  }
  async limits() {
    await this.start();
    return this.request("account/rateLimits/read", {});
  }
  async isolatedConfig(cwd: string): Promise<any> {
    await this.start();
    const current = await this.request("config/read", {
      includeLayers: false,
      cwd,
    });
    const servers = current.config?.mcp_servers || {};
    return {
      // Each workspace is its own project root: instructions of a repository
      // that contains the data folder must not reach game agents.
      project_root_markers: [],
      web_search: "live",
      mcp_servers: Object.fromEntries(
        Object.keys(servers).map((name) => [name, { enabled: false }]),
      ),
      features: { shell_tool: false, apps: false, collab: false },
    };
  }
  async models() {
    await this.start();
    return this.request("model/list", { limit: 100, includeHidden: false });
  }
  async login(deviceCode = false) {
    await this.start();
    return this.request("account/login/start", {
      type: deviceCode ? "chatgptDeviceCode" : "chatgpt",
    });
  }
  async stopTask(threadId: string, turnId: string): Promise<boolean> {
    if (!this.ready) return false;
    let onNotification: ((message: any) => void) | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const completed = new Promise<boolean>((resolve) => {
      onNotification = (message) => {
        const params = message?.params;
        const completedTurnId = params?.turnId ?? params?.turn?.id;
        if (
          message?.method === "turn/completed" &&
          params?.threadId === threadId &&
          completedTurnId === turnId
        ) {
          resolve(true);
        }
      };
      this.on("notification", onNotification);
      completionTimer = setTimeout(() => resolve(false), 10_000);
    });
    try {
      await this.request("turn/interrupt", { threadId, turnId });
      return await completed;
    } catch {
      return false;
    } finally {
      if (completionTimer) clearTimeout(completionTimer);
      if (onNotification) this.off("notification", onNotification);
    }
  }
  close() {
    this.child?.kill();
    this.child = null;
    this.ready = false;
  }
}
export interface QuotaWindow {
  id: string;
  name: string;
  minutes: number | null;
  used: number | null;
  remaining: number | null;
  resetsAt: string | null;
}
export function normalizeLimits(raw: any): QuotaWindow[] {
  const entries =
    raw?.rateLimitsByLimitId && Object.keys(raw.rateLimitsByLimitId).length
      ? Object.entries(raw.rateLimitsByLimitId)
      : raw?.rateLimits
        ? [["default", raw.rateLimits]]
        : [];
  return entries.flatMap(([key, value]) => {
    const v = value as any;
    return ["primary", "secondary"]
      .filter((k) => v?.[k])
      .map((k) => {
        const w = v[k];
        const used =
          typeof w.usedPercent === "number" && Number.isFinite(w.usedPercent)
            ? Math.max(0, Math.min(100, w.usedPercent))
            : null;
        return {
          id: `${key}:${k}`,
          name: v.limitName || v.limitId || String(key),
          minutes: w.windowDurationMins ?? null,
          used,
          remaining: used === null ? null : 100 - used,
          resetsAt:
            typeof w.resetsAt === "number" && Number.isFinite(w.resetsAt)
              ? new Date(w.resetsAt * 1000).toISOString()
              : null,
        };
      });
  });
}

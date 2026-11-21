import type { EventEmitter } from "node:events";
import { Codex } from "./codex.js";
import { ClaudeCode } from "./claude.js";

export type AgentBackend = "codex" | "claude";
// The subset of the Codex App Server protocol the workshop uses. Codex speaks
// it natively; ClaudeCode translates it to the Claude Code CLI.
export interface AgentServer extends EventEmitter {
  readonly backend: AgentBackend;
  ready: boolean;
  version: string | null;
  error: string | null;
  start(): Promise<void>;
  request(method: string, params: unknown, timeout?: number): Promise<any>;
  account(): Promise<any>;
  limits(): Promise<any>;
  models(): Promise<any>;
  isolatedConfig(cwd: string): Promise<any>;
  login(deviceCode?: boolean): Promise<any>;
  stopTask(threadId: string, turnId: string): Promise<boolean>;
  close(): void;
}
export function agentBackend(): AgentBackend {
  const value = (process.env.WORKSHOP_AGENT || "codex").trim().toLowerCase();
  if (value !== "codex" && value !== "claude")
    throw new Error(`WORKSHOP_AGENT=${value}: допустимы codex или claude`);
  return value;
}
export function createAgentServer(): AgentServer {
  return agentBackend() === "claude" ? new ClaudeCode() : new Codex();
}
// The main engine runs only on a subscription login; API billing is a
// separate, budgeted provider and is never switched on implicitly.
export function subscriptionAccount(account: any) {
  return ["chatgpt", "claude"].includes(account?.account?.type);
}

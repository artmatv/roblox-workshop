import { Codex } from "../server/codex.js";
import type { NameSuggestion } from "../shared/project-naming.js";
export const fixtureNames: NameSuggestion[] = [
  {
    name: "Sweep the Park",
    direction: "action",
    reason: "Подчёркивает сбор мусора и уборку личного парка.",
  },
  {
    name: "Restore Your Park",
    direction: "outcome",
    reason: "Обещает предусмотренное концепцией восстановление парка.",
  },
  {
    name: "Bubble Grove",
    direction: "brand",
    reason: "Связывает пузырьковый инструмент и зелёный парк.",
  },
  {
    name: "Park Rescue",
    direction: "outcome",
    reason: "Коротко передаёт цель преобразования грязного парка.",
  },
  {
    name: "Collect and Restore",
    direction: "action",
    reason: "Отражает игровой цикл сбора и восстановления.",
  },
];
export function mockNamingAI(
  codex: Codex,
  options: {
    response?: unknown;
    rawText?: string;
    error?: string;
    noResponse?: boolean;
  } = {},
) {
  const calls: Array<{ method: string; params: any }> = [];
  let count = 0;
  codex.ready = true;
  codex.isolatedConfig = async () => ({
    web_search: "disabled",
    mcp_servers: {},
    features: { shell_tool: false, apps: false, collab: false },
  });
  codex.stopTask = async (threadId, turnId) => {
    calls.push({ method: "turn/interrupt", params: { threadId, turnId } });
    return true;
  };
  codex.close = () => {
    codex.ready = false;
  };
  codex.request = async (method, params) => {
    const p = params as any;
    calls.push({ method, params });
    if (method === "config/read")
      return { config: { model: "test-model", model_reasoning_effort: "low" } };
    if (method === "thread/start")
      return { thread: { id: "naming-thread-" + ++count } };
    if (method === "thread/unsubscribe") return {};
    if (method !== "turn/start")
      throw new Error("Unexpected naming request: " + method);
    const turnId = "naming-turn-" + count;
    if (!options.noResponse)
      setTimeout(() => {
        if (options.error)
          codex.emit("notification", {
            method: "turn/completed",
            params: {
              threadId: p.threadId,
              turn: {
                id: turnId,
                status: "failed",
                error: { message: options.error },
              },
            },
          });
        else {
          codex.emit("notification", {
            method: "item/completed",
            params: {
              threadId: "other-thread",
              turnId,
              item: {
                type: "agentMessage",
                text: "ignored unrelated worker result",
              },
            },
          });
          codex.emit("notification", {
            method: "item/completed",
            params: {
              threadId: p.threadId,
              turnId,
              item: {
                type: "agentMessage",
                text:
                  options.rawText ??
                  JSON.stringify(
                    options.response || { suggestions: fixtureNames },
                  ),
              },
            },
          });
          codex.emit("notification", {
            method: "thread/tokenUsage/updated",
            params: {
              threadId: p.threadId,
              turnId,
              tokenUsage: { last: { inputTokens: 1500, outputTokens: 500 } },
            },
          });
          codex.emit("notification", {
            method: "turn/completed",
            params: {
              threadId: p.threadId,
              turn: { id: turnId, status: "completed" },
            },
          });
        }
      }, 10);
    return { turn: { id: turnId } };
  };
  return calls;
}

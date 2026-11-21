import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export function studioMcpBinary() {
  if (process.env.ROBLOX_STUDIO_MCP_BINARY)
    return process.env.ROBLOX_STUDIO_MCP_BINARY;
  const roots = [
    resolve(process.env.LOCALAPPDATA || "", "Roblox/Versions"),
    resolve(process.env.USERPROFILE || "", "AppData/Local/Roblox/Versions"),
  ];
  for (const root of roots)
    if (existsSync(root))
      for (const dir of readdirSync(root).reverse()) {
        const file = resolve(root, dir, "StudioMCP.exe");
        if (existsSync(file)) return file;
      }
  throw new Error("Не найден установленный StudioMCP.exe Roblox Studio");
}
export class StudioMcp {
  child: ChildProcessWithoutNullStreams;
  sequence = 0;
  stderrTail = "";
  pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(binary = studioMcpBinary(), args: string[] = []) {
    this.child = spawn(binary, args, { windowsHide: true, stdio: "pipe" });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const job = this.pending.get(msg.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(msg.id);
      msg.error
        ? job.reject(new Error(msg.error.message))
        : job.resolve(msg.result);
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-3000);
    });
    const fail = (error: Error) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
    };
    this.child.on("error", fail);
    this.child.on("exit", () =>
      fail(new Error("Соединение Studio MCP закрыто: " + this.stderrTail)),
    );
  }
  call(method: string, params: unknown, timeout = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence,
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("Studio MCP: таймаут " + method));
        }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  async start() {
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "roblox_workshop", version: "2" },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
  }
  tool(name: string, args: Record<string, unknown>, timeout = 30_000) {
    return this.call("tools/call", { name, arguments: args }, timeout);
  }
  close() {
    this.child.kill();
  }
}
export function toolJson(result: any) {
  if (result.isError)
    throw new Error(
      result.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n") || "Studio tool failed",
    );
  return JSON.parse(
    result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n"),
  );
}
export function availableStudioDataModel(
  state: any,
): "Edit" | "Server" | "Client" {
  if (!state || state.isError || state.error) {
    throw new Error("Studio недоступна для проверки документа");
  }
  const status = state.structuredContent?.status ?? state.status;
  if (
    typeof status === "string" &&
    /^(?:error|unavailable|disconnected)\b/i.test(status.trim())
  )
    throw new Error("Studio недоступна для проверки документа");
  const text = Array.isArray(state.content)
    ? state.content
        .filter(
          (item: any) => item?.type === "text" && typeof item.text === "string",
        )
        .map((item: any) => item.text)
        .join("\n")
    : typeof state === "string"
      ? state
      : JSON.stringify(state);
  const match = text.match(/Available DataModels\s*:\s*([^\r\n]+)/i);
  if (!match)
    throw new Error("Studio недоступна: нет строки Available DataModels");
  const available = new Set(
    match[1].match(/\b(?:Edit|Server|Client)\b/g) || [],
  );
  if (available.has("Edit")) return "Edit";
  if (available.has("Server")) return "Server";
  if (available.has("Client")) return "Client";
  throw new Error("Studio недоступна: нет доступной DataModel");
}

export async function readStudioDocumentIdentity(
  client: Pick<StudioMcp, "tool">,
  studioId: string,
  expectedDocumentId?: string,
) {
  const state = await client.tool("get_studio_state", {
    studio_id: studioId,
  });
  const datamodel_type = availableStudioDataModel(state);
  const value = toolJson(
    await client.tool("execute_luau", {
      studio_id: studioId,
      datamodel_type,
      code: DOCUMENT_IDENTITY_CODE,
    }),
  );
  if (
    typeof value?.documentId !== "string" ||
    (expectedDocumentId !== undefined &&
      value.documentId !== expectedDocumentId)
  )
    throw new Error("Документ Studio не соответствует проекту");
  return { documentId: value.documentId, datamodel_type };
}
export const DOCUMENT_IDENTITY_CODE =
  "return {documentId=workspace:GetAttribute('AutomationDocumentId') or game:GetAttribute('AutomationDocumentId')}";
export async function findBoundStudio(
  documentId: string,
  client: Pick<StudioMcp, "tool">,
  retryMs = 2000,
) {
  let matches: any[] = [];
  // A freshly started StudioMCP.exe is empty until Studio reconnects to it.
  for (let i = 0; i < 6 && !matches.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, retryMs));
    const list = toolJson(await client.tool("list_roblox_studios", {}));
    for (const studio of list.studios || []) {
      try {
        await readStudioDocumentIdentity(client, studio.id, documentId);
        matches.push(studio);
      } catch {}
    }
  }
  if (matches.length !== 1)
    throw new Error(
      "Нужно одно окно Studio с подтверждённым документом проекта; найдено " +
        matches.length,
    );
  return matches[0] as { id: string; name: string };
}

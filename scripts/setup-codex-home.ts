// One-time preparation of the workshop's own Codex home (data/codex-home):
// Windows sandbox setup for that home (the owner approves the UAC prompt),
// sign-in status, and with --probe a real sandboxed shell command through the
// pinned binary. Run while the workshop service is stopped.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Codex } from "../server/codex.js";

const codex = new Codex();
const waitFor = (method: string, timeoutMs: number) =>
  new Promise<any>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`нет ${method}`)), timeoutMs);
    codex.on("notification", (m) => {
      if (m.method === method) {
        clearTimeout(timer);
        done(m.params);
      }
    });
  });
try {
  await codex.start();
  console.log(`Codex ${codex.version}, home ${process.env.CODEX_HOME}`);
  const readiness = await codex.request("windowsSandbox/readiness", {});
  console.log("sandbox:", readiness.status);
  if (readiness.status !== "ready") {
    const completed = waitFor("windowsSandbox/setupCompleted", 300_000);
    await codex.request("windowsSandbox/setupStart", {
      mode: "elevated",
      cwd: resolve(import.meta.dirname, ".."),
    });
    console.log("Подтвердите запрос администратора Windows…");
    const result = await completed;
    console.log("setup:", JSON.stringify(result));
    if (!result.success) process.exitCode = 1;
  }
  const account = await codex.account();
  console.log("account:", account.account?.type || "не выполнен вход");
  if (process.argv.includes("--probe")) {
    if (!account.account) throw new Error("Сначала войдите в мастерской");
    const cwd = mkdtempSync(resolve(tmpdir(), "codex-probe-"));
    try {
      const thread = await codex.request("thread/start", {
        cwd,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        config: { features: { shell_tool: true, plugins: false, memories: false } },
      });
      const completed = waitFor("turn/completed", 300_000);
      const commands: any[] = [];
      codex.on("notification", (m) => {
        if (m.method === "item/completed" && m.params?.item?.type === "commandExecution")
          commands.push(m.params.item);
      });
      await codex.request("turn/start", {
        threadId: thread.thread.id,
        model: "gpt-6-luna",
        input: [
          {
            type: "text",
            text: "Run exactly one shell command: write the text sandbox-ok into the file probe.txt in the current folder. Then reply done.",
            text_elements: [],
          },
        ],
      });
      await completed;
      const file = resolve(cwd, "probe.txt");
      console.log(
        "probe:",
        JSON.stringify(commands.map((c) => ({ status: c.status, exitCode: c.exitCode }))),
        existsSync(file) ? readFileSync(file, "utf8").trim() : "файл не создан",
      );
      if (!existsSync(file)) process.exitCode = 1;
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  codex.close();
}

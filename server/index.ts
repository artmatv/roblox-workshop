import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Store } from "./store.js";
import { Vault } from "./vault.js";
import { createAgentServer } from "./agent-server.js";
import { Engine } from "./engine.js";
import { createApp } from "./app.js";
const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataRoot = resolve(
  process.env.AUTOMATION_DATA_DIR || resolve(appRoot, "data"),
);
const port = Number(process.env.AUTOMATION_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Неверный порт");
const store = new Store(dataRoot),
  vault = new Vault(store),
  codex = createAgentServer(),
  engine = new Engine(store, codex);
let auth = await vault.get("dashboard-token");
if (!auth) {
  auth = randomBytes(32).toString("hex");
  await vault.set("dashboard-token", auth);
}
const app = createApp(store, engine, auth, { port, appRoot });
const server = app.listen(port, "127.0.0.1", () => {
  store.put("service", {
    id: "runtime",
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  });
  console.log(`Мастерская Roblox: http://127.0.0.1:${port}`);
  engine.start();
});
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await engine.stop();
    server.close();
    store.close();
    process.exit(0);
  });

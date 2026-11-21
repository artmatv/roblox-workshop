import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const store = new Store(
  resolve(
    process.env.AUTOMATION_DATA_DIR || resolve(import.meta.dirname, "../data"),
  ),
);
const token = await new Vault(store).get("dashboard-token");
const runtime = store.get<any>("service", "runtime");
store.close();
if (!token) throw new Error("Нет запущенного сервиса");
const port = Number(process.argv[2] || runtime?.port || 4317);
const r = await fetch(`http://127.0.0.1:${port}/api/service/stop`, {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(20000),
});
if (!r.ok) throw new Error("Сервис не подтвердил остановку");
// The stop endpoint replies before the process closes its port. Wait for the
// actual shutdown so an immediate Start.ps1 cannot mistake the old process for a new one.
let stopped = false;
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    stopped = true;
    break;
  }
}
if (!stopped)
  throw new Error(
    "Сервис ещё завершает работу. Повторный запуск пока не выполнен.",
  );
console.log("Задачи прерваны, состояние сохранено, сервис остановлен.");

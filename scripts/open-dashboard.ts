import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const store = new Store(resolve(import.meta.dirname, "../data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
if (!token) throw new Error("Сначала запустите сервис");
const port = Number(process.argv[2] || 4317);
const url = `http://127.0.0.1:${port}/#token=${token}`;
// Browser receives a fragment; the secret is never in a URL query or server log.
spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Start-Process -FilePath ([Console]::In.ReadToEnd())",
  ],
  { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
).stdin!.end(url);

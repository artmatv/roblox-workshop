import { spawn } from "node:child_process";
import { Store } from "./store.js";
// DPAPI CurrentUser: ciphertext is account-bound and never added to an agent context.
async function dpapi(value: string, protect: boolean): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("Хранилище секретов этой версии требует Windows DPAPI");
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${protect ? "Protect" : "Unprotect"}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const p = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
    );
    let out = "";
    p.stdout.on("data", (x) => (out += x));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error("Не удалось открыть защищённое хранилище Windows")),
    );
    p.stdin.end(protect ? Buffer.from(value).toString("base64") : value);
  });
}
export class Vault {
  constructor(private store: Store) {}
  async set(key: string, value: string) {
    const encrypted = await dpapi(value, true);
    this.store.put("secret", { id: key, encrypted });
  }
  async get(key: string) {
    const record = this.store.get<{ encrypted: string }>("secret", key);
    return record
      ? Buffer.from(await dpapi(record.encrypted, false), "base64").toString(
          "utf8",
        )
      : null;
  }
  delete(key: string) {
    this.store.delete("secret", key);
  }
  has(key: string) {
    return !!this.store.get("secret", key);
  }
}

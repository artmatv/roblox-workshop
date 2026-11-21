import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const store = new Store(resolve(import.meta.dirname, "../data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const path = process.argv[2];
if (!path?.startsWith("/")) throw new Error("Нужен относительный API path");
const arg = process.argv[3];
const method = process.argv[4] || (arg ? "POST" : "GET");
const body = arg
  ? arg.startsWith("@")
    ? readFileSync(arg.slice(1), "utf8")
    : arg
  : undefined;
const r = await fetch("http://127.0.0.1:4317/api" + path, {
  method,
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body,
});
const text = await r.text();
console.log(text);
if (!r.ok) process.exitCode = 1;

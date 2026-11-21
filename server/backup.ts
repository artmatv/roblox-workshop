import { resolve } from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { backup } from "node:sqlite";
import { Store, id, hash } from "./store.js";
import { now } from "../shared/domain.js";
export async function createBackup(store: Store) {
  const key =
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + id().slice(0, 8);
  const root = resolve(store.root, "backups", key);
  mkdirSync(root, { recursive: true });
  await backup(store.db, resolve(root, "studio.sqlite"));
  const paths: string[] = [];
  for (const folder of [
    "projects",
    "skills",
    "tasks",
    "captures",
    "providers",
  ]) {
    const dir = resolve(store.root, folder);
    if (!existsSync(dir)) continue;
    const walk = (src: string, dst: string) => {
      mkdirSync(dst, { recursive: true });
      for (const name of readdirSync(src)) {
        const p = resolve(src, name),
          out = resolve(dst, name);
        const stat = lstatSync(p);
        if (stat.isSymbolicLink())
          throw new Error("Резервное копирование не следует по ссылкам");
        if (stat.isDirectory()) walk(p, out);
        else {
          copyFileSync(p, out);
          paths.push(out);
        }
      }
    };
    walk(dir, resolve(root, folder));
  }
  const entry = {
    id: key,
    createdAt: now(),
    files: paths.length,
    database: "studio.sqlite",
    scope:
      "SQLite + project files; secrets remain DPAPI-bound to this Windows account",
  };
  store.file(`backups/${key}/backup.json`, JSON.stringify(entry, null, 2));
  store.put("backup", entry);
  store.event(null, "backup.created", entry);
  return entry;
}

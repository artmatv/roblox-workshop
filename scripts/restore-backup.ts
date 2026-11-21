import { resolve, relative } from "node:path";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
const root = resolve(import.meta.dirname, "../data"),
  key = process.argv[2];
if (!key || !/^[\w.-]+$/.test(key))
  throw new Error("Укажите ID резервной копии");
const src = resolve(root, "backups", key);
if (!existsSync(resolve(src, "backup.json")))
  throw new Error("Не найдена полная резервная копия");
const db = new DatabaseSync(resolve(src, "studio.sqlite"), { readOnly: true });
const check = db.prepare("PRAGMA integrity_check").get();
db.close();
if (check?.integrity_check !== "ok")
  throw new Error("Резервная база повреждена");
if (!process.argv.includes("--apply")) {
  console.log(
    "Копия проверена. Остановите сервис, затем повторите с --apply. Текущая база будет сохранена рядом.",
  );
  process.exit(0);
}
try {
  const r = await fetch("http://127.0.0.1:4317/health", {
    signal: AbortSignal.timeout(1000),
  });
  if (r.ok) throw new Error("Сначала остановите сервис через Stop.ps1");
} catch (e) {
  if ((e as Error).message.includes("Сначала")) throw e;
}
if (existsSync(resolve(root, "studio.sqlite")))
  copyFileSync(
    resolve(root, "studio.sqlite"),
    resolve(root, "before-restore-" + Date.now() + ".sqlite"),
  );
const walk = (from: string, to: string) => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name === "backup.json") continue;
    const f = resolve(from, name),
      t = resolve(to, name);
    const s = lstatSync(f);
    if (s.isSymbolicLink()) throw new Error("Ссылки не поддерживаются");
    if (s.isDirectory()) walk(f, t);
    else copyFileSync(f, t);
  }
};
walk(src, root);
console.log(
  "Состояние восстановлено. Запустите Start.ps1; отправленные операции будут сверены перед продолжением.",
);

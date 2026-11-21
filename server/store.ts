import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { now } from "../shared/domain.js";
export const id = () => randomUUID();
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export class Store {
  db: DatabaseSync;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(resolve(root, "studio.sqlite"));
    this.db.exec(
      `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT,at TEXT NOT NULL,type TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,at TEXT NOT NULL); INSERT OR IGNORE INTO migrations VALUES(1,datetime('now')); CREATE INDEX IF NOT EXISTS records_status ON records(kind, json_extract(body,'$.status'));`,
    );
  }
  get<T>(kind: string, key: string): T | undefined {
    const r = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, key);
    return r ? JSON.parse(r.body as string) : undefined;
  }
  all<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r) => JSON.parse(r.body as string));
  }
  // Records in the given statuses, through the status index: polling paths
  // must not parse every stored scene snapshot.
  withStatus<T>(kind: string, statuses: string[]): T[] {
    return this.db
      .prepare(
        `SELECT body FROM records WHERE kind=? AND json_extract(body,'$.status') IN (${statuses.map(() => "?").join(",")}) ORDER BY rowid`,
      )
      .all(kind, ...statuses)
      .map((r) => JSON.parse(r.body as string));
  }
  // Read-only views: each "<path>.instances" array (a scene snapshot) is
  // emptied in SQLite before parsing, and its length kept as instanceCount.
  allWithoutInstances<T>(kind: string, parents: string[]): T[] {
    let expr = "body";
    for (const parent of parents) {
      if (!/^\$(\.\w+)+$/.test(parent)) throw new Error("Bad JSON path");
      const path = `'${parent}.instances'`;
      expr = `CASE WHEN json_type(body, ${path}) = 'array' THEN json_set(${expr}, ${path}, json('[]'), '${parent}.instanceCount', json_array_length(body, ${path})) ELSE ${expr} END`;
    }
    return this.db
      .prepare(
        `SELECT ${expr} AS body FROM records WHERE kind=? ORDER BY rowid`,
      )
      .all(kind)
      .map((r) => JSON.parse(r.body as string));
  }
  put<T extends { id: string }>(kind: string, record: T): T {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
      )
      .run(kind, record.id, JSON.stringify(record));
    return record;
  }
  delete(kind: string, key: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, key);
  }
  deleteProjectRecords(projectId: string, beforeDelete: () => void = () => {}) {
    const scopedKinds = new Set([
      "project",
      "task",
      "version",
      "style",
      "styleHistory",
      "feedback",
      "research",
      "command",
      "metric",
      "release",
      "resultReview",
      "usage",
      "agentContext",
      "agentMessage",
      "orchestratorMessage",
      "skillValidationContext",
      "nativeExternalReview",
      "nameGeneration",
      "integrationBase",
      "nativeDelivery",
      "nativeVisualReview",
      "motionValidation",
      "skillValidation",
      "nativeCapability",
      "analyticsSync",
      "externalReview",
    ]);
    this.transaction(() => {
      beforeDelete();
      const rows = this.db.prepare("SELECT kind,id,body FROM records").all();
      const taskIds = new Set<string>();
      for (const row of rows) {
        const kind = row.kind as string;
        const body = JSON.parse(row.body as string);
        if (kind === "task" && body?.projectId === projectId)
          taskIds.add(row.id as string);
      }
      for (const row of rows) {
        const kind = row.kind as string;
        const key = row.id as string;
        const body = JSON.parse(row.body as string);
        if (!scopedKinds.has(kind)) continue;
        if (
          body?.projectId === projectId ||
          (kind === "project" && key === projectId) ||
          (typeof body?.taskId === "string" && taskIds.has(body.taskId))
        )
          this.delete(kind, key);
      }
      this.db
        .prepare("DELETE FROM records WHERE kind='nativeSession' AND id=?")
        .run(projectId);
      this.db.prepare("DELETE FROM events WHERE project_id=?").run(projectId);
    });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  event(projectId: string | null, type: string, data: unknown) {
    this.db
      .prepare("INSERT INTO events(project_id,at,type,body) VALUES(?,?,?,?)")
      .run(projectId, now(), type, JSON.stringify(data));
  }
  events(projectId?: string, after = 0) {
    return (
      projectId
        ? this.db
            .prepare(
              "SELECT * FROM events WHERE project_id=? AND seq>? ORDER BY seq DESC LIMIT 300",
            )
            .all(projectId, after)
        : this.db
            .prepare(
              "SELECT * FROM events WHERE seq>? ORDER BY seq DESC LIMIT 300",
            )
            .all(after)
    ).map((r) => ({ ...r, body: JSON.parse(r.body as string) }));
  }
  file(path: string, content: string | Buffer) {
    const p = safePath(this.root, path);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + "." + id() + ".tmp";
    writeFileSync(tmp, content);
    renameSync(tmp, p);
    return p;
  }
  read(path: string) {
    return readFileSync(safePath(this.root, path), "utf8");
  }
  close() {
    this.db.close();
  }
}
export function safePath(root: string, path: string) {
  if (
    !path ||
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[a-z]:|\\|:|^\./i.test(path)
  )
    throw new Error("Недопустимый путь");
  const base = realpathSync(root);
  const p = resolve(base, path);
  const rel = relative(base, p);
  if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel))
    throw new Error("Путь выходит за пределы проекта");
  let c = dirname(p);
  while (c !== base) {
    if (existsSync(c) && lstatSync(c).isSymbolicLink())
      throw new Error("Ссылки в рабочих путях запрещены");
    c = dirname(c);
  }
  if (existsSync(p) && lstatSync(p).isSymbolicLink())
    throw new Error("Ссылка вместо файла");
  return p;
}

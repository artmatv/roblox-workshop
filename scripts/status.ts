import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, "..");
const s = new Store(resolve(root, "data"));
const token = await new Vault(s).get("dashboard-token");
s.close();
const key = process.argv[2];
const r = await fetch(
  "http://127.0.0.1:4317/api" + (key ? "/projects/" + key : "/state"),
  { headers: { Authorization: "Bearer " + token } },
);
const d = await r.json();
if (!r.ok) throw new Error(d.error);
const report = key
  ? {
      project: {
        id: d.project.id,
        name: d.project.name,
        stage: d.project.stage,
        revision: d.project.revision,
        execution: d.project.execution,
        studioId: d.project.studioId,
      },
      tasks: d.tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        attempt: t.attempt,
        error: t.error,
        summary: t.result?.summary,
      })),
      commands: d.commands.map((c: any) => ({
        id: c.id,
        operation: c.operation,
        status: c.status,
        error: c.result?.error,
        checks: c.result?.checks,
        findings: c.result?.findings,
        logs: c.result?.logs?.slice(-12),
        instances: c.result?.instanceCount ?? c.result?.instances?.length,
      })),
      versions: d.versions.map((v: any) => ({
        revision: v.revision,
        hash: v.hash,
        checks: v.checks,
      })),
      blockers: d.blockers,
    }
  : {
      projects: d.projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        execution: p.execution,
      })),
      studios: d.studios,
      codex: {
        connected: d.codex.connected,
        error: d.codex.error,
        quota: d.codex.quota,
      },
    };
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

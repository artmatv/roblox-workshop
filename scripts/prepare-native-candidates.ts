import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, ".."),
  s = new Store(resolve(root, "data")),
  token = await new Vault(s).get("dashboard-token");
s.close();
const call = async (path: string, body?: unknown) => {
  const r = await fetch("http://127.0.0.1:4317/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
};
const controls = JSON.parse(
  readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
).projects;
const report: any[] = [];
for (const p of controls) {
  let d = await call("/projects/" + p.id);
  const active = d.tasks.filter((t: any) =>
    ["queued", "running", "verifying", "dependencies"].includes(t.status),
  );
  let started: any;
  if (!active.length) {
    const candidate = d.styles.find((style: any) => !style.previewTaskId);
    if (candidate)
      started = await call("/projects/" + p.id + "/styles/prepare", {
        styleId: candidate.id,
      });
  }
  if (started) d = await call("/projects/" + p.id);
  report.push({
    key: p.key,
    project: p.name,
    started: started?.id,
    active: active.map((t: any) => ({ id: t.id, status: t.status })),
    styles: d.styles.map((style: any) => {
      const t = d.tasks.find((t: any) => t.id === style.previewTaskId);
      return {
        id: style.id,
        name: style.name,
        taskId: t?.id,
        status: t?.status || "not_prepared",
        attempt: t?.attempt,
        hasScene: !!t?.result?.instances.length,
        skills: t?.skills?.map((s: any) => s.id),
        error: t?.error,
      };
    }),
  });
}
writeFileSync(
  resolve(root, "docs/control-projects/native-preparation.json"),
  JSON.stringify({ at: new Date().toISOString(), projects: report }, null, 2),
);
console.log(JSON.stringify(report, null, 2));

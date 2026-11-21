import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
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
const action = process.argv[2] || "status",
  project = controls.find((p: any) => p.key === (process.argv[3] || "moon"));
if (action === "bind") {
  const state = await call("/state"),
    live = state.studios.filter(
      (s: any) =>
        s.name === "Place1" &&
        !s.stopped &&
        Date.now() - Date.parse(s.lastSeen) < 15000,
    );
  if (live.length !== 1)
    throw new Error("Expected exactly one fresh Place1 bridge");
  await call("/projects/" + project.id + "/studio", { studioId: live[0].id });
  writeFileSync(
    resolve(root, "docs/control-projects/native-session.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projectId: project.id,
        studioId: live[0].id,
        documentId: live[0].documentId,
        authorization:
          "User explicitly authorized empty Place1 for integration testing",
      },
      null,
      2,
    ),
  );
  console.log("Bound " + project.name + " to " + live[0].id);
} else if (action === "reset") {
  const command = await call("/projects/" + project.id + "/styles/reset", {});
  console.log(
    JSON.stringify({
      id: command.id,
      operation: command.operation,
      status: command.status,
    }),
  );
} else if (action === "unbind") {
  await call("/projects/" + project.id + "/studio/unbind", {});
  console.log("Unbound " + project.name);
} else if (action === "apply") {
  const d = await call("/projects/" + project.id),
    style = d.styles[Number(process.argv[4] || 1) - 1];
  if (!style) throw new Error("Style not found");
  const c = await call(
    "/projects/" + project.id + "/styles/" + style.id + "/apply-prepared",
    {},
  );
  console.log(
    JSON.stringify({
      project: project.name,
      style: style.name,
      commandId: c.id,
      status: c.status,
    }),
  );
} else if (action === "candidate") {
  const d = await call("/projects/" + project.id),
    style = d.styles[Number(process.argv[4] || 1) - 1];
  if (!style) throw new Error("Style not found");
  const t = await call("/projects/" + project.id + "/styles/preview", {
    styleId: style.id,
  });
  console.log(
    JSON.stringify(
      {
        project: project.name,
        styleId: style.id,
        name: style.name,
        taskId: t.id,
        selectedStyleUnchanged: d.project.selectedStyle,
      },
      null,
      2,
    ),
  );
} else {
  for (const p of controls) {
    const d = await call("/projects/" + p.id);
    console.log(
      JSON.stringify(
        {
          project: p.name,
          id: p.id,
          execution: d.project.execution,
          revision: d.project.revision,
          studioId: d.project.studioId,
          styles: d.styles.map((s: any) => ({
            id: s.id,
            name: s.name,
            family: s.familyId,
            version: s.version,
            status: s.status,
            previewTaskId: s.previewTaskId,
          })),
          tasks: d.tasks.slice(-4).map((t: any) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            attempt: t.attempt,
            error: t.error,
            summary: t.result?.summary,
          })),
          commands: d.commands.slice(-3).map((c: any) => ({
            id: c.id,
            operation: c.operation,
            status: c.status,
            error: c.result?.error,
            checks: c.result?.checks,
          })),
        },
        null,
        2,
      ),
    );
  }
}

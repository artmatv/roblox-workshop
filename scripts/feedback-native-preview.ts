import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, ".."),
  s = new Store(resolve(root, "data"));
const token = await new Vault(s).get("dashboard-token");
s.close();
const [projectKey, styleNumber, captureId, noteFile] = process.argv.slice(2);
if (!/^[\w-]+$/.test(captureId)) throw new Error("Invalid capture id");
const projects = JSON.parse(
  readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
).projects;
const p = projects.find((p: any) => p.key === projectKey);
if (!p) throw new Error("No project");
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
const path = resolve(root, "data/native-captures", captureId + ".b64"),
  dataBase64 = readFileSync(path, "utf8").trim();
const bytes = Buffer.from(dataBase64, "base64");
const mime = bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : "image/png";
const attachment = await call("/attachments", { dataBase64, mime });
const feedback = await call("/projects/" + p.id + "/feedback", {
  text: readFileSync(resolve(root, noteFile), "utf8"),
  target: "style",
  priority: "high",
  attachments: [attachment],
});
const detail = await call("/projects/" + p.id),
  style = detail.styles[Number(styleNumber) - 1];
const task = await call("/projects/" + p.id + "/styles/preview", {
  styleId: style.id,
});
writeFileSync(
  resolve(root, "docs/control-projects/" + projectKey + "-native-repair.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      projectId: p.id,
      styleId: style.id,
      feedbackId: feedback.id,
      taskId: task.id,
      sourceCapture: captureId,
    },
    null,
    2,
  ),
);
unlinkSync(path);
console.log(
  JSON.stringify({
    project: p.name,
    style: style.name,
    feedbackId: feedback.id,
    taskId: task.id,
  }),
);

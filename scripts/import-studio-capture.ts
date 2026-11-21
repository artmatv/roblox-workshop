import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { Store, safePath } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { exportPlace } from "../server/export.js";
const root = resolve(import.meta.dirname, ".."),
  s = new Store(resolve(root, "data")),
  token = await new Vault(s).get("dashboard-token");
s.close();
const [projectKey, styleId, screen, device, captureId] = process.argv.slice(2);
if (
  !/^[a-f0-9-]{36}$/.test(styleId) ||
  !["hud", "shop", "inventory", "menu"].includes(screen) ||
  !["mobile", "desktop"].includes(device) ||
  !/^[a-zA-Z0-9_-]+$/.test(captureId)
)
  throw new Error("Invalid capture metadata");
const controls = JSON.parse(
    readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
  ).projects,
  project = controls.find((p: any) => p.key === projectKey);
if (!project) throw new Error("Unknown control project");
const input = safePath(
    resolve(root, "data"),
    "native-captures/" + captureId + ".b64",
  ),
  base64 = readFileSync(input, "utf8").trim(),
  bytes = Buffer.from(base64, "base64");
const isPng = bytes
  .subarray(0, 8)
  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
if (!isPng && !isJpeg) throw new Error("Expected native PNG/JPEG");
const extension = isPng ? ".png" : ".jpg",
  mime = isPng ? "image/png" : "image/jpeg";
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
const attachment = await call("/attachments", {
  dataBase64: base64,
  mime,
});
await call("/projects/" + project.id + "/styles/" + styleId + "/images", {
  file: attachment.file,
  screen,
  device,
  source: "Roblox Studio MCP",
  capturedAt: new Date().toISOString(),
});
const out = resolve(root, "outputs/native-style-review", projectKey, styleId);
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, screen + "-" + device + extension), bytes);
const detail = await call("/projects/" + project.id),
  style = detail.styles.find((s: any) => s.id === styleId),
  task = detail.tasks.find((t: any) => t.id === style?.previewTaskId);
if (task?.result) {
  writeFileSync(resolve(out, "scene.rbxlx"), exportPlace(task.result));
  writeFileSync(
    resolve(out, "manifest.json"),
    JSON.stringify(task.result, null, 2),
  );
}
writeFileSync(resolve(out, "style.json"), JSON.stringify(style, null, 2));
unlinkSync(input);
console.log(
  JSON.stringify(
    {
      project: project.name,
      style: style.name,
      screen,
      device,
      file: resolve(out, screen + "-" + device + extension),
      bytes: bytes.length,
    },
    null,
    2,
  ),
);

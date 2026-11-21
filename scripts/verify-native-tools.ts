import { nativeToolHost } from "../server/native-harness.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.js";
import {
  StudioMcp,
  findBoundStudio,
  studioMcpBinary,
  toolJson,
} from "../server/studio-mcp.js";
const appRoot = resolve(import.meta.dirname, ".."),
  root = mkdtempSync(resolve(tmpdir(), "native-tools-")),
  store = new Store(root),
  work = resolve(root, "workspace"),
  trace = resolve(root, "trace");
mkdirSync(work);
mkdirSync(trace);
const live = new DatabaseSync(resolve(appRoot, "data/studio.sqlite"), {
  readOnly: true,
});
const project = JSON.parse(
  live
    .prepare("SELECT body FROM records WHERE kind='project' AND id=?")
    .get("6e2f4916-c5c9-4cd0-be4d-b92075fabd84")!.body as string,
);
const studio = JSON.parse(
  live
    .prepare("SELECT body FROM records WHERE kind='studio' AND id=?")
    .get(project.studioId)!.body as string,
);
live.close();
const discover = new StudioMcp();
let bound;
try {
  await discover.start();
  bound = await findBoundStudio(studio.documentId, discover);
} finally {
  discover.close();
}
store.put("project", {
  id: "fixture",
  execution: "running",
  studioId: "bridge",
});
store.put("task", { id: "task", projectId: "fixture", status: "running" });
Object.assign(process.env, {
  WORKSHOP_WORKSPACE: work,
  WORKSHOP_STUDIO_ID: bound.id,
  WORKSHOP_STUDIO_NAME: bound.name,
  WORKSHOP_DOCUMENT_ID: studio.documentId,
  WORKSHOP_TASK_ID: "task",
  WORKSHOP_BRIDGE_ID: "bridge",
  WORKSHOP_TRACE_ROOT: trace,
  WORKSHOP_DATABASE: resolve(root, "studio.sqlite"),
  WORKSHOP_MCP_BINARY: studioMcpBinary(),
});
const host = nativeToolHost();
const proxy = new StudioMcp(host.command, host.args);
try {
  await proxy.start();
  const list = await proxy.call("tools/list", {});
  assert.ok(list.tools.some((t: any) => t.name === "generate_mesh"));
  assert.ok(list.tools.some((t: any) => t.name === "draw_icon"));
  assert.ok(!list.tools.some((t: any) => t.name === "subagent"));
  const scopes = toolJson(await proxy.tool("list_roblox_studios", {}));
  assert.equal(scopes.studios.length, 1);
  assert.equal(scopes.studios[0].id, bound.id);
  const actual = toolJson(
    await proxy.tool("execute_luau", {
      studio_id: "foreign-window-is-ignored",
      datamodel_type: "Edit",
      code: "return {documentId=game:GetAttribute('AutomationDocumentId')}",
    }),
  );
  assert.equal(actual.documentId, studio.documentId);
  const image = await proxy.tool("draw_icon", {
    name: "fixture-leaf",
    size: 128,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M30 100C12 54 48 10 108 14C116 80 72 112 30 100Z" fill="#27b279"/><path d="M28 104L94 32M46 83L45 56M64 64L85 64" stroke="#165a49" stroke-width="6" fill="none" stroke-linecap="round"/></svg>',
  });
  assert.ok(image.content.some((c: any) => c.type === "image" && c.data));
  store.put("project", {
    id: "fixture",
    execution: "paused",
    studioId: "bridge",
  });
  const stopped = await proxy.tool("execute_luau", {
    datamodel_type: "Edit",
    code: "return true",
  });
  assert.equal(stopped.isError, true);
  const report = {
    studioBinding: "document identity verified",
    nativeTools: list.tools.map((t: any) => t.name),
    foreignWindow: "forced to bound Studio",
    drawIcon: "real PNG image returned",
    pause: "tool mutation denied after pause",
  };
  mkdirSync(resolve(appRoot, "outputs/native-harness-verification"), {
    recursive: true,
  });
  writeFileSync(
    resolve(appRoot, "outputs/native-harness-verification/tools.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  proxy.close();
  store.close();
  if (
    root.startsWith(resolve(tmpdir()) + sep) &&
    basename(root).startsWith("native-tools-")
  )
    rmSync(root, { recursive: true, force: true });
}

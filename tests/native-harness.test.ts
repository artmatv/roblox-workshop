import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { Store } from "../server/store.js";
import { MAX_VISUAL_FRAMES, planVisualBatches } from "../server/native-visual.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import {
  nativePropertyList,
  readNativeAssetProperties,
  nativeToolHost,
  nativeToolPermissions,
  nativeAccessBlocker,
  assertNativeEvidence,
  prepareNativePythonRuntime,
  nativeFrameMapProblems,
  RELEASE_CLEAN_NOTE,
} from "../server/native-harness.js";
import {
  drawIcon,
  multiplayerTestProblem,
  insideWorkspace,
  writeWorkspacePath,
  STUDIO_TOOLS,
} from "../server/agent-studio-mcp.js";
import { inspectImage, verifyInspectedImage } from "../server/native-art.js";
import { NativeSpecialist } from "../server/native-specialist.js";
import { ExternalReviewProvider } from "../server/external-reviewer.js";
import {
  availableStudioDataModel,
  findBoundStudio,
  readStudioDocumentIdentity,
  StudioMcp,
} from "../server/studio-mcp.js";
import { NATIVE_KIND } from "../shared/native-harness.js";
import { acceptedItemsText } from "../shared/production-plan.js";
import { prepareNativeLocalization } from "../server/native-localization.js";
import {
  manifestSchema,
  snapshotManifestSchema,
  type Task,
  type Command,
} from "../shared/domain.js";
// Quality aspects the visual reviewer must score for the current plan fixture.
let fixtureAspects: string[] = [];
function fixture() {
  fixtureAspects = [];
  const root = mkdtempSync(resolve(tmpdir(), "native-harness-")),
    store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  const p = engine.createProject({
    name: "Native fixture",
    genre: "Simulator",
    goal: "Original park artwork",
  });
  p.specification = "Approved full specification";
  p.budget.approved = true;
  p.studioId = "native-studio";
  store.put("studio", {
    id: p.studioId,
    projectId: p.id,
    documentId: "document",
    capabilities: ["apply", "test", "capture", "snapshot", "import"],
  });
  for (const name of ["concept", "style", "specification", "budget"])
    p.approvals[name] = {
      hash: engine.approvalHash(p, name),
      revision: 0,
      at: new Date().toISOString(),
    };
  engine.save(p);
  return {
    root,
    store,
    engine,
    codex,
    p,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const evidence = () => [
  ...[
    "world-desktop",
    "hud-desktop",
    "shop-desktop",
    "collection-desktop",
    "hud-mobile",
  ].map((label) => ({
    tool: "screen_capture",
    success: true,
    arguments: { capture_id: label },
    captures: ["actual.png"],
    viewport: { device: label === "hud-mobile" ? "iphone_17_pro" : "default" },
  })),
  { tool: "draw_icon", asset: "assets/coin.png" },
  { tool: "upload_image", success: true },
  { tool: "generate_mesh", success: true },
];

function prepareComplete(f: ReturnType<typeof fixture>) {
  const t = f.engine.native.start(f.p);
  t.status = "running";
  t.attempt = 1;
  t.maxAttempts = 3;
  t.error = null;
  t.requirementsHash = f.engine.taskRequirementsHash(f.p, t);
  f.store.put("task", t);
  const workspace = f.engine.native.session(f.p.id)!.workspace;
  writeFileSync(
    resolve(workspace, "SPEC.md"),
    "Point arrows toward the next route waypoint; avoid visible surface overlap.",
  );
  writeFileSync(
    resolve(workspace, "VISUAL_BRIEF.md"),
    "Review visual evidence in context.",
  );
  writeFileSync(
    resolve(workspace, "delivery.json"),
    JSON.stringify({
      summary: "Completed the requested visual game work",
      artDirection:
        "A readable, polished park scene with a clear route and recognizable destinations.",
      assets: [
        {
          name: "Coin",
          kind: "icon",
          studioPath: "StarterGui/HUD",
          source: "draw_icon",
        },
        {
          name: "Tree",
          kind: "model",
          studioPath: "Workspace/Tree",
          source: "generate_mesh",
        },
      ],
      remainingIssues: [],
      // Every frame item of the fixture milestone is shown on the world view.
      frames: (() => {
        const v = f.engine.native.visualCriteria(f.p, t);
        return [...v.currentFrameItems, ...v.priorFrameItems].map((i) => ({ item: i.id, captureIds: ["world-desktop"] }));
      })(),
    }),
  );
  const traceRoot = f.engine.native.traceRoot(t);
  mkdirSync(traceRoot, { recursive: true });
  const screenshot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
    "base64",
  );
  writeFileSync(resolve(traceRoot, "actual.png"), screenshot);
  writeFileSync(
    resolve(traceRoot, "tools.jsonl"),
    evidence()
      .map((record, index) => ({
        ...record,
        taskId: t.id,
        attempt: t.attempt,
        ...(record.tool === "screen_capture"
          ? { captureRecordId: String(index + 1).padStart(24, "0") }
          : {}),
      }))
      .map((record) => JSON.stringify(record))
      .join("\n"),
  );
  (f.engine.native as any).readSceneAssets = async () => [];
  return t;
}
function prepareNativeRetry(f: ReturnType<typeof fixture>) {
  const t = f.engine.native.start(f.p);
  t.status = "queued";
  t.attempt = 1;
  t.threadId = "parent-thread";
  t.error = "Результат не принят: исправь подтверждённую проблему";
  t.requirementsHash = f.engine.taskRequirementsHash(f.p, t);
  f.store.put("task", t);
  const session = f.engine.native.session(f.p.id)!;
  f.store.put("nativeSession", {
    ...session,
    threadId: t.threadId,
    status: "blocked",
  });
  f.engine.account = { account: { type: "chatgpt" } } as any;
  f.engine.effortConfig = async () =>
    ({ model: "gpt-6.1-sol", effort: "medium" }) as any;
  f.codex.isolatedConfig = async () =>
    ({
      features: {},
      shell_environment_policy: {
        inherit: "all",
        set: { KEEP_ME: "preserved", PYTHONPATH: "old-runtime" },
      },
      mcp_servers: { inherited: { enabled: false } },
    }) as any;
  return t;
}

function prepareTimedOutNativeTask(f: ReturnType<typeof fixture>) {
  const t = prepareNativeRetry(f);
  t.status = "running";
  t.turnId = "parent-turn";
  t.startedAt = new Date(0).toISOString();
  t.maxAttempts = 3;
  f.store.put("task", t);
  const session = f.engine.native.session(f.p.id)!;
  f.store.put("nativeSession", { ...session, threadId: t.threadId, status: "working" });
  f.engine.active.add(t.id);
  f.engine.account = { account: { type: "chatgpt" } } as any;
  f.codex.ready = true;
  f.engine.lastPoll = Date.now();
  (f.engine.native as any).run = async () => {};
  return t;
}
function mockNativeStudioTools() {
  const priorEnv = process.env.ROBLOX_STUDIO_MCP_BINARY;
  const original = {
    start: StudioMcp.prototype.start,
    tool: StudioMcp.prototype.tool,
  };
  process.env.ROBLOX_STUDIO_MCP_BINARY = process.execPath;
  StudioMcp.prototype.start = async function () {};
  StudioMcp.prototype.tool = async function (name: string) {
    if (name === "get_studio_state")
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: "- Current Studio Mode: Edit\n- Available DataModels: Edit",
          },
        ],
      } as any;
    const value =
      name === "list_roblox_studios"
        ? { studios: [{ id: "native-studio", name: "Fixture Studio" }] }
        : { documentId: "document" };
    return {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(value) }],
    } as any;
  };
  return () => {
    StudioMcp.prototype.start = original.start;
    StudioMcp.prototype.tool = original.tool;
    if (priorEnv === undefined) delete process.env.ROBLOX_STUDIO_MCP_BINARY;
    else process.env.ROBLOX_STUDIO_MCP_BINARY = priorEnv;
  };
}
function visualAnswer(
  verdict: string,
  findings: any[] = [],
  checklist?: any[],
  quality: any[] = fixtureAspects.map((aspect) => ({
    aspect,
    score: 5,
    captureId: "world-desktop",
    note: "Clean",
  })),
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          role: "reviewer",
          model: "gpt-6.1-sol",
          effort: "medium",
          summary: "Visual evidence reviewed",
          files: [],
          visualReview: {
            verdict,
            summary:
              verdict === "pass"
                ? "No objective visual defects found"
                : "The requested view needs correction",
            findings,
            ...(checklist ? { checklist } : {}),
            quality,
          },
        }),
      },
    ],
  };
}
test("a new native task preserves its workspace without reusing the previous task thread", () => {
  const f = fixture();
  try {
    f.engine.planProduction(f.p);
    const tasks = f.engine.tasks(f.p.id);
    assert.equal(tasks.length, 1);
    const first = tasks[0];
    assert.equal(first.kind, NATIVE_KIND);
    assert.ok(
      first.scope.includes("Workspace") &&
        first.scope.includes("StarterGui") &&
        first.scope.includes("ServerScriptService"),
    );
    const skills = f.engine.skillContext(f.p, first);
    for (const id of ["create-game-assets", "roblox-ui", "roblox-datastores"])
      assert.ok(skills.includes("SKILL " + id));
    const session = f.engine.native.session(f.p.id)!;
    writeFileSync(resolve(session.workspace, "original.svg"), "preserved");
    first.status = "succeeded";
    first.threadId = "persistent-owner";
    f.store.put("task", first);
    f.store.put("nativeSession", {
      ...session,
      threadId: first.threadId,
      status: "review",
    });
    const next = f.engine.native.start(
      f.engine.project(f.p.id),
      "Improve silhouette",
    );
    assert.equal(next.threadId, null);
    assert.equal(f.engine.native.session(f.p.id)!.threadId, null);
    assert.equal(f.engine.native.session(f.p.id)!.workspace, session.workspace);
    assert.equal(
      readFileSync(resolve(session.workspace, "original.svg"), "utf8"),
      "preserved",
    );
    assert.equal(
      f.engine.tasks(f.p.id).filter((t) => t.kind === "integration").length,
      0,
    );
  } finally {
    f.close();
  }
});
test("native production retains approval gates and paused/failed work cannot look active", () => {
  const f = fixture();
  try {
    delete f.p.approvals.budget;
    f.engine.save(f.p);
    assert.throws(() => f.engine.native.start(f.p), /согласование/);
    assert.equal(f.engine.tasks(f.p.id).length, 0);
    f.p.approvals.budget = {
      hash: f.engine.approvalHash(f.p, "budget"),
      revision: 0,
      at: new Date().toISOString(),
    };
    const t = f.engine.native.start(f.p);
    t.status = "failed";
    t.error = "Actual failure";
    f.store.put("task", t);
    assert.equal(f.engine.native.session(f.p.id)!.status, "failed");
    assert.equal(f.engine.native.session(f.p.id)!.summary, "Actual failure");
  } finally {
    f.close();
  }
});
test("a text success or relabelled desktop capture cannot substitute for actual artwork and mobile evidence", () => {
  assert.throws(() => assertNativeEvidence([]), /снимки/);
  const sameViewport = evidence().map((r) => ({
    ...r,
    viewport: { device: "default" },
  }));
  assert.throws(
    () => assertNativeEvidence(sameViewport),
    /симулятора телефона/,
  );
  assert.throws(
    () =>
      assertNativeEvidence(
        evidence().filter((r) => r.tool !== "generate_mesh"),
      ),
    /3D mesh/,
  );
  assert.equal(assertNativeEvidence(evidence()).length, 5);
  const current = evidence().map((record) => ({
    ...record,
    taskId: "task",
    attempt: 2,
  }));
  assert.equal(assertNativeEvidence(current, current, 2, "task").length, 5);
  assert.throws(
    () => assertNativeEvidence(current, current, 1, "task"),
    /снимки Studio/,
  );
  assert.throws(
    () =>
      assertNativeEvidence(
        current.map((record) => ({ ...record, taskId: "other" })),
        current,
        2,
        "task",
      ),
    /снимки Studio/,
  );
  assert.ok(!STUDIO_TOOLS.includes("subagent"));
  assert.ok(STUDIO_TOOLS.includes("generate_mesh"));
});
test("an original SVG is rendered as an inspectable transparent PNG, and external resources or workspace escapes are rejected", async () => {
  const f = fixture();
  try {
    const workspace = resolve(f.root, "workspace");
    mkdirSync(workspace);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M20 20L108 20L108 108L20 108Z" fill="#03a9a0"/></svg>';
    const icon = await drawIcon(workspace, { name: "fixture", svg, size: 128 });
    const png = readFileSync(resolve(workspace, icon.path));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 128);
    assert.equal(png.readUInt32BE(20), 128);
    assert.ok(icon.data.length > 10);
    await assert.rejects(() => drawIcon(workspace, { name: "../escape", svg }));
    await assert.rejects(() =>
      drawIcon(workspace, {
        name: "bad",
        svg: '<svg><image href="file:///secret.png"/></svg>',
      }),
    );
    assert.throws(() => writeWorkspacePath(workspace, "../outside.svg"));
    const external = resolve(f.root, "external");
    mkdirSync(external);
    writeFileSync(resolve(external, "outside.svg"), "secret");
    symlinkSync(external, resolve(workspace, "linked"), "junction");
    assert.throws(() => insideWorkspace(workspace, "linked/outside.svg"));
    assert.throws(() => writeWorkspacePath(workspace, "linked/new.svg"));
  } finally {
    f.close();
  }
});
test("a PNG gets a real offline preview and only its inspected bytes can pass upload verification", async () => {
  const f = fixture();
  try {
    const workspace = resolve(f.root, "workspace"),
      trace = resolve(f.root, "trace"),
      path = "assets/icon.png";
    mkdirSync(resolve(workspace, "assets"), { recursive: true });
    mkdirSync(trace);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=",
      "base64",
    );
    writeFileSync(resolve(workspace, path), png);
    const result = await inspectImage(workspace, trace, { path, kind: "icon" });
    assert.equal(result.asset, path);
    assert.equal(result.sha256, createHash("sha256").update(png).digest("hex"));
    assert.equal(result.content[1].type, "image");
    assert.deepEqual(result.previewLayout, {
      icon32: { width: 32, height: 32 },
      icon48: { width: 48, height: 48 },
      backgrounds: ["light", "dark"],
    });
    assert.ok(readFileSync(resolve(trace, result.preview)).length > 100);
    const tile = await inspectImage(workspace, trace, {
      path,
      kind: "texture",
    });
    assert.equal(tile.previewLayout.tile.columns, 2);
    assert.equal(tile.previewLayout.tile.rows, 2);
    assert.equal(tile.previewLayout.tile.cellAspectRatio, 1);
    assert.ok(Math.abs(tile.previewLayout.tile.horizontalGap) < 1);
    assert.ok(Math.abs(tile.previewLayout.tile.verticalGap) < 1);
    const records = [
      {
        tool: "inspect_image",
        success: true,
        asset: path,
        sha256: result.sha256,
      },
    ];
    assert.equal(
      verifyInspectedImage(workspace, path, records).inspectionSha256,
      result.sha256,
    );
    const changed = Buffer.from(png);
    changed[changed.length - 5] ^= 1;
    writeFileSync(resolve(workspace, path), changed);
    const changedSha = createHash("sha256").update(changed).digest("hex");
    assert.throws(
      () => verifyInspectedImage(workspace, path, records),
      /inspect_image/,
    );
    writeFileSync(resolve(workspace, path), png);
    assert.throws(
      () =>
        verifyInspectedImage(workspace, path, [
          { ...records[0], success: false },
        ]),
      /inspect_image/,
    );
    writeFileSync(resolve(workspace, "assets/other.png"), png);
    assert.throws(
      () =>
        [path, "assets/other.png"].map((asset) =>
          verifyInspectedImage(workspace, asset, records),
        ),
      /other.png/,
    );
  } finally {
    f.close();
  }
});
test("a native checkpoint requires the newly uploaded icon in real GUI and leaves every acceptance check unrun", () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    const delivery = {
      summary: "A real visual slice for owner review",
      artDirection:
        "Original art direction with subject hierarchy and a clear route.",
      assets: [
        {
          name: "Coin",
          kind: "icon",
          studioPath: "StarterGui/HUD/Coin",
          source: "assets/coin.svg",
        },
        {
          name: "Recycler",
          kind: "model",
          studioPath: "Workspace/Recycler",
          source: "generate_mesh",
        },
      ],
      remainingIssues: [],
    };
    const localizationArtifact = prepareNativeLocalization({
      sourceLocaleId: "en-us",
      entries: [{ key: "hud.coins", source: "Coins: {count:int}", context: "HUD balance" }],
    });
    f.store.put("nativeDelivery", {
      id: t.id,
      delivery,
      assetProperties: {
        "1": {
          path: "Workspace/Recycler",
          properties: { TextureID: "rbxassetid://42" },
        },
      },
      records: [
        {
          tool: "upload_image",
          success: true,
          result: [{ text: '{"coin":"rbxassetid://5"}' }],
        },
      ],
      localizationArtifact,
    });
    const extraInstances = Array.from({ length: 2001 }, (_, index) => ({
      path: `Workspace/SnapshotPart${index + 1}`,
      className: "Part",
      properties: { Anchored: true, Name: `SnapshotPart${index + 1}` },
    }));
    assert.equal(
      manifestSchema.safeParse({ summary: "AI", instances: extraInstances })
        .success,
      false,
    );
    assert.equal(
      snapshotManifestSchema.safeParse({
        summary: "snapshot",
        instances: [
          { path: "Workspace/Bad\\Path", className: "Part", properties: {} },
        ],
      }).success,
      false,
    );
    const c: Command = {
      id: "snapshot",
      projectId: f.p.id,
      taskId: t.id,
      studioId: f.p.studioId!,
      baseRevision: 0,
      targetRevision: 0,
      operation: "snapshot",
      payload: { nativeCheckpoint: true },
      status: "succeeded",
      createdAt: new Date().toISOString(),
      sentAt: null,
      expectedFingerprint: "old",
      result: {
        fingerprint: "actual",
        instances: [
          {
            path: "Workspace/Recycler",
            className: "MeshPart",
            properties: { MeshId: "rbxassetid://10" },
          },
          {
            path: "StarterGui/HUD/Coin",
            className: "ImageLabel",
            properties: { Image: "rbxassetid://99" },
          },
          ...extraInstances,
          ...Object.entries(localizationArtifact.sources).map(([path, value]) => ({
            path, className: value.className, properties: {}, source: value.source,
          })),
        ],
      },
    };
    f.store.put("command", c);
    assert.throws(() => f.engine.native.checkpoint(c, t), /GUI/);
    assert.equal(f.engine.project(f.p.id).revision, 0);
    (c.result!.instances as any[])[1] = {
      path: "StarterPlayer/StarterPlayerScripts/HUD",
      className: "LocalScript",
      properties: {},
      source:
        'local image=Instance.new("ImageLabel");image.Image="rbxassetid://5"',
    };
    const localizationInstance = (c.result!.instances as any[]).find(
      (instance) => instance.path === "ReplicatedStorage/AutomationI18n",
    );
    const localizationSource = localizationInstance.source;
    const versionsBeforeLocalizationRejection = f.engine.versions(f.p.id).length;
    localizationInstance.source += "\n-- unjournaled edit";
    assert.throws(() => f.engine.native.checkpoint(c, t), /Снимок Studio/);
    assert.equal(f.engine.project(f.p.id).revision, 0);
    assert.equal(f.engine.versions(f.p.id).length, versionsBeforeLocalizationRejection);
    localizationInstance.source = localizationSource;
    const duplicateCatalog = structuredClone(
      (c.result!.instances as any[]).find(
        (instance) => instance.path === "ReplicatedStorage/AutomationLocaleCatalog",
      ),
    );
    (c.result!.instances as any[]).push(duplicateCatalog);
    assert.throws(() => f.engine.native.checkpoint(c, t), /ровно один/);
    assert.equal(f.engine.project(f.p.id).revision, 0);
    assert.equal(f.engine.versions(f.p.id).length, versionsBeforeLocalizationRejection);
    (c.result!.instances as any[]).pop();
    f.store.put("command", c);
    f.engine.native.checkpoint(c, t);
    assert.equal(f.engine.project(f.p.id).execution, "decision");
    assert.equal(f.engine.project(f.p.id).stage, "review");
    assert.ok(
      f.engine
        .versions(f.p.id)[0]
        .checks.every((check) => check.status === "not_run"),
    );
    assert.equal(
      f.engine
        .versions(f.p.id)[0]
        .manifest.instances.find((i) => i.path === "Workspace/Recycler")
        ?.properties.TextureID,
      "rbxassetid://42",
    );
    assert.equal(f.engine.native.session(f.p.id)!.status, "review");
    assert.equal(f.engine.versions(f.p.id)[0].manifest.instances.length, 2006);
    assert.deepEqual(
      (f.engine.versions(f.p.id)[0].manifest.data.localization as any).entries.map((entry: any) => entry.key),
      ["hud.coins"],
    );
    assert.ok(f.engine.versions(f.p.id)[0].manifest.files.some((file) => file.path === "localization/en-us.csv" && file.content.includes("hud.coins")));
  } finally {
    f.close();
  }
});
test("live feedback steers the existing owner turn rather than spawning independent workers", async () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    t.status = "running";
    t.threadId = "owner";
    t.turnId = "turn";
    f.store.put("task", t);
    const calls: any[] = [];
    f.codex.request = async (method, params) => {
      calls.push({ method, params });
      return { turnId: "turn" };
    };
    await f.engine.native.steer(t, "Make the entrance readable");
    assert.equal(calls[0].method, "turn/steer");
    assert.equal(calls[0].params.expectedTurnId, "turn");
    assert.match(calls[0].params.input[0].text, /entrance/);
    assert.equal(f.engine.tasks(f.p.id).length, 1);
  } finally {
    f.close();
  }
});

test("the actual native MCP launch uses a file URL for the Node import loader on Windows", () => {
  const host = nativeToolHost();
  assert.equal(host.args[0], "--import");
  assert.equal(new URL(host.args[1]).protocol, "file:");
  assert.ok(host.args[2].endsWith("agent-studio-mcp.ts"));
});

test("Studio document identity selects an available model in Play and requires one exact matching document", async () => {
  const clientFor = (
    studios: Array<{ id: string; name: string }>,
    states: Record<string, any>,
    documents: Record<string, string>,
  ) => {
    const calls: any[] = [];
    return {
      calls,
      client: {
        async tool(name: string, args: any) {
          calls.push({ name, args });
          if (name === "list_roblox_studios")
            return {
              isError: false,
              content: [{ type: "text", text: JSON.stringify({ studios }) }],
            };
          if (name === "get_studio_state")
            return (
              states[args.studio_id] ?? {
                isError: false,
                content: [
                  {
                    type: "text",
                    text: "- Current Studio Mode: Edit\n- Available DataModels: Edit",
                  },
                ],
              }
            );
          if (name === "execute_luau")
            return {
              isError: false,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    documentId: documents[args.studio_id],
                  }),
                },
              ],
            };
          throw new Error(`Unexpected Studio tool: ${name}`);
        },
      } as any,
    };
  };
  const playState = {
    isError: false,
    content: [
      {
        type: "text",
        text: "- Current Studio Mode: Play\n- Available DataModels: Client, Server\n- Focused DataModel in the viewport: Client",
      },
    ],
  };
  assert.equal(availableStudioDataModel(playState), "Server");
  assert.throws(
    () =>
      availableStudioDataModel({
        isError: false,
        content: [{ type: "text", text: "Studio unavailable" }],
      }),
    /нет строки Available DataModels/,
  );
  assert.throws(
    () => availableStudioDataModel({ isError: true, content: [] }),
    /Studio недоступна/,
  );

  const identityClient = clientFor(
    [],
    { target: playState },
    { target: "document" },
  );
  assert.deepEqual(
    await readStudioDocumentIdentity(
      identityClient.client,
      "target",
      "document",
    ),
    { documentId: "document", datamodel_type: "Server" },
  );
  assert.equal(
    identityClient.calls.find((call) => call.name === "execute_luau")?.args
      .datamodel_type,
    "Server",
  );

  const studios = [
    { id: "play-studio", name: "Play" },
    { id: "other-studio", name: "Other" },
  ];
  const matching = clientFor(
    studios,
    { "play-studio": playState, "other-studio": playState },
    { "play-studio": "document", "other-studio": "different" },
  );
  assert.deepEqual(
    await findBoundStudio("document", matching.client),
    studios[0],
  );
  assert.equal(
    matching.calls.find(
      (call) =>
        call.name === "execute_luau" && call.args.studio_id === "play-studio",
    )?.args.datamodel_type,
    "Server",
  );

  const duplicate = clientFor(
    [...studios, { id: "third-studio", name: "Third" }],
    {
      "play-studio": playState,
      "other-studio": playState,
      "third-studio": playState,
    },
    {
      "play-studio": "document",
      "other-studio": "document",
      "third-studio": "different",
    },
  );
  await assert.rejects(
    findBoundStudio("document", duplicate.client),
    /найдено 2/,
  );

  const none = clientFor(
    studios,
    {
      "play-studio": playState,
      "other-studio": { isError: true, content: [] },
    },
    { "play-studio": "different" },
  );
  await assert.rejects(findBoundStudio("document", none.client, 0), /найдено 0/);

  // A fresh StudioMCP.exe lists no Studio until Studio reconnects to it.
  let lists = 0;
  const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const reconnecting = {
    tool: async (name: string) =>
      name === "list_roblox_studios"
        ? text({ studios: lists++ ? [studios[0]] : [] })
        : name === "get_studio_state"
          ? { content: [{ type: "text", text: "Available DataModels: Edit" }] }
          : text({ documentId: "document" }),
  } as any;
  assert.deepEqual(await findBoundStudio("document", reconnecting, 0), studios[0]);
  assert.equal(lists, 2);
});

test("already-authorized art tools are explicitly allowed in the noninteractive session, and access failure is classified before empty delivery validation", () => {
  const tools = nativeToolPermissions();
  for (const name of [
    "draw_icon",
    "inspect_image",
    "upload_image",
    "generate_mesh",
    "execute_luau",
    "prepare_localization",
  ])
    assert.equal(tools[name].approval_mode, "approve");
  assert.equal(tools.subagent, undefined);
  assert.equal(tools.insert_asset, undefined);
  const message =
    "draw_icon rejected: MCP tool call requires approval, but approval policy is never";
  assert.equal(
    nativeAccessBlocker({ assets: [], remainingIssues: [message] }),
    message,
  );
  assert.equal(
    nativeAccessBlocker({
      remainingIssues: ["The shop composition still needs work"],
    }),
    undefined,
  );
  const staleLease =
    "Работа остановлена или Studio больше не привязана к проекту";
  assert.equal(
    nativeAccessBlocker({ remainingIssues: [staleLease] }),
    staleLease,
  );
});

test("a pre-allocation native start failure blocks the queued task without spending an attempt", async () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    f.engine.account = null;
    await f.engine.native.run(f.p, t);
    const saved = f.store.get<Task>("task", t.id)!;
    assert.equal(saved.status, "blocked");
    assert.equal(saved.attempt, 0);
    assert.match(saved.error || "", /Подключите аккаунт исполнителя/);
  } finally {
    f.close();
  }
});

test("a queued task waits for the first account check after a restart", async () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    f.engine.account = null;
    f.engine.accountError = null;
    f.engine.lastPoll = Date.now();
    await f.engine.tick();
    assert.equal(f.store.get<Task>("task", t.id)?.status, "queued");
    f.engine.accountError = "Codex: таймаут account/read";
    await f.engine.tick();
    const saved = f.store.get<Task>("task", t.id)!;
    assert.equal(saved.status, "blocked");
    assert.match(saved.error || "", /таймаут account\/read/);
  } finally {
    f.close();
  }
});

test("a long running turn gets one delivery warning before the timeout", async () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    const minutes = f.p.settings.timeoutMinutes;
    Object.assign(t, {
      status: "running", attempt: 1, threadId: "th", turnId: "tu",
      startedAt: new Date(Date.now() - (minutes - 1) * 60000).toISOString(),
    });
    f.store.put("task", t);
    const calls: any[] = [];
    f.codex.request = async (method, params) => (calls.push({ method, params }), {});
    await f.engine.native.warnTime(f.p, t);
    await f.engine.native.warnTime(f.p, t);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "turn/steer");
    assert.equal(calls[0].params.expectedTurnId, "tu");
    assert.equal(f.store.get<Task>("task", t.id)?.timeWarnedAttempt, 1);
    // After the warning, self-review no longer spends the remaining time.
    await assert.rejects(
      f.engine.native.previewVisualReview(f.p, f.store.get<Task>("task", t.id)!),
      /заверши ход сейчас/,
    );
    t.startedAt = new Date().toISOString();
    t.attempt = 2;
    await f.engine.native.warnTime(f.p, t);
    assert.equal(calls.length, 1);
  } finally {
    f.close();
  }
});

test("review findings survive a later external block of the same task", () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    t.attempt = 1;
    f.engine.fail(t, "Результат не принят: визуальная проверка needs_changes. плитки пересекаются");
    const queued = f.store.get<Task>("task", t.id)!;
    assert.equal(queued.status, "queued");
    queued.attempt = 2;
    f.engine.fail(queued, "Подключите ChatGPT");
    const blocked = f.store.get<Task>("task", t.id)!;
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.error, "Подключите ChatGPT");
    assert.match(blocked.rejection || "", /плитки пересекаются/);
  } finally {
    f.close();
  }
});

test("a real correction retry forks with the fresh MCP lease and persists the child before its turn", async () => {
  const f = fixture();
  const restoreStudio = mockNativeStudioTools();
  try {
    const t = prepareNativeRetry(f);
    t.turnId = "parent-turn";
    f.store.put("task", t);
    const pythonSource = resolve(f.store.root, "python-runtime");
    mkdirSync(pythonSource, { recursive: true });
    writeFileSync(
      resolve(pythonSource, "fake_package.py"),
      "value = 'copied'\n",
    );
    // The runtime copy of an earlier run is removed, not accumulated.
    const staleCopy = resolve(
      f.engine.native.session(f.p.id)!.workspace,
      ".tool-runtime",
      "python-stale",
    );
    mkdirSync(staleCopy, { recursive: true });
    writeFileSync(resolve(staleCopy, "old.py"), "value = 'stale'\n");
    const calls: Array<{ method: string; params: any }> = [];
    f.codex.request = async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/fork") {
        const pendingTask = f.store.get<Task>("task", t.id)!;
        assert.equal(pendingTask.threadId, null);
        assert.equal(pendingTask.turnId, null);
        assert.equal(f.engine.native.session(f.p.id)?.threadId, null);
        return { thread: { id: "child-thread" } };
      }
      if (method === "turn/start") return { turn: { id: "child-turn" } };
      return {};
    };
    await f.engine.native.run(f.p, t);
    const fork = calls.find((call) => call.method === "thread/fork")!;
    const turn = calls.find((call) => call.method === "turn/start")!;
    assert.equal(fork.params.threadId, "parent-thread");
    assert.equal(
      fork.params.config.mcp_servers.workshop.env.WORKSHOP_ATTEMPT,
      "2",
    );
    assert.equal(fork.params.config.mcp_servers.inherited.enabled, false);
    const pythonPath =
      fork.params.config.shell_environment_policy.set.PYTHONPATH;
    assert.equal(
      pythonPath.startsWith(
        resolve(
          f.engine.native.session(f.p.id)!.workspace,
          ".tool-runtime",
          "python-",
        ),
      ),
      true,
    );
    assert.notEqual(pythonPath, pythonSource);
    assert.equal(
      readFileSync(resolve(pythonPath, "fake_package.py"), "utf8"),
      "value = 'copied'\n",
    );
    assert.equal(existsSync(staleCopy), false);
    const taskWorkspace = f.engine.native.session(f.p.id)!.workspace;
    assert.deepEqual(fork.params.config.shell_environment_policy, {
      inherit: "all",
      set: {
        KEEP_ME: "preserved",
        PYTHONPATH: pythonPath,
        PYTHONNOUSERSITE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        BLENDER_EXECUTABLE: resolve(taskWorkspace, "runtime/blender", process.platform === "win32" ? "blender.exe" : "blender"),
        BLENDER_USER_CONFIG: resolve(taskWorkspace, "runtime/blender-profile/config"),
        BLENDER_USER_SCRIPTS: resolve(taskWorkspace, "runtime/blender-profile/scripts"),
        BLENDER_USER_DATAFILES: resolve(taskWorkspace, "runtime/blender-profile/datafiles"),
      },
    });
    assert.equal(
      fork.params.config.sandbox_workspace_write.network_access,
      false,
    );
    assert.equal(turn.params.threadId, "child-thread");
    assert.equal(f.store.get<Task>("task", t.id)?.threadId, "child-thread");
    assert.equal(f.engine.native.session(f.p.id)?.threadId, "child-thread");
    assert.equal(f.store.get<Task>("task", t.id)?.turnId, "child-turn");
  } finally {
    restoreStudio();
    f.close();
  }
});

test("a pause during native fork restores the known parent and resume requeues before any turn starts", async () => {
  const f = fixture();
  const restoreStudio = mockNativeStudioTools();
  try {
    const t = prepareNativeRetry(f);
    let entered!: () => void;
    let resolveFork!: (value: any) => void;
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    let waitTimer: NodeJS.Timeout;
    const boundedEntry = Promise.race([
      enteredPromise,
      new Promise<never>((_, reject) => {
        waitTimer = setTimeout(
          () => reject(new Error("Timed out waiting for fork RPC")),
          15_000,
        );
      }),
    ]);
    const delayedFork = new Promise<any>((resolve) => (resolveFork = resolve));
    const methods: string[] = [];
    f.codex.request = async (method) => {
      methods.push(method);
      if (method === "thread/fork") {
        entered();
        return delayedFork;
      }
      if (method === "turn/start") return { turn: { id: "unexpected-turn" } };
      return {};
    };

    const running = f.engine.native.run(f.p, t);
    await boundedEntry;
    clearTimeout(waitTimer!);
    f.engine.control(f.p.id, "pause");
    resolveFork({ thread: { id: "abandoned-child" } });
    await running;

    const paused = f.store.get<Task>("task", t.id)!;
    assert.equal(paused.status, "blocked");
    assert.equal(paused.attempt, 1);
    assert.equal(paused.threadId, "parent-thread");
    assert.equal(paused.turnId, null);
    assert.equal(paused.startedAt, null);
    assert.equal(paused.reservationId, null);
    assert.match(paused.error || "", /приостановлен владельцем/);
    assert.equal(f.engine.native.session(f.p.id)?.threadId, "parent-thread");
    assert.equal(f.engine.native.session(f.p.id)?.status, "blocked");
    assert.equal(methods.includes("turn/start"), false);
    assert.equal(f.engine.active.has(t.id), false);

    f.engine.control(f.p.id, "resume");
    assert.equal(f.store.get<Task>("task", t.id)?.status, "queued");
    assert.equal(f.engine.project(f.p.id).execution, "running");
  } finally {
    restoreStudio();
    f.close();
  }
});

test("a busy Codex before any turn starts requeues the task without spending an attempt", async () => {
  const f = fixture();
  const restoreStudio = mockNativeStudioTools();
  try {
    const t = prepareNativeRetry(f);
    const execution = f.engine.project(f.p.id).execution;
    f.codex.isolatedConfig = async () => {
      throw new Error("Codex: таймаут config/read");
    };
    f.engine.active.add(t.id);
    await f.engine.native.run(f.p, t);
    const saved = f.store.get<Task>("task", t.id)!;
    assert.equal(saved.status, "queued");
    assert.equal(saved.attempt, 1);
    assert.equal(saved.reservationId, null);
    assert.equal(saved.error, "Результат не принят: исправь подтверждённую проблему");
    assert.equal(f.engine.active.has(t.id), false);
    assert.equal(f.engine.project(f.p.id).execution, execution);
  } finally {
    restoreStudio();
    f.close();
  }
});

test("native timeout waits for turn/completed after interrupt acknowledgement before retrying", async () => {
  const f = fixture();
  try {
    const t = prepareTimedOutNativeTask(f);
    let interruptRequested = false;
    let retryStarted = false;
    (f.engine.native as any).run = async () => { retryStarted = true; };
    f.codex.request = async (method) => {
      if (method === "turn/interrupt") {
        interruptRequested = true;
        return {};
      }
      return {};
    };

    const tick = f.engine.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(interruptRequested, true);
    assert.equal(retryStarted, false);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "running");

    f.codex.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "parent-thread",
        turn: { id: "parent-turn", status: "interrupted" },
      },
    });
    await tick;
    assert.equal(f.store.get<Task>("task", t.id)?.status, "queued");
    assert.equal(retryStarted, false);
    await f.engine.tick();
    assert.equal(retryStarted, true);
  } finally {
    f.close();
  }
});

test("a pause or a service restart returns the running developer attempt", async () => {
  const f = fixture();
  try {
    const t = prepareTimedOutNativeTask(f);
    t.startedAt = new Date().toISOString();
    t.timeWarnedAttempt = t.attempt;
    f.store.put("task", t);
    const spent = t.attempt;
    f.codex.request = async () => ({});
    f.engine.control(f.p.id, "pause");
    f.codex.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "parent-thread",
        turn: { id: "parent-turn", status: "interrupted" },
      },
    });
    const paused = f.store.get<Task>("task", t.id)!;
    assert.equal(paused.status, "blocked");
    assert.equal(paused.attempt, spent - 1);
    assert.equal(paused.timeWarnedAttempt, undefined);
    f.engine.control(f.p.id, "resume");
    assert.equal(f.store.get<Task>("task", t.id)!.status, "queued");

    // The same task caught mid-turn by a restart.
    const running = f.store.get<Task>("task", t.id)!;
    running.status = "running";
    running.attempt = spent;
    running.turnId = "parent-turn";
    f.store.put("task", running);
    f.engine.recover();
    const recovered = f.store.get<Task>("task", t.id)!;
    assert.equal(recovered.status, "queued");
    assert.equal(recovered.attempt, spent - 1);
    assert.equal(recovered.turnId, null);
    assert.equal(recovered.threadId, "parent-thread");
  } finally {
    f.close();
  }
});

test("a restart drops replaced Studio connections that nothing refers to", () => {
  const f = fixture();
  try {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const base = { projectId: f.p.id, documentId: "document", capabilities: [], lastSeen: old };
    f.store.put("studio", { ...base, id: "dead", replacedBy: "native-studio" });
    f.store.put("bridgeToken", { id: "dead", hash: "x" });
    f.store.put("studio", { ...base, id: "fresh", replacedBy: "native-studio", lastSeen: new Date().toISOString() });
    f.store.put("studio", { ...base, id: "other-place" });
    f.engine.recover();
    assert.equal(f.store.get("studio", "dead"), undefined);
    assert.equal(f.store.get("bridgeToken", "dead"), undefined);
    assert.ok(f.store.get("studio", "fresh"));
    assert.ok(f.store.get("studio", "other-place"));
    assert.ok(f.store.get("studio", "native-studio"));
  } finally {
    f.close();
  }
});

test("native timeout blocks instead of retrying when Codex cannot confirm interruption", async () => {
  const f = fixture();
  try {
    const t = prepareTimedOutNativeTask(f);
    let retryStarted = false;
    (f.engine.native as any).run = async () => { retryStarted = true; };
    f.codex.request = async (method) => {
      if (method === "turn/interrupt") throw new Error("transport timeout");
      return {};
    };

    await f.engine.tick();
    const saved = f.store.get<Task>("task", t.id)!;
    assert.equal(saved.status, "blocked");
    assert.equal(saved.attempt, 1);
    assert.equal(saved.threadId, "parent-thread");
    assert.equal(saved.turnId, "parent-turn");
    assert.match(saved.error || "", /остановка текущего Codex turn не подтверждена/);
    assert.equal(retryStarted, false);
  } finally {
    f.close();
  }
});

test("a run starting after a long wait in the queue is not timed out by the previous attempt's start time", async () => {
  const f = fixture();
  try {
    const t = prepareTimedOutNativeTask(f);
    // run() has marked the task active but has not started the new attempt yet.
    const queued = f.store.get<Task>("task", t.id)!;
    queued.status = "queued";
    f.store.put("task", queued);
    let interrupted = false;
    f.codex.request = async (method) => {
      if (method === "turn/interrupt") interrupted = true;
      return {};
    };
    await f.engine.tick();
    const saved = f.store.get<Task>("task", t.id)!;
    assert.equal(saved.status, "queued");
    assert.equal(saved.attempt, 1);
    assert.equal(interrupted, false);
    assert.equal(f.engine.project(f.p.id).execution, "running");
  } finally {
    f.close();
  }
});

test("the task-local Python runtime copy is unique, contained, and optional when its source is absent", () => {
  const root = mkdtempSync(
    resolve(process.cwd(), ".tmp-native-python-runtime-"),
  );
  try {
    const source = resolve(root, "source"),
      workspace = resolve(root, "workspace");
    mkdirSync(resolve(source, "nested"), { recursive: true });
    mkdirSync(workspace);
    writeFileSync(resolve(source, "nested", "module.py"), "value = 1\n");
    writeFileSync(resolve(source, "defaults.json"), '{"version":"clean"}');
    const first = prepareNativePythonRuntime(source, workspace);
    writeFileSync(resolve(first, "nested", "module.py"), "value = 2\n");
    writeFileSync(resolve(first, "defaults.json"), '{"version":"stale"}');
    const second = prepareNativePythonRuntime(source, workspace);
    assert.notEqual(first, second);
    assert.equal(
      readFileSync(resolve(second, "nested", "module.py"), "utf8"),
      "value = 1\n",
    );
    assert.equal(
      readFileSync(resolve(second, "defaults.json"), "utf8"),
      '{"version":"clean"}',
    );
    assert.equal(relative(workspace, second).startsWith(".."), false);
    assert.equal(
      prepareNativePythonRuntime(resolve(root, "missing"), workspace),
      "",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Python runtime copy rejects source links and workspace target junctions", () => {
  const root = mkdtempSync(resolve(process.cwd(), ".tmp-native-python-links-"));
  try {
    const source = resolve(root, "source"),
      workspace = resolve(root, "workspace"),
      outside = resolve(root, "outside");
    mkdirSync(source);
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(resolve(outside, "package.py"), "do not copy");
    symlinkSync(outside, resolve(source, "linked"), "junction");
    assert.throws(
      () => prepareNativePythonRuntime(source, workspace),
      /Links are forbidden/,
    );
    rmSync(resolve(source, "linked"), { recursive: true, force: true });
    mkdirSync(resolve(source, "package"));
    writeFileSync(resolve(source, "package", "module.py"), "value = 1");
    symlinkSync(outside, resolve(workspace, ".tool-runtime"), "junction");
    assert.throws(
      () => prepareNativePythonRuntime(source, workspace),
      /.tool-runtime must be/,
    );
    assert.equal(
      readFileSync(resolve(outside, "package.py"), "utf8"),
      "do not copy",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delayed fork and turn responses cannot replace or clear a newer native attempt", async () => {
  for (const phase of ["fork", "turn"] as const) {
    for (const outcome of ["success", "failure"] as const) {
      const f = fixture();
      const restoreStudio = mockNativeStudioTools();
      try {
        const t = prepareNativeRetry(f);
        let entered!: () => void;
        let resolveDelayed!: (value: any) => void;
        let rejectDelayed!: (error: Error) => void;
        const enteredPromise = new Promise<void>(
          (resolve) => (entered = resolve),
        );
        const delayed = new Promise<any>((resolve, reject) => {
          resolveDelayed = resolve;
          rejectDelayed = reject;
        });
        let waitTimer: NodeJS.Timeout;
        const boundedEntry = Promise.race([
          enteredPromise,
          new Promise<never>((_, reject) => {
            waitTimer = setTimeout(
              () => reject(new Error(`Timed out waiting for ${phase} RPC`)),
              15_000,
            );
          }),
        ]);
        f.codex.ready = true;
        f.codex.request = async (method, params) => {
          if (method === "thread/fork") {
            if (phase === "fork") {
              entered();
              return delayed;
            }
            return { thread: { id: "child-thread" } };
          }
          if (method === "turn/start" && phase === "turn") {
            entered();
            return delayed;
          }
          return {};
        };
        const running = f.engine.native.run(f.p, t);
        await boundedEntry;
        clearTimeout(waitTimer!);
        const newer = f.store.get<Task>("task", t.id)!;
        newer.attempt = 3;
        newer.threadId = "newer-thread";
        newer.turnId = null;
        newer.status = "running";
        newer.error = "newer attempt owns task";
        f.store.put("task", newer);
        const session = f.engine.native.session(f.p.id)!;
        f.store.put("nativeSession", {
          ...session,
          threadId: "newer-thread",
          status: "working",
        });
        f.engine.active.add(t.id);
        if (outcome === "success") {
          resolveDelayed(
            phase === "fork"
              ? { thread: { id: "late-child" } }
              : { turn: { id: "late-turn" } },
          );
        } else rejectDelayed(new Error("late RPC failure"));
        await running;
        const saved = f.store.get<Task>("task", t.id)!;
        assert.equal(saved.attempt, 3, `${phase}/${outcome}`);
        assert.equal(saved.threadId, "newer-thread", `${phase}/${outcome}`);
        assert.equal(
          saved.error,
          "newer attempt owns task",
          `${phase}/${outcome}`,
        );
        assert.equal(f.engine.native.session(f.p.id)?.threadId, "newer-thread");
        assert.equal(f.engine.active.has(t.id), true, `${phase}/${outcome}`);
      } finally {
        restoreStudio();
        f.close();
      }
    }
  }
});

test("enabled external review cannot be claimed complete using an older attempt or a self-report", async () => {
  const originalReview = ExternalReviewProvider.prototype.review;
  const originalVisualReview = NativeSpecialist.prototype.run;
  ExternalReviewProvider.prototype.review = async () => {
    throw new Error("HTTP 503 Service Unavailable");
  };
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("pass");
  } as any;
  const f = fixture();
  try {
    const t = prepareComplete(f);
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    // A completed review of an older attempt must not count for this one.
    f.store.put("nativeExternalReview", {
      id: "old",
      taskId: t.id,
      attempt: t.attempt - 1,
      status: "completed",
      result: { model: "selected-model" },
    });
    await f.engine.native.complete(t);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "blocked");
    assert.match(
      f.store.get<Task>("task", t.id)?.error || "",
      /Независимая проверка недоступна/,
    );
  } finally {
    ExternalReviewProvider.prototype.review = originalReview;
    NativeSpecialist.prototype.run = originalVisualReview;
    f.close();
  }
});

test("native completion does not retry a failed selected model and preserves other-model failures and selected-model success", async () => {
  const originalReview = ExternalReviewProvider.prototype.review;
  const originalVisualReview = NativeSpecialist.prototype.run;
  let providerCalls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    providerCalls++;
    return {
      id: "review",
      model: "selected-model",
      summary: "Reviewed current delivery",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    } as any;
  };
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("pass");
  } as any;
  try {
    for (const scenario of ["selected-failure", "legacy-ambiguous", "other-model-failure", "selected-success"] as const) {
      const f = fixture();
      try {
        const t = prepareComplete(f);
        f.store.put("setting", {
          id: "external-reviewer-config",
          enabled: true,
          model: "selected-model",
        });
        if (scenario === "selected-failure") {
          f.store.put("nativeExternalReview", {
            id: "selected-failed",
            taskId: t.id,
            attempt: t.attempt,
            model: "selected-model",
            status: "failed",
            error: "HTTP 503 Service Unavailable",
          });
        } else if (scenario === "legacy-ambiguous") {
          f.store.put("nativeExternalReview", {
            id: "legacy-prompt-file-hash",
            taskId: t.id,
            attempt: t.attempt,
            status: "failed",
            error: "Результат запроса неизвестен после HTTP 503",
          });
        } else if (scenario === "other-model-failure") {
          f.store.put("nativeExternalReview", {
            id: "other-failed",
            taskId: t.id,
            attempt: t.attempt,
            model: "other-model",
            status: "failed",
            error: "HTTP 503 Service Unavailable",
          });
        } else {
          f.store.put("nativeExternalReview", {
            id: "selected-completed",
            taskId: t.id,
            attempt: t.attempt,
            model: "selected-model",
            status: "completed",
            result: { model: "selected-model" },
          });
        }
        const callsBefore = providerCalls;
        await f.engine.native.complete(t);
        assert.equal(providerCalls - callsBefore, scenario === "other-model-failure" ? 1 : 0);
        if (scenario === "selected-failure" || scenario === "legacy-ambiguous") {
          assert.equal(f.store.get<Task>("task", t.id)?.status, "blocked");
          assert.match(f.store.get<Task>("task", t.id)?.error || "", /автоматический повтор отключён/);
        } else {
          assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
        }
      } finally {
        f.close();
      }
    }
  } finally {
    ExternalReviewProvider.prototype.review = originalReview;
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("an explicit task retry authorizes one new mandatory-review pipeline call after 503 recovery", async () => {
  const originalReview = ExternalReviewProvider.prototype.review;
  const originalVisualReview = NativeSpecialist.prototype.run;
  let providerCalls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    providerCalls++;
    if (providerCalls === 1) throw new Error("HTTP 503 Service Unavailable");
    return {
      id: "recovered-review",
      model: "selected-model",
      summary: "Review service recovered",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    } as any;
  };
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("pass");
  } as any;
  const f = fixture();
  try {
    const t = prepareComplete(f);
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    await f.engine.native.complete(t);
    assert.equal(providerCalls, 1);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "blocked");
    assert.match(f.store.get<Task>("task", t.id)?.error || "", /обязательное ревью моделью \[selected-model\]/);

    const retried = f.engine.retryTask(t.id);
    assert.equal(retried.status, "queued");
    const authorized = f.store
      .all<any>("nativeExternalReview")
      .find((review) => review.taskId === t.id && review.attempt === t.attempt);
    assert.equal(authorized?.status, "retry-authorized");

    const retriedTask = f.store.get<Task>("task", t.id)!;
    retriedTask.status = "running";
    f.store.put("task", retriedTask);
    assert.equal(retriedTask.attempt, t.attempt, "manual recovery reuses the blocked attempt and its saved evidence");
    await f.engine.native.complete(retriedTask);
    assert.equal(providerCalls, 2, `the explicit retry triggers exactly one recovered review call (${f.store.get<Task>("task", t.id)?.status}: ${f.store.get<Task>("task", t.id)?.error})`);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
    await f.engine.native.complete(retriedTask);
    assert.equal(providerCalls, 2, "duplicate completion does not spend another call");
  } finally {
    ExternalReviewProvider.prototype.review = originalReview;
    NativeSpecialist.prototype.run = originalVisualReview;
    f.close();
  }
});

test("explicit retry recognizes only one exact legacy deterministic 503 review record", () => {
  for (const models of [["selected-model"], ["selected-model", "other-model"]]) {
    const f = fixture();
    try {
      const t = f.engine.native.start(f.p);
      const suffix = "Внешний проверяющий вернул HTTP 503";
      t.status = "blocked";
      t.attempt = 1;
      t.maxAttempts = 3;
      t.error = "Независимая проверка недоступна: " + suffix;
      f.store.put("task", t);
      for (const model of models)
        f.store.put("nativeExternalReview", {
          id: `${t.id}:${t.attempt}:${model}`,
          taskId: t.id,
          attempt: t.attempt,
          status: "failed",
          error: suffix,
        });

      assert.equal(f.engine.retryTask(t.id).status, "queued");
      const records = f.store.all<any>("nativeExternalReview");
      assert.deepEqual(
        records.map((record) => record.status),
        models.length === 1
          ? ["retry-authorized"]
          : ["failed", "failed"],
      );
    } finally {
      f.close();
    }
  }
});

test("resuming a missing external review finalizes saved work without another owner turn or attempt", async () => {
  const f = fixture();
  try {
    const t = f.engine.native.start(f.p);
    t.attempt = 4;
    t.startedAt = "2020-01-01T00:00:00Z";
    t.error = "Независимая проверка недоступна: нет ответа";
    t.requirementsHash = f.engine.taskRequirementsHash(f.p, t);
    f.store.put("task", t);
    writeFileSync(
      resolve(f.engine.native.session(f.p.id)!.workspace, "delivery.json"),
      "{}",
    );
    let finalized = false;
    f.engine.native.complete = async () => {
      finalized = true;
    };
    f.codex.request = async () => {
      throw new Error("Owner must not run again");
    };
    await f.engine.native.run(f.p, t);
    assert.equal(finalized, true);
    assert.ok(Date.now() - Date.parse(t.startedAt!) < 5000);
    assert.equal(t.attempt, 4);
    assert.equal(f.engine.active.has(t.id), false);
  } finally {
    f.close();
  }
});

test("resuming unavailable visual review reuses saved evidence without an owner turn or new attempt", async () => {
  const f = fixture();
  const originalRun = NativeSpecialist.prototype.run;
  let reviewInput: any;
  NativeSpecialist.prototype.run = async function (raw: any) {
    reviewInput = raw;
    return visualAnswer("pass");
  } as any;
  try {
    const t = prepareComplete(f);
    t.status = "blocked";
    t.error = "Визуальная проверка недоступна: timeout";
    f.store.put("task", t);
    f.codex.request = async () => {
      throw new Error("Owner must not run again");
    };
    await f.engine.native.run(f.p, t);
    assert.equal(t.attempt, 1);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
    assert.equal(reviewInput?.files?.length, 0);
    assert.equal(f.engine.active.has(t.id), false);
    assert.equal(
      f.store.all<Command>("command").filter((c) => c.operation === "snapshot")
        .length,
      1,
    );
  } finally {
    NativeSpecialist.prototype.run = originalRun;
    f.close();
  }
});

test("visual findings enter the existing correction retry and never queue a snapshot", async () => {
  const f = fixture();
  const originalRun = NativeSpecialist.prototype.run;
  let calls = 0;
  NativeSpecialist.prototype.run = async function () {
    calls++;
    return visualAnswer("needs_changes", [
      {
        captureId: "hud-desktop",
        location: "upper path",
        issue: "Arrow points sideways",
        expected: "Arrow points toward the next waypoint",
      },
    ]);
  } as any;
  try {
    const t = prepareComplete(f);
    await f.engine.native.complete(t);
    const current = f.store.get<Task>("task", t.id)!;
    assert.equal(calls, 1);
    assert.equal(current.status, "queued");
    assert.match(
      current.error || "",
      /Результат не принят: визуальная проверка needs_changes/,
    );
    assert.match(current.error || "", /Arrow points sideways/);
    assert.equal(
      f.store.all<Command>("command").filter((c) => c.operation === "snapshot")
        .length,
      0,
    );
    assert.equal(
      f.store.get<any>("nativeVisualReview", `${t.id}:1`)?.status,
      "needs_changes",
    );
  } finally {
    NativeSpecialist.prototype.run = originalRun;
    f.close();
  }
});

test("only a passing current visual review queues one snapshot despite duplicate completion", async () => {
  const f = fixture();
  const originalRun = NativeSpecialist.prototype.run;
  let calls = 0;
  NativeSpecialist.prototype.run = async function () {
    calls++;
    return visualAnswer("pass");
  } as any;
  try {
    const t = prepareComplete(f);
    await f.engine.native.complete(t);
    await f.engine.native.complete(t);
    assert.equal(calls, 1);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
    assert.equal(
      f.store.all<Command>("command").filter((c) => c.operation === "snapshot")
        .length,
      1,
    );
    assert.equal(
      f.store.get<any>("nativeVisualReview", `${t.id}:1`)?.status,
      "pass",
    );
  } finally {
    NativeSpecialist.prototype.run = originalRun;
    f.close();
  }
});

test("a cancelled or newer attempt cannot finalize from a late visual response", async () => {
  const f = fixture();
  const originalRun = NativeSpecialist.prototype.run;
  let release!: (value: any) => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  NativeSpecialist.prototype.run = async function () {
    started();
    return new Promise((resolve) => (release = resolve));
  } as any;
  try {
    const t = prepareComplete(f);
    const completion = f.engine.native.complete(t);
    await pending;
    const updated = f.store.get<Task>("task", t.id)!;
    updated.attempt = 2;
    updated.status = "running";
    f.store.put("task", updated);
    release(visualAnswer("pass"));
    await completion;
    assert.equal(f.store.get<Task>("task", t.id)?.attempt, 2);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "running");
    assert.equal(
      f.store.all<Command>("command").filter((c) => c.operation === "snapshot")
        .length,
      0,
    );
    assert.equal(
      f.store.get<any>("nativeVisualReview", `${t.id}:1`),
      undefined,
    );
  } finally {
    NativeSpecialist.prototype.run = originalRun;
    f.close();
  }
});

test("frame byte replacement while review is pending requests corrected captures", async () => {
  const f = fixture();
  const originalRun = NativeSpecialist.prototype.run;
  let release!: (value: any) => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  NativeSpecialist.prototype.run = async function () {
    started();
    return new Promise((resolve) => (release = resolve));
  } as any;
  try {
    const t = prepareComplete(f);
    const completion = f.engine.native.complete(t);
    await pending;
    writeFileSync(
      resolve(f.engine.native.traceRoot(t), "actual.png"),
      "replaced frame",
    );
    release(visualAnswer("pass"));
    await completion;
    const current = f.store.get<Task>("task", t.id)!;
    assert.equal(current.status, "queued");
    assert.match(current.error || "", /Результат не принят/);
    assert.equal(
      f.store.all<Command>("command").filter((c) => c.operation === "snapshot")
        .length,
      0,
    );
  } finally {
    NativeSpecialist.prototype.run = originalRun;
    f.close();
  }
});

test("MCP numeric table properties preserve order and reject unrelated objects", () => {
  assert.deepEqual(
    nativePropertyList({ "2": { path: "b" }, "1": { path: "a" } }),
    [{ path: "a" }, { path: "b" }],
  );
  assert.deepEqual(nativePropertyList([]), []);
  assert.throws(() => nativePropertyList({ unexpected: true }), /формат/);
});

test("incremental work reuses accepted assets but still requires fresh desktop and mobile captures", () => {
  const previous = evidence();
  const current = previous.filter((r) => r.tool === "screen_capture");
  assert.equal(assertNativeEvidence(current, previous).length, 5);
  assert.throws(() => assertNativeEvidence([], previous), /снимки Studio/);
  assert.throws(() => assertNativeEvidence(current, []), /draw_icon/);
});

test("mesh material inspection reads bounded pages instead of a truncated Complex Table", async () => {
  let calls = 0;
  const items = Array.from({ length: 43 }, (_, i) => ({
    path: `Workspace/Mesh${i}`,
    properties: { MeshId: String(i) },
  }));
  const result = await readNativeAssetProperties(
    {
      tool: async (_name: string, args: any) => {
        const offset = calls++ * 20;
        assert.ok(
          args.code.includes(
            `for i=${offset + 1},math.min(${offset + 20},#out)`,
          ),
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                total: items.length,
                instances: Object.fromEntries(
                  items
                    .slice(offset, offset + 20)
                    .map((v, i) => [String(i + 1), v]),
                ),
              }),
            },
          ],
        };
      },
    } as any,
    "studio",
  );
  assert.equal(calls, 3);
  assert.deepEqual(result, items);
  await assert.rejects(
    readNativeAssetProperties(
      {
        tool: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({ total: 43, instances: "[Complex Table]" }),
            },
          ],
        }),
      } as any,
      "studio",
    ),
    /формат/,
  );
});

function planFixture(f: ReturnType<typeof fixture>, area: "ui" | "world") {
  fixtureAspects = ["geometry", "composition", "finish", "ui"];
  f.p.productionPlan = {
    architecture: [
      {
        id: "arch.plot-modules",
        decision: "Plots are assembled from layout data with stable slot IDs",
        reason: "Rebuilding moves equipment later",
        specRef: "§7.3",
      },
    ],
    milestones: [
      {
        id: "m1",
        title: "First milestone",
        goal: "Build the first verifiable milestone",
        items: [
          {
            id: "m1.route",
            requirement: "A readable route to the shop is visible",
            area,
            evidence: ["frame"],
            specRef: "§7.1",
          },
        ],
      },
      {
        id: "m2",
        title: "Second milestone",
        goal: "Build the second verifiable milestone",
        items: [
          {
            id: "m2.loop",
            requirement: "Selling an animal pays the order reward",
            area: "loop",
            evidence: ["play"],
            specRef: "§2",
          },
        ],
      },
    ],
  };
  for (const name of ["specification"])
    f.p.approvals[name] = {
      hash: f.engine.approvalHash(f.p, name),
      revision: 0,
      at: new Date().toISOString(),
    };
  f.engine.save(f.p);
  f.p = f.engine.project(f.p.id);
}

test("a planned milestone drives the owner task and narrows structural evidence", () => {
  const f = fixture();
  try {
    planFixture(f, "world");
    const t = f.engine.native.start(f.p);
    assert.equal(t.milestoneId, "m1");
    assert.match(t.title, /Этап 1/);
    assert.match(t.instructions, /m1\.route/);
    assert.match(t.instructions, /arch\.plot-modules/);
    assert.match(t.instructions, /check_delivery/);
    assert.deepEqual(f.engine.native.evidenceScope(f.p, t), {
      ui: false,
      art: false,
      layout: true,
    });
    t.status = "running";
    t.attempt = 1;
    f.store.put("task", t);
    const workspace = f.engine.native.session(f.p.id)!.workspace;
    writeFileSync(
      resolve(workspace, "delivery.json"),
      "﻿" +
        JSON.stringify({
          summary: "Layout blockout of the whole district",
          artDirection:
            "Bright simulator district with readable streets, plots and landmarks.",
          assets: [
            { name: "Plot", kind: "model", studioPath: "Workspace/Plot", source: "parts" },
            { name: "Fountain", kind: "model", studioPath: "Workspace/Fountain", source: "parts" },
          ],
          remainingIssues: [],
          frames: [{ item: "m1.route", captureIds: ["world-desktop"] }],
        }),
    );
    mkdirSync(f.engine.native.traceRoot(t), { recursive: true });
    writeFileSync(
      resolve(f.engine.native.traceRoot(t), "tools.jsonl"),
      evidence()
        .map((r) => ({ ...r, taskId: t.id, attempt: t.attempt }))
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    const inspected = f.engine.native.inspectDelivery(f.p, t);
    assert.ok(inspected.delivery, "BOM-prefixed delivery.json parses");
    assert.deepEqual(inspected.problems, [
      "Нужны настоящие снимки Studio: visual-layout",
    ]);
  } finally {
    f.close();
  }
});

test("milestone checklist gates the visual review and reviewer faults do not spend attempts", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  let answer: any;
  NativeSpecialist.prototype.run = async function () {
    return answer;
  } as any;
  try {
    // "extra": an answer about an item outside the list is ignored, not a fault.
    for (const scenario of ["missing", "extra", "incomplete"] as const) {
      const f = fixture();
      try {
        planFixture(f, "ui");
        const t = prepareComplete(f);
        assert.equal(t.milestoneId, "m1");
        answer =
          scenario !== "incomplete"
            ? visualAnswer("needs_changes", [
                {
                  captureId: "world-desktop",
                  location: "centre",
                  issue: "No route",
                  expected: "Route to the shop",
                },
              ], [
                {
                  itemId: "m1.route",
                  status: "missing",
                  captureId: "world-desktop",
                  note: "Route absent",
                },
                ...(scenario === "extra"
                  ? [{ itemId: "m1.testonly", status: "not_visible", captureId: "world-desktop", note: "Not a frame item" }]
                  : []),
              ])
            : visualAnswer("pass", [], []);
        await f.engine.native.complete(t);
        const after = f.store.get<Task>("task", t.id)!;
        assert.equal(after.status, "queued");
        if (scenario !== "incomplete") {
          assert.equal(after.attempt, 1);
          assert.match(after.error || "", /\[m1\.route\] не выполнен/);
        } else {
          assert.equal(after.attempt, 0, "reviewer fault refunds the attempt");
          assert.match(after.error || "", /не списана/);
        }
      } finally {
        f.close();
      }
    }
  } finally {
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("a low craft score rejects a milestone and owner notes become acceptance items", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  let seen: any;
  NativeSpecialist.prototype.run = async function (input: any, visual: any) {
    seen = { input, visual };
    return visualAnswer(
      "pass",
      [],
      [
        { itemId: "m1.route", status: "met", captureId: "world-desktop", note: "Route" },
        { itemId: "owner.1", status: "met", captureId: "world-desktop", note: "Junctions" },
      ],
      fixtureAspects.map((aspect) => ({
        aspect,
        score: aspect === "geometry" ? 2 : 5,
        captureId: "world-desktop",
        note: aspect === "geometry" ? "Streets overlap at corners" : "Fine",
      })),
    );
  } as any;
  try {
    const f = fixture();
    try {
      planFixture(f, "ui");
      const t = prepareComplete(f);
      const noted = f.store.get<Task>("task", t.id)!;
      noted.ownerNotes = ["Clean street junctions"];
      f.store.put("task", noted);
      const deliveryFile = resolve(f.engine.native.session(f.p.id)!.workspace, "delivery.json");
      const withOwner = JSON.parse(readFileSync(deliveryFile, "utf8"));
      withOwner.frames.push({ item: "owner.1", captureIds: ["world-desktop"] });
      writeFileSync(deliveryFile, JSON.stringify(withOwner));
      await f.engine.native.complete(f.store.get<Task>("task", t.id)!);
      assert.match(seen.visual.specification, /\[owner\.1\] Замечание владельца/);
      assert.match(seen.input.instruction, /geometry:/);
      const after = f.store.get<Task>("task", t.id)!;
      assert.equal(after.status, "queued");
      assert.equal(after.attempt, 1);
      assert.match(after.error || "", /качество geometry: 2\/5.*Streets overlap/);
    } finally {
      f.close();
    }
  } finally {
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("paid milestone review blocks only on concrete item verdicts and rejects off-contract answers", async () => {
  const originalReview = ExternalReviewProvider.prototype.review;
  const originalVisualReview = NativeSpecialist.prototype.run;
  let summary = "";
  ExternalReviewProvider.prototype.review = async () =>
    ({
      id: "review",
      model: "selected-model",
      summary,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    }) as any;
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("pass", [], [
      {
        itemId: "m1.route",
        status: "met",
        captureId: "world-desktop",
        note: "Route visible",
      },
    ]);
  } as any;
  const verdict = (v: string, route: string, arch: string) =>
    "```json\n" +
    JSON.stringify({
      verdict: v,
      items: [
        { itemId: "m1.route", status: route, evidence: "visual-review.json", note: "route" },
        { itemId: "arch.plot-modules", status: arch, evidence: "src/Plot.luau", note: "plots" },
      ],
    }) +
    "\n```";
  try {
    for (const scenario of ["reject", "garbage", "accept"] as const) {
      const f = fixture();
      try {
        planFixture(f, "ui");
        f.store.put("setting", {
          id: "external-reviewer-config",
          enabled: true,
          model: "selected-model",
        });
        const t = prepareComplete(f);
        summary =
          scenario === "reject"
            ? verdict("reject", "met", "contradicted")
            : scenario === "garbage"
              ? "Looks good overall."
              : verdict("accept", "met", "unverified");
        await f.engine.native.complete(t);
        const after = f.store.get<Task>("task", t.id)!;
        if (scenario === "reject") {
          assert.equal(after.status, "queued");
          assert.match(after.error || "", /\[arch\.plot-modules\] contradicted/);
        } else if (scenario === "garbage") {
          assert.equal(after.status, "queued");
          assert.equal(after.attempt, 0);
          assert.ok(
            f.store
              .all<any>("nativeExternalReview")
              .some((r) => r.taskId === t.id && r.status === "invalid"),
          );
        } else assert.equal(after.status, "verifying");
      } finally {
        f.close();
      }
    }
  } finally {
    ExternalReviewProvider.prototype.review = originalReview;
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("an accepted milestone checkpoint records progress once and starts the next milestone", () => {
  const f = fixture();
  try {
    planFixture(f, "world");
    const t = f.engine.native.start(f.p, "Clean junctions");
    f.store.put("nativeDelivery", {
      id: t.id,
      delivery: {
        summary: "Whole district layout blockout",
        artDirection:
          "Bright simulator district with readable streets, plots and landmarks.",
        assets: [],
        remainingIssues: [],
      },
      assetProperties: {},
      records: [],
    });
    const c: Command = {
      id: "milestone-snapshot",
      projectId: f.p.id,
      taskId: t.id,
      studioId: f.p.studioId!,
      baseRevision: 0,
      targetRevision: 0,
      operation: "snapshot",
      payload: { nativeCheckpoint: true },
      status: "succeeded",
      createdAt: new Date().toISOString(),
      sentAt: null,
      expectedFingerprint: "old",
      result: {
        fingerprint: "actual",
        instances: [
          { path: "Workspace/District", className: "Model", properties: {} },
        ],
      },
    };
    f.store.put("command", c);
    f.engine.native.checkpoint(c, t);
    const p = f.engine.project(f.p.id);
    assert.deepEqual(
      p.productionProgress?.completed.map((x) => x.milestoneId),
      ["m1"],
    );
    assert.equal(p.stage, "production");
    const next = f.engine
      .tasks(p.id)
      .find((x) => x.milestoneId === "m2");
    assert.ok(next, "next milestone task is created");
    assert.equal(next!.status, "queued");
    // The accepted items are named by their workspace file, not repeated in
    // the task text of every attempt.
    assert.match(next!.instructions, /Принятые пункты прошлых этапов[\s\S]*ACCEPTED\.md/);
    assert.doesNotMatch(next!.instructions, /m1\.route|Clean junctions/);
    const accepted = acceptedItemsText(p.productionPlan!, p.productionProgress);
    assert.match(accepted, /\[m1\.route\]/);
    assert.match(accepted, /\[owner\.m1\.1\][^\n]*Clean junctions/);
    assert.ok(
      f.engine.native
        .visualCriteria(p, next!)
        .priorFrameItems.some((i) => i.id === "owner.m1.1"),
    );
  } finally {
    f.close();
  }
});

function acceptFirstMilestone(f: ReturnType<typeof fixture>) {
  f.p.productionProgress = {
    completed: [
      {
        milestoneId: "m1",
        taskId: "accepted",
        at: new Date().toISOString(),
        ownerNotes: ["Clean junctions"],
      },
    ],
  };
  f.engine.save(f.p);
  f.p = f.engine.project(f.p.id);
}

// The first milestone gets an item only a test can prove, and the owner's
// switch that makes the workshop run the game's tests before acceptance.
function enableTestAcceptance(f: ReturnType<typeof fixture>) {
  f.p.productionPlan!.milestones[0]!.items.push({
    id: "m1.save",
    requirement: "Saved coins survive a rejoin",
    area: "systems",
    evidence: ["test"],
    specRef: "§11",
  });
  f.p.settings.testAcceptance = true;
  f.p.approvals.specification = {
    hash: f.engine.approvalHash(f.p, "specification"),
    revision: 0,
    at: new Date().toISOString(),
  };
  f.engine.save(f.p);
  f.p = f.engine.project(f.p.id);
}

test("check_delivery requires the test module text to cover every plan item proven by a test", () => {
  const f = fixture();
  try {
    planFixture(f, "ui");
    enableTestAcceptance(f);
    const t = prepareComplete(f);
    assert.match(t.instructions, /Приёмка тестами[\s\S]*Обязательные id: m1\.save/);
    const file = resolve(f.engine.native.session(f.p.id)!.workspace, "AutomationTests.luau");
    const problems = () => f.engine.native.inspectDelivery(f.p, t).problems.join("\n");
    assert.match(problems(), /AutomationTests\.luau: в рабочей папке нет текста модуля/);
    writeFileSync(file, 'return { run = function() return { checks = { { id = "m1.other" } } } end }');
    assert.match(problems(), /AutomationTests\.luau: нет проверки для пунктов m1\.save/);
    writeFileSync(file, 'return { run = function() return { checks = { { id = "m1.save" } } } end }');
    assert.doesNotMatch(problems(), /AutomationTests/);
  } finally {
    f.close();
  }
});

test("with test acceptance on, a milestone is accepted only after the workshop's own test run passes on the snapshot", () => {
  for (const scenario of ["pass", "fail", "late", "no-module"] as const) {
    const f = fixture();
    try {
      planFixture(f, "world");
      enableTestAcceptance(f);
      const t = f.engine.native.start(f.p);
      f.store.put("nativeDelivery", {
        id: t.id,
        delivery: {
          summary: "Whole district layout blockout",
          artDirection:
            "Bright simulator district with readable streets, plots and landmarks.",
          assets: [],
          remainingIssues: [],
        },
        assetProperties: {},
        records: [],
      });
      t.status = "verifying";
      t.attempt = 1;
      f.store.put("task", t);
      const snapshot: Command = {
        id: "milestone-snapshot",
        projectId: f.p.id,
        taskId: t.id,
        studioId: f.p.studioId!,
        baseRevision: 0,
        targetRevision: 0,
        operation: "snapshot",
        payload: { nativeCheckpoint: true },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        sentAt: null,
        expectedFingerprint: "old",
        result: {
          fingerprint: "scene-1",
          instances: [
            { path: "Workspace/District", className: "Model", properties: {} },
            ...(scenario === "no-module"
              ? []
              : [
                  {
                    path: "ServerStorage/AutomationTests",
                    className: "ModuleScript",
                    properties: {},
                    source: "return {}",
                  },
                ]),
          ],
        },
      };
      f.store.put("command", snapshot);
      const accepted = () =>
        f.engine.project(f.p.id).productionProgress?.completed.map((x) => x.milestoneId) ?? [];
      if (scenario === "no-module") {
        assert.throws(
          () => f.engine.native.checkpoint(snapshot, t),
          /в сцене нет модуля ServerStorage\/AutomationTests/,
        );
        assert.deepEqual(accepted(), []);
        continue;
      }
      f.engine.native.checkpoint(snapshot, t);
      // Not accepted yet: a test run is queued for exactly this scene.
      assert.deepEqual(accepted(), []);
      const run = f.store.all<Command>("command").find((c) => c.operation === "test")!;
      assert.deepEqual(run.payload.checks, ["m1.save"]);
      assert.equal(run.payload.players, 1);
      assert.equal(run.expectedFingerprint, "scene-1");
      assert.equal(f.store.get<Task>("task", t.id)!.status, "verifying");
      run.status = "sent";
      f.store.put("command", run);
      if (scenario === "late") {
        const moved = f.store.get<Task>("task", t.id)!;
        moved.attempt = 2;
        f.store.put("task", moved);
      }
      f.engine.commandResult(f.p.studioId!, run.id, {
        ok: true,
        projectId: f.p.id,
        baseRevision: run.baseRevision,
        checks: [
          {
            id: "m1.save",
            name: "Save",
            status: scenario === "fail" ? "failed" : "passed",
            evidence:
              scenario === "fail"
                ? "coins 0 after rejoin, expected 25"
                : "coins 25 after rejoin",
          },
        ],
        findings: [],
      });
      const after = f.store.get<Task>("task", t.id)!;
      if (scenario === "pass") {
        assert.deepEqual(accepted(), ["m1"]);
        assert.equal(after.status, "succeeded");
      } else if (scenario === "fail") {
        assert.deepEqual(accepted(), []);
        assert.equal(after.status, "queued");
        assert.equal(after.attempt, 1);
        assert.match(
          after.error || "",
          /тесты мастерской[\s\S]*\[m1\.save\] failed: coins 0 after rejoin, expected 25/,
        );
      } else {
        // A result of an attempt that is no longer current accepts nothing.
        assert.deepEqual(accepted(), []);
        assert.equal(after.status, "verifying");
        assert.ok(
          f.store.events(f.p.id).some((e: any) => e.type === "native.tests.ignored"),
        );
      }
    } finally {
      f.close();
    }
  }
});

test("a milestone run writes the accepted items to ACCEPTED.md", async () => {
  const f = fixture();
  const restoreStudio = mockNativeStudioTools();
  try {
    planFixture(f, "ui");
    acceptFirstMilestone(f);
    const t = prepareNativeRetry(f);
    assert.equal(t.milestoneId, "m2");
    f.codex.request = async (method) =>
      method === "thread/fork"
        ? { thread: { id: "child-thread" } }
        : method === "turn/start"
          ? { turn: { id: "child-turn" } }
          : {};
    await f.engine.native.run(f.p, t);
    const accepted = readFileSync(
      resolve(f.engine.native.session(f.p.id)!.workspace, "ACCEPTED.md"),
      "utf8",
    );
    assert.match(accepted, /\[m1\.route\][^\n]*A readable route to the shop/);
    assert.match(accepted, /\[owner\.m1\.1\][^\n]*Clean junctions/);
  } finally {
    restoreStudio();
    f.close();
  }
});

test("accepted items of earlier milestones need no answer and reject only when seen broken", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  let answer: any;
  NativeSpecialist.prototype.run = async function () {
    return answer;
  } as any;
  try {
    for (const scenario of ["silent", "broken"] as const) {
      const f = fixture();
      try {
        planFixture(f, "ui");
        acceptFirstMilestone(f);
        const t = prepareComplete(f);
        assert.equal(t.milestoneId, "m2");
        const criteria = f.engine.native.visualCriteria(f.p, t);
        assert.ok(criteria.priorFrameItems.some((i) => i.id === "m1.route"));
        const current = criteria.currentFrameItems.map((i) => ({
          itemId: i.id,
          status: "met",
          captureId: "world-desktop",
          note: "Shown",
        }));
        answer =
          scenario === "silent"
            ? visualAnswer("pass", [], current)
            : visualAnswer(
                "needs_changes",
                [{ captureId: "world-desktop", location: "centre", issue: "Route removed", expected: "Route to the shop" }],
                [...current, { itemId: "m1.route", status: "missing", captureId: "world-desktop", note: "Route removed" }],
              );
        await f.engine.native.complete(t);
        const after = f.store.get<Task>("task", t.id)!;
        if (scenario === "silent") assert.equal(after.status, "verifying");
        else {
          assert.equal(after.status, "queued");
          assert.equal(after.attempt, 1);
          assert.match(after.error || "", /\[m1\.route\] сломан \(регрессия принятого этапа\)/);
        }
      } finally {
        f.close();
      }
    }
  } finally {
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("a turn without any workshop tool call stops for the owner without spending the attempt", async () => {
  const f = fixture();
  try {
    planFixture(f, "ui");
    const t = prepareComplete(f);
    rmSync(resolve(f.engine.native.traceRoot(t), "tools.jsonl"), { force: true });
    await f.engine.native.complete(t);
    const after = f.store.get<Task>("task", t.id)!;
    assert.equal(after.status, "blocked");
    assert.equal(after.attempt, 0);
    assert.match(after.error || "", /Среда разработчика не работает/);
    assert.equal(f.engine.project(f.p.id).execution, "error");
  } finally {
    f.close();
  }
});

test("a hand-in failing check_delivery returns to the same attempt twice before it counts", async () => {
  const f = fixture();
  try {
    planFixture(f, "ui");
    const t = prepareComplete(f);
    writeFileSync(resolve(f.engine.native.session(f.p.id)!.workspace, "delivery.json"), "{}");
    const running = f.store.get<Task>("task", t.id)!;
    running.threadId = "thread-1";
    running.effortRun = { model: "gpt-6.1-sol", effort: "medium" } as any;
    f.store.put("task", running);
    const turns: any[] = [];
    f.codex.request = async (method: string, params: any) => {
      assert.equal(method, "turn/start");
      turns.push(params);
      return { turn: { id: "follow-" + turns.length } };
    };
    for (const n of [1, 2]) {
      await f.engine.native.complete(f.store.get<Task>("task", t.id)!);
      const after = f.store.get<Task>("task", t.id)!;
      assert.equal(after.status, "running");
      assert.equal(after.attempt, 1);
      assert.equal(after.turnId, "follow-" + n);
      assert.deepEqual(after.formalContinue, { attempt: 1, count: n });
    }
    assert.equal(turns[0].threadId, "thread-1");
    assert.match(turns[0].input[0].text, /check_delivery[\s\S]*delivery\.json не соответствует схеме/);
    await f.engine.native.complete(f.store.get<Task>("task", t.id)!);
    const failed = f.store.get<Task>("task", t.id)!;
    assert.equal(turns.length, 2);
    assert.notEqual(failed.status, "running");
    assert.match(failed.error || "", /Результат не принят/);
  } finally {
    f.close();
  }
});

test("a review that only lacks evidence returns to the same attempt twice before it counts", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("inconclusive", [], [
      { itemId: "m1.route", status: "not_visible", captureId: "world-desktop", note: "Route is outside every frame" },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "ui");
    const t = prepareComplete(f);
    const running = f.store.get<Task>("task", t.id)!;
    running.threadId = "thread-1";
    running.effortRun = { model: "gpt-6.1-sol", effort: "medium" } as any;
    running.timeWarnedAttempt = 1;
    f.store.put("task", running);
    const turns: any[] = [];
    f.codex.request = async (method: string, params: any) => {
      assert.equal(method, "turn/start");
      turns.push(params);
      return { turn: { id: "evidence-" + turns.length } };
    };
    for (const n of [1, 2]) {
      await f.engine.native.complete(f.store.get<Task>("task", t.id)!);
      const after = f.store.get<Task>("task", t.id)!;
      assert.equal(after.status, "running");
      assert.equal(after.attempt, 1);
      assert.equal(after.turnId, "evidence-" + n);
      assert.deepEqual(after.evidenceContinue, { attempt: 1, count: n });
      assert.equal(after.timeWarnedAttempt, undefined);
    }
    assert.match(turns[0].input[0].text, /не нашла дефектов[\s\S]*\[m1\.route\] Route is outside every frame/);
    await f.engine.native.complete(f.store.get<Task>("task", t.id)!);
    const failed = f.store.get<Task>("task", t.id)!;
    assert.equal(turns.length, 2);
    assert.equal(failed.status, "queued");
    assert.match(failed.error || "", /\[m1\.route\] не виден/);
  } finally {
    f.close();
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("an inconclusive review that names the missing angle as a finding returns to the same attempt", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("inconclusive", [
      { captureId: "world-desktop", location: "gate", issue: "Entry with a carried adult is not shown", expected: "Play frame at the gate" },
    ], [
      { itemId: "m1.route", status: "met", captureId: "world-desktop", note: "Route" },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "ui");
    const t = prepareComplete(f);
    const running = f.store.get<Task>("task", t.id)!;
    running.threadId = "thread-1";
    running.effortRun = { model: "gpt-6.1-sol", effort: "medium" } as any;
    f.store.put("task", running);
    const turns: any[] = [];
    f.codex.request = async (method: string, params: any) => {
      assert.equal(method, "turn/start");
      turns.push(params);
      return { turn: { id: "evidence-" + turns.length } };
    };
    await f.engine.native.complete(f.store.get<Task>("task", t.id)!);
    const after = f.store.get<Task>("task", t.id)!;
    assert.equal(after.status, "running");
    assert.equal(after.attempt, 1);
    assert.deepEqual(after.evidenceContinue, { attempt: 1, count: 1 });
    assert.match(turns[0].input[0].text, /world-desktop \(gate\): Entry with a carried adult is not shown; нужный кадр: Play frame at the gate/);
  } finally {
    f.close();
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("a milestone out of attempts on review findings continues in a new task, twice at most", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("needs_changes", [
      { captureId: "world-desktop", location: "centre", issue: "No route", expected: "Route to the shop" },
    ], [
      { itemId: "m1.route", status: "missing", captureId: "world-desktop", note: "Route absent" },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "ui");
    let t = prepareComplete(f);
    const noted = f.store.get<Task>("task", t.id)!;
    noted.ownerNotes = ["Clean street junctions"];
    f.store.put("task", noted);
    const deliveryFile = resolve(f.engine.native.session(f.p.id)!.workspace, "delivery.json");
    const withOwner = JSON.parse(readFileSync(deliveryFile, "utf8"));
    withOwner.frames.push({ item: "owner.1", captureIds: ["world-desktop"] });
    writeFileSync(deliveryFile, JSON.stringify(withOwner));
    NativeSpecialist.prototype.run = async function () {
      return visualAnswer("needs_changes", [
        { captureId: "world-desktop", location: "centre", issue: "No route", expected: "Route to the shop" },
      ], [
        { itemId: "m1.route", status: "missing", captureId: "world-desktop", note: "Route absent" },
        { itemId: "owner.1", status: "met", captureId: "world-desktop", note: "Junctions" },
      ]);
    } as any;
    // The real path: the last attempt is rejected by the visual review.
    const last = f.store.get<Task>("task", t.id)!;
    last.maxAttempts = 1;
    f.store.put("task", last);
    await f.engine.native.complete(last);
    assert.equal(f.store.get<Task>("task", t.id)!.status, "failed");
    let next = f.engine.tasks(f.p.id).find((x) => x.status === "queued")!;
    assert.ok(next, "a new milestone task is queued");
    assert.equal(next.milestoneId, "m1");
    assert.equal(next.autoContinued, 1);
    assert.deepEqual(next.ownerNotes, ["Clean street junctions"]);
    assert.match(next.error || "", /\[m1\.route\] не выполнен/);
    assert.equal(f.engine.project(f.p.id).execution, "running");
    // The bound: one more continuation, then the owner decides.
    const exhaust = (task: Task) => {
      task.status = "failed";
      task.rejection = task.error = "Результат не принят: still no route";
      f.store.put("task", task);
      f.engine.native.continueMilestone(task);
      return f.engine.tasks(f.p.id).find((x) => x.status === "queued");
    };
    t = next;
    next = exhaust(t)!;
    assert.equal(next.autoContinued, 2);
    assert.equal(exhaust(next), undefined);
    // An external stop is not a reason to continue.
    next.autoContinued = 0;
    next.error = "Подключите совместимую Studio с подтверждённым документом";
    f.store.put("task", next);
    f.engine.native.continueMilestone(next);
    assert.equal(f.engine.tasks(f.p.id).filter((x) => x.status === "queued").length, 0);
  } finally {
    f.close();
    NativeSpecialist.prototype.run = originalVisualReview;
  }
});

test("the last milestone always carries the release-clean acceptance note, once", () => {
  const f = fixture();
  try {
    planFixture(f, "world");
    const first = f.engine.native.start(f.p);
    assert.equal(first.ownerNotes, undefined, "not the last milestone");
    first.status = "succeeded";
    f.store.put("task", first);
    f.p.productionProgress = {
      completed: [{ milestoneId: "m1", taskId: first.id, at: new Date().toISOString() }],
    };
    f.engine.save(f.p);
    const last = f.engine.native.start(f.p);
    assert.equal(last.milestoneId, "m2");
    assert.deepEqual(last.ownerNotes, [RELEASE_CLEAN_NOTE]);
    last.status = "failed";
    f.store.put("task", last);
    const again = f.engine.native.start(f.p, "Bigger sign");
    assert.deepEqual(again.ownerNotes, [RELEASE_CLEAN_NOTE, "Bigger sign"]);
  } finally {
    f.close();
  }
});

test("a milestone retried in a new task keeps the owner's earlier notes", () => {
  const f = fixture();
  try {
    planFixture(f, "world");
    const first = f.engine.native.start(f.p, "Clean junctions");
    first.status = "failed";
    first.error = "Результат не принят: arrows point away";
    f.store.put("task", first);
    const second = f.engine.native.start(f.p, "Timers above tubes");
    assert.notEqual(second.id, first.id);
    assert.deepEqual(second.ownerNotes, ["Clean junctions", "Timers above tubes"]);
    assert.match(second.instructions, /\[owner\.1\][^\n]*Clean junctions/);
    assert.match(second.instructions, /\[owner\.2\][^\n]*Timers above tubes/);
    assert.equal(second.error, first.error);
    second.status = "failed";
    f.store.put("task", second);
    const third = f.engine.native.start(f.p, "Show measured FPS on screen", false);
    assert.deepEqual(third.ownerNotes, ["Clean junctions", "Timers above tubes"]);
    assert.match(third.instructions, /не пункт приёмки\): Show measured FPS/);
  } finally {
    f.close();
  }
});

test("production without a plan first derives one and validates its contract", () => {
  const f = fixture();
  try {
    f.engine.startPhase(f.p.id, "production");
    const task = f.engine
      .tasks(f.p.id)
      .find((x) => x.kind === "production-plan");
    assert.ok(task, "a production-plan task is created instead of the owner task");
    assert.equal(
      f.engine.tasks(f.p.id).some((x) => x.kind === NATIVE_KIND),
      false,
    );
    const manifest = (productionPlan: unknown) => ({
      summary: "Production plan derived from the approved specification",
      files: [],
      instances: [],
      checks: [],
      findings: [],
      data: { productionPlan },
    });
    assert.throws(() =>
      f.engine.prepareResult(task!, manifest({ milestones: [] }) as any),
    );
    const plan = {
      architecture: [],
      milestones: [
        {
          id: "m1",
          title: "Layout",
          goal: "Whole district layout blockout",
          items: [
            {
              id: "m1.loop",
              requirement: "Three streets form a loop",
              area: "world",
              evidence: ["frame"],
              specRef: "§7.1",
            },
          ],
        },
      ],
    };
    assert.deepEqual(
      f.engine.prepareResult(task!, manifest(plan) as any).data.productionPlan,
      plan,
    );
  } finally {
    f.close();
  }
});

test("a world-layout milestone is reviewed on its own required frames and reaches the snapshot", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  let frames: string[] = [];
  NativeSpecialist.prototype.run = async function (_input: any, visual: any) {
    frames = visual.frames.map((frame: any) => frame.captureId);
    return visualAnswer("pass", [], [
      {
        itemId: "m1.route",
        status: "met",
        captureId: "visual-layout",
        note: "Route visible from above",
      },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "world");
    const t = prepareComplete(f);
    appendFileSync(
      resolve(f.engine.native.traceRoot(t), "tools.jsonl"),
      "\n" +
        JSON.stringify({
          tool: "screen_capture",
          success: true,
          taskId: t.id,
          attempt: t.attempt,
          captureRecordId: "0000000000000000000000aa",
          arguments: { capture_id: "visual-layout" },
          captures: ["actual.png"],
          viewport: { device: "default" },
        }),
    );
    await f.engine.native.complete(t);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
    assert.deepEqual(frames.slice(0, 2), ["world-desktop", "visual-layout"]);
  } finally {
    NativeSpecialist.prototype.run = originalVisualReview;
    f.close();
  }
});

test("the developer's own in-turn review never stands in for milestone acceptance", async () => {
  const originalReview = ExternalReviewProvider.prototype.review;
  const originalVisualReview = NativeSpecialist.prototype.run;
  let calls = 0;
  ExternalReviewProvider.prototype.review = async () => {
    calls++;
    return {
      id: "acceptance",
      model: "selected-model",
      summary: JSON.stringify({
        verdict: "accept",
        items: [
          { itemId: "m1.route", status: "met", evidence: "visual-review.json", note: "ok" },
          { itemId: "arch.plot-modules", status: "met", evidence: "src/Plot.luau", note: "ok" },
        ],
      }),
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    } as any;
  };
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("pass", [], [
      { itemId: "m1.route", status: "met", captureId: "world-desktop", note: "ok" },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "ui");
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    const t = prepareComplete(f);
    f.store.put("nativeExternalReview", {
      id: "developer-in-turn-hash",
      taskId: t.id,
      attempt: t.attempt,
      model: "selected-model",
      status: "completed",
      result: { model: "selected-model", summary: "Free-form notes from the developer's own review." },
    });
    await f.engine.native.complete(t);
    assert.equal(calls, 1);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
  } finally {
    ExternalReviewProvider.prototype.review = originalReview;
    NativeSpecialist.prototype.run = originalVisualReview;
    f.close();
  }
});

test("an architecture decision whose subsystem is not built yet does not block a milestone", async () => {
  const originalReview = ExternalReviewProvider.prototype.review;
  const originalVisualReview = NativeSpecialist.prototype.run;
  ExternalReviewProvider.prototype.review = async () =>
    ({
      id: "acceptance",
      model: "selected-model",
      summary: JSON.stringify({
        verdict: "reject",
        items: [
          { itemId: "m1.route", status: "met", evidence: "visual-review.json", note: "ok" },
          { itemId: "arch.plot-modules", status: "missing", evidence: "delivery.json", note: "not built yet" },
        ],
      }),
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      contextWindow: 10000,
    }) as any;
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("pass", [], [
      { itemId: "m1.route", status: "met", captureId: "world-desktop", note: "ok" },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "ui");
    f.store.put("setting", {
      id: "external-reviewer-config",
      enabled: true,
      model: "selected-model",
    });
    const t = prepareComplete(f);
    await f.engine.native.complete(t);
    assert.equal(f.store.get<Task>("task", t.id)?.status, "verifying");
  } finally {
    ExternalReviewProvider.prototype.review = originalReview;
    NativeSpecialist.prototype.run = originalVisualReview;
    f.close();
  }
});

test("the in-turn visual preview advises without changing the task and is bounded per attempt", async () => {
  const originalVisualReview = NativeSpecialist.prototype.run;
  NativeSpecialist.prototype.run = async function () {
    return visualAnswer("inconclusive", [
      {
        captureId: "world-desktop",
        location: "resin bend",
        issue: "Forks hidden by crowns",
        expected: "Side view of both trunks",
      },
    ], [
      { itemId: "m1.route", status: "not_visible", captureId: "", note: "need angle" },
    ]);
  } as any;
  const f = fixture();
  try {
    planFixture(f, "ui");
    const t = prepareComplete(f);
    for (let i = 0; i < 3; i++) {
      const preview = await f.engine.native.previewVisualReview(f.p, t);
      assert.equal(preview.visualReview.verdict, "inconclusive");
      assert.equal(preview.remaining, 2 - i);
    }
    await assert.rejects(
      f.engine.native.previewVisualReview(f.p, t),
      /Лимит предварительных/,
    );
    const after = f.store.get<Task>("task", t.id)!;
    assert.equal(after.status, "running");
    assert.equal(after.attempt, t.attempt);
  } finally {
    NativeSpecialist.prototype.run = originalVisualReview;
    f.close();
  }
});

test("instance paths accept the names a real scene uses and reject only separators, control characters and foreign roots", () => {
  const parses = (path: string) =>
    snapshotManifestSchema.safeParse({
      summary: "snapshot",
      instances: [{ path, className: "Part", properties: {} }],
    }).success;
  // The name that rejected an accepted tenth milestone.
  assert.equal(parses("Workspace/GeneWorks/ExhibitionHall/Bench-1:12"), true);
  assert.equal(parses("StarterGui/HUD/Buy? (x2) [50%] «Клевер»"), true);
  assert.equal(parses("Workspace/Bad\\Path"), false);
  assert.equal(parses("Workspace/Tab\tName"), false);
  assert.equal(parses("Players/Someone"), false);
  assert.equal(
    snapshotManifestSchema.safeParse({
      summary: "snapshot",
      instances: [
        {
          path: "Workspace/GeneWorks/PublicDistrict/Potters' Row",
          className: "Part",
          properties: {},
        },
        {
          path: "ServerStorage/Glimfin swimmer rig source, friendly lagoon animal/tail",
          className: "Model",
          properties: {},
        },
      ],
    }).success,
    true,
  );
});

test("a multiplayer Studio test is limited to three clients written as a number", () => {
  const call = (players: string) =>
    `task.spawn(function() return game:GetService('StudioTestService'):ExecuteMultiplayerTestAsync(${players},{test='m11-load'}) end)`;
  // The six-client load run that opened seven Studio windows each time.
  assert.match(multiplayerTestProblem(call("6")) || "", /не больше чем на 3 клиента/);
  assert.match(multiplayerTestProblem(call("clients")) || "", /числом прямо в вызове/);
  assert.equal(multiplayerTestProblem(call("3")), null);
  assert.equal(multiplayerTestProblem(call(" 2 ")), null);
  assert.equal(multiplayerTestProblem("return workspace:GetChildren()"), null);
});

test("check_delivery requires a frame of this attempt for every frame item", () => {
  const shot = (id: string, attempt = 2) => ({
    tool: "screen_capture",
    success: true,
    taskId: "t",
    attempt,
    arguments: { capture_id: id },
    captures: [id + ".png"],
  });
  const records = [shot("visual-plaza"), shot("visual-old", 1), shot("world-desktop")];
  const required = ["world-desktop", "visual-layout"];
  assert.deepEqual(nativeFrameMapProblems(undefined, [], records, 2, "t", required), []);
  const problems = nativeFrameMapProblems(
    [
      { item: "world.plaza", captureIds: ["visual-plaza", "world-desktop"] },
      { item: "owner.1", captureIds: ["visual-old"] },
      { item: "world.typo", captureIds: ["shot-1"] },
    ],
    ["world.plaza", "owner.1", "early.rig"],
    records,
    2,
    "t",
    required,
  ).join("\n");
  assert.match(problems, /для пунктов early\.rig/);
  // An item outside the lists is not judged and no longer blocks the hand-in.
  assert.doesNotMatch(problems, /неизвестные пункты|world\.typo/);
  assert.match(problems, /visual-\/closeup-: shot-1/);
  assert.match(problems, /нет кадров текущей попытки visual-old/);
  assert.doesNotMatch(problems, /visual-plaza|world.plaza/);
  // Items accepted on earlier milestones may be mapped but need no frames.
  assert.deepEqual(
    nativeFrameMapProblems(
      [
        { item: "world.plaza", captureIds: ["visual-plaza"] },
        { item: "early.sign", captureIds: ["world-desktop"] },
      ],
      ["world.plaza"],
      records,
      2,
      "t",
      required,
      ["early.rig", "early.sign"],
    ),
    [],
  );
  // One item must fit one reviewer pass; all items must fit MAX_REVIEW_PASSES.
  const many = Array.from({ length: 240 }, (_, i) => "visual-" + i);
  const shots = many.map((id) => shot(id));
  const check = (frames: Array<{ item: string; captureIds: string[] }>) =>
    nativeFrameMapProblems(frames, frames.map((x) => x.item), shots, 2, "t", required).join();
  assert.match(
    check([{ item: "a", captureIds: many.slice(0, MAX_VISUAL_FRAMES - 1) }]),
    new RegExp(`пункт a: ${MAX_VISUAL_FRAMES - 1} целевых кадров, один проход проверки получает не больше ${MAX_VISUAL_FRAMES - 2}`),
  );
  const quarters = [0, 1, 2, 3].map((q) => ({ item: "q" + q, captureIds: many.slice(q * 60, q * 60 + 60) }));
  assert.equal(check(quarters.slice(0, 3)), "");
  assert.match(check(quarters), /требуют 4 проходов проверки по 94 целевых, максимум 3/);
});

test("planVisualBatches keeps items whole, shares required views and fills passes in plan order", () => {
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `visual-${p}${i}`);
  const batches = planVisualBatches(
    [
      { item: "a", captureIds: [...ids(50, "a"), "world-desktop"] },
      { item: "none", captureIds: [] },
      { item: "b", captureIds: ids(50, "b") },
      { item: "c", captureIds: [...ids(40, "b").slice(0, 10), ...ids(30, "c")] },
    ],
    ["world-desktop", "hud-mobile"],
    (id) => (id === "hud-mobile" ? 2 : 1),
  );
  // Capacity 96 - 3 = 93: a (50) + b (50) do not fit; c reuses b's frames.
  assert.deepEqual(batches.map((b) => b.items), [["a", "none"], ["b", "c"]]);
  assert.deepEqual(batches.map((b) => b.images), [50, 80]);
});

test("a review larger than one call runs passes of whole items and merges them", async () => {
  const f = fixture();
  const dir = mkdtempSync(resolve(tmpdir(), "native-passes-"));
  try {
    const native = f.engine.native as any;
    const required = ["world-desktop"];
    const a = Array.from({ length: 70 }, (_, i) => "visual-a" + i);
    const b = Array.from({ length: 70 }, (_, i) => "visual-b" + i);
    const frames = [...required, ...a, ...b].map((captureId) => {
      const path = resolve(dir, captureId + ".jpg");
      writeFileSync(path, "x");
      return { captureId, path } as any;
    });
    native.evidenceScope = () => ({ ui: false, layout: false });
    native.milestone = () => ({ id: "m" });
    native.visualCriteria = (_p: any, _t: any, only?: Set<string>) => ({
      currentFrameItems: [{ id: "a" }, { id: "b" }],
      priorFrameItems: [{ id: "old" }],
      criteria: [...(only || [])].join(","),
    });
    native.deliveryFrames = () => [
      { item: "a", captureIds: a },
      { item: "b", captureIds: b },
    ];
    const calls: any[] = [];
    native.runVisualPass = async (_p: any, _t: any, _w: any, _r: any, part: any[], _tool: any, pass: any) => {
      calls.push({ frames: part.map((x) => x.captureId), items: [...pass.items], pass: pass.index });
      const item = [...pass.items][0];
      return {
        visualReview: {
          verdict: item === "a" ? "pass" : "inconclusive",
          summary: "s" + item,
          findings: [],
          checklist: [
            { itemId: item, status: "met", captureId: part[1].captureId, note: "" },
            { itemId: "old", status: item === "a" ? "not_visible" : "missing", captureId: "", note: "" },
          ],
          quality: ["geometry", "composition", "finish", "ui"].map((aspect) => ({ aspect, score: item === "a" ? 5 : aspect === "ui" ? 3 : 4, captureId: part[1].captureId, note: item })),
        },
      };
    };
    const { qualityAspectsForTest } = { qualityAspectsForTest: null };
    void qualityAspectsForTest;
    const result = await native.runVisualReviewer(f.p, {}, dir, dir, frames, "native_visual_review");
    // The accepted item without frames of its own is checked by every pass.
    assert.deepEqual(calls.map((c) => c.items), [["a", "old"], ["b", "old"]]);
    assert.equal(calls[0].frames.length, 71);
    assert.ok(calls[1].frames.includes("world-desktop") && !calls[1].frames.includes("visual-a0"));
    assert.equal(result.visualReview.verdict, "inconclusive");
    assert.deepEqual(
      result.visualReview.checklist.map((c: any) => [c.itemId, c.status]),
      [["a", "met"], ["old", "missing"], ["b", "met"]],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    f.close();
  }
});

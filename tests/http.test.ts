import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import { DEFAULT_SKILL_IDS } from "../server/default-skills.js";
test("HTTP: authenticated project workflow, origin restrictions and scoped plugin pairing", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-http-")),
    outside = mkdtempSync(resolve(tmpdir(), "automation-delete-outside-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  const port = 48271;
  const server = createApp(store, engine, "test-user-token", {
    port,
    appRoot: resolve("."),
  }).listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    Authorization: "Bearer test-user-token",
    "Content-Type": "application/json",
  };
  const call = async (
    path: string,
    body?: unknown,
    h: Record<string, string> = headers,
    method?: string,
  ) => {
    const r = await fetch(base + path, {
      method: method || (body ? "POST" : "GET"),
      headers: h,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await call("/api/state", undefined, {} as any)).status, 401);
    const disposable = await call("/api/projects", {
      name: "Deletion fixture",
      genre: "Simulator",
      goal: "Exercise deletion guards",
    });
    const preserved = await call("/api/projects", {
      name: "Preserved fixture",
      genre: "Simulator",
      goal: "Remain isolated",
    });
    const disposableId = disposable.data.id;
    store.file(`projects/${disposableId}/keep.txt`, "retained local file");
    store.file(
      `projects/${preserved.data.id}/keep.txt`,
      "neighbor project file",
    );
    const active = engine.task(engine.project(disposableId), {
      title: "Active task",
      role: "ui",
      kind: "ui",
      instructions: "Guard fixture",
      status: "running",
    });
    const deleteUrl = `/api/projects/${disposableId}`;
    assert.equal(
      (
        await call(
          deleteUrl,
          { confirmation: "Deletion fixture" },
          {},
          "DELETE",
        )
      ).status,
      401,
    );
    assert.equal(
      (await call(deleteUrl, { confirmation: "wrong" }, headers, "DELETE"))
        .status,
      400,
    );
    assert.ok(store.get("project", disposableId));
    assert.equal(
      (
        await call(
          deleteUrl,
          { confirmation: "Deletion fixture" },
          headers,
          "DELETE",
        )
      ).status,
      409,
    );
    assert.ok(store.get("project", disposableId));
    active.status = "cancelled";
    store.put("task", active);
    store.put("ledger", {
      id: "retained-ledger",
      projectId: disposableId,
      taskId: active.id,
    });
    store.put("providerOperation", {
      id: "retained-provider-op",
      projectId: disposableId,
      taskId: active.id,
    });
    store.put("studio", { id: "delete-studio", projectId: disposableId });
    store.event(disposableId, "deletion.fixture", {});
    const deleted = await call(
      deleteUrl,
      { confirmation: "Deletion fixture", deleteFiles: false },
      headers,
      "DELETE",
    );
    assert.deepEqual(deleted.data, { ok: true });
    assert.equal(store.get("project", disposableId), undefined);
    assert.equal(store.get("task", active.id), undefined);
    assert.equal(
      store.get<{ projectId: string | null }>("studio", "delete-studio")
        ?.projectId,
      null,
    );
    assert.ok(store.get("ledger", "retained-ledger"));
    assert.ok(store.get("providerOperation", "retained-provider-op"));
    assert.equal(store.events(disposableId).length, 0);
    assert.equal(
      store.read(`projects/${disposableId}/keep.txt`),
      "retained local file",
    );
    assert.ok(store.get("project", preserved.data.id));
    assert.equal(
      store.read(`projects/${preserved.data.id}/keep.txt`),
      "neighbor project file",
    );
    assert.deepEqual(
      (await call(deleteUrl, { confirmation: "anything" }, headers, "DELETE"))
        .data,
      { ok: true },
    );
    const fileFixture = await call("/api/projects", {
      name: "File deletion fixture",
      genre: "Simulator",
      goal: "Exercise safe cleanup",
    });
    const fileProjectId = fileFixture.data.id;
    const fileTask = engine.task(engine.project(fileProjectId), {
      title: "Planned file task",
      role: "ui",
      kind: "ui",
      instructions: "File fixture",
      status: "planned",
    });
    const projectMarker = `projects/${fileProjectId}/local.txt`;
    const taskMarker = `tasks/${fileTask.id}/result.txt`;
    const imagePath = `feedbackImages/${fileTask.id}.png`;
    const sharedImagePath =
      "feedbackImages/00000000-0000-4000-8000-000000000001.png";
    store.file(projectMarker, "project data");
    store.file(taskMarker, "task output");
    store.file(imagePath, "image bytes");
    store.file(sharedImagePath, "shared image");
    store.put("feedback", {
      id: "file-feedback",
      projectId: fileProjectId,
      attachments: [{ file: imagePath }, { file: sharedImagePath }],
    });
    store.put("feedback", {
      id: "shared-feedback",
      projectId: preserved.data.id,
      attachments: [{ file: sharedImagePath }],
    });
    const outsideMarker = resolve(outside, "keep.txt");
    writeFileSync(outsideMarker, "outside data");
    const linkPath = resolve(root, `providers/${fileTask.id}`);
    mkdirSync(resolve(root, "providers"), { recursive: true });
    try {
      symlinkSync(outside, linkPath, "junction");
    } catch {
      // Windows may disable junction creation; the checked removal case still runs below.
    }
    const rejectedCleanup = await call(
      `/api/projects/${fileProjectId}`,
      { confirmation: "File deletion fixture", deleteFiles: true },
      headers,
      "DELETE",
    );
    if (existsSync(linkPath)) {
      assert.equal(rejectedCleanup.status, 400);
      assert.ok(store.get("project", fileProjectId));
      assert.equal(store.read(projectMarker), "project data");
      assert.equal(readFileSync(outsideMarker, "utf8"), "outside data");
      rmSync(linkPath);
    }
    const removedFiles = await call(
      `/api/projects/${fileProjectId}`,
      { confirmation: "File deletion fixture", deleteFiles: true },
      headers,
      "DELETE",
    );
    assert.deepEqual(removedFiles.data, { ok: true });
    assert.equal(existsSync(resolve(root, projectMarker)), false);
    assert.equal(existsSync(resolve(root, taskMarker)), false);
    assert.equal(existsSync(resolve(root, imagePath)), false);
    assert.equal(existsSync(resolve(root, sharedImagePath)), true);
    assert.equal(
      store.read(`projects/${preserved.data.id}/keep.txt`),
      "neighbor project file",
    );
    assert.equal(readFileSync(outsideMarker, "utf8"), "outside data");
    assert.equal(
      (
        await call("/api/state", undefined, {
          ...headers,
          Origin: "https://attacker.test",
        })
      ).status,
      403,
    );
    const p = await call("/api/projects", {
      name: "HTTP fixture",
      genre: "Simulator",
      goal: "Test local workflow",
    });
    assert.equal(p.status, 200);
    const detail = (await call("/api/projects/" + p.data.id)).data;
    assert.equal(detail.project.name, "HTTP fixture");
    assert.equal(detail.project.settings.agentPolicy, "sol-luna-astra-v1");
    const authoredSpec =
      "# Moon Garden\n\nPlayers grow a moonlit garden together.\n\n## Loop\nPlant, harvest, trade.";
    const authored = await call("/api/projects", {
      name: "Authored fixture",
      specification: authoredSpec,
    });
    assert.equal(authored.status, 200);
    const authoredProject = engine.project(authored.data.id);
    assert.equal(authoredProject.specification, authoredSpec);
    assert.equal(
      authoredProject.concept,
      "Players grow a moonlit garden together.",
    );
    assert.equal(authoredProject.stage, "concept");
    assert.deepEqual(authoredProject.approvals, {});
    assert.equal(
      (
        await call("/api/projects", {
          name: "Whitespace spec",
          specification: "  \n  ",
        })
      ).status,
      400,
    );
    // This section verifies the retained manual legacy effort controls.
    const legacyProject = engine.project(p.data.id);
    legacyProject.settings.agentPolicy = "legacy";
    engine.save(legacyProject);
    const effortTask = engine.task(engine.project(p.data.id), {
      title: "One label",
      role: "ui",
      kind: "ui",
      instructions: "Replace one label",
    });
    const effortBody = {
      complexity: "routine",
      override: "low",
      reason: "Only replace one label",
    };
    assert.equal(
      (await call("/api/tasks/" + effortTask.id + "/effort", effortBody, {}))
        .status,
      401,
    );
    assert.equal(
      (await call("/api/tasks/" + effortTask.id + "/effort", effortBody)).data
        .effortOverride,
      "low",
    );
    assert.equal(
      (
        await call("/api/tasks/" + effortTask.id + "/effort", {
          ...effortBody,
          override: "max",
        })
      ).status,
      409,
    );
    engine.store.delete("task", effortTask.id);

    assert.equal(detail.development.gameLanguage.sourceLocaleId, "en-us");
    assert.equal(
      detail.development.skills.filter((s: any) => s.status === "ready").length,
      DEFAULT_SKILL_IDS.length,
    );
    assert.equal(detail.development.localization.status, "not_built");
    assert.equal(detail.development.localization.required, true);
    assert.equal(
      (
        await call("/api/projects/" + p.data.id + "/phase", {
          phase: "production",
        })
      ).status,
      409,
    );
    const code = await call("/api/pairing", {});
    const paired = await call("/bridge/pair", {
      code: code.data.code,
      studioId: "http-studio",
      name: "Empty test studio",
      placeId: "0",
      universeId: "0",
      fingerprint: "base",
      capabilities: ["snapshot", "apply", "test"],
    });
    assert.equal(paired.status, 200);
    assert.equal(
      (
        await call("/bridge/pair", {
          code: code.data.code,
          studioId: "http-studio",
          name: "Empty",
          placeId: "0",
          universeId: "0",
          fingerprint: "base",
          capabilities: [],
        })
      ).status,
      401,
    );
    const bridgeHeaders = {
      Authorization: "Bearer " + paired.data.token,
      "Content-Type": "application/json",
      "x-studio-id": "http-studio",
    };
    assert.equal(
      (await call("/api/state", undefined, bridgeHeaders)).status,
      401,
    );
    assert.equal(
      (
        await call("/api/projects/" + p.data.id + "/studio", {
          studioId: "http-studio",
        })
      ).status,
      200,
    );
    const playing = await call(
      "/bridge/poll",
      { playing: true },
      bridgeHeaders,
    );
    assert.equal(playing.data.command, null);
    assert.equal(store.get<any>("studio", "http-studio").playMode, true);
    assert.equal(engine.project(p.data.id).studioId, "http-studio");
    assert.equal(engine.store.all<any>("command")[0].status, "queued");
    assert.equal(
      (await call("/bridge/poll", { playing: "true" }, bridgeHeaders)).status,
      400,
    );
    const poll = await call("/bridge/poll", { playing: false }, bridgeHeaders);
    assert.equal(store.get<any>("studio", "http-studio").playMode, false);
    assert.equal(poll.data.projectId, p.data.id);
    assert.equal(poll.data.command.operation, "snapshot");
    assert.equal(
      (
        await call(
          "/bridge/result",
          {
            commandId: poll.data.command.id,
            projectId: p.data.id,
            baseRevision: 0,
            ok: true,
            fingerprint: "base",
            instances: [],
          },
          bridgeHeaders,
        )
      ).status,
      200,
    );
    assert.equal((await call("/api/files?path=../outside")).status, 409);
    assert.equal((await call("/api/releases/fake/publish", {})).status, 409);
    const resumeBody = {
      studioId: "resumed-studio",
      documentId: "test-document",
      name: "Resumed window",
      placeId: "0",
      universeId: "0",
      capabilities: ["apply", "test"],
    };
    assert.equal(
      (await call("/bridge/resume", resumeBody, bridgeHeaders)).status,
      409,
    );
    const old = store.get<any>("studio", "http-studio");
    old.lastSeen = new Date(Date.now() - 20000).toISOString();
    store.put("studio", old);
    assert.equal(
      (
        await call(
          "/bridge/resume",
          { ...resumeBody, placeId: "123" },
          bridgeHeaders,
        )
      ).status,
      409,
    );
    const resumed = await call("/bridge/resume", resumeBody, bridgeHeaders);
    assert.equal(resumed.status, 200);
    assert.equal(engine.project(p.data.id).studioId, "resumed-studio");
    assert.equal((await call("/bridge/poll", {}, bridgeHeaders)).status, 409);
    const resumedHeaders = {
      ...bridgeHeaders,
      Authorization: "Bearer " + resumed.data.token,
      "x-studio-id": "resumed-studio",
    };
    assert.equal(
      (await call("/bridge/poll", {}, resumedHeaders)).data.projectId,
      p.data.id,
    );
    assert.equal(
      store.get<any>("studio", "resumed-studio").fingerprint,
      "base",
    );
    assert.equal(
      (await call("/api/projects/" + p.data.id + "/studio/unbind", {})).status,
      200,
    );
    const unbound = await call("/bridge/poll", {}, resumedHeaders);
    assert.equal(unbound.data.projectId, null);
    assert.equal(unbound.data.command, null);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("HTTP: the project view carries instance counts and versions are compared on the server", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-http-slim-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  const port = 48273;
  const server = createApp(store, engine, "slim-token", {
    port,
    appRoot: resolve("."),
  }).listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const headers = { Authorization: "Bearer slim-token", "Content-Type": "application/json" };
  const get = async (path: string) =>
    (await fetch(`http://127.0.0.1:${port}${path}`, { headers })).json();
  try {
    const created: any = await (
      await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Slim fixture", genre: "Simulator", goal: "Large scenes stay fast" }),
      })
    ).json();
    const part = (path: string, size: number) => ({ path, className: "Part", properties: { Size: size } });
    for (const [revision, instances] of [
      [1, [part("Workspace/A", 1), part("Workspace/B", 1)]],
      [2, [part("Workspace/A", 2), part("Workspace/C", 1)]],
    ] as const)
      store.put("version", {
        id: `v${revision}`,
        projectId: created.id,
        revision,
        manifest: { summary: "s", deletions: [], files: [], instances, checks: [], findings: [], data: {} },
      } as any);
    const detail: any = await get(`/api/projects/${created.id}`);
    assert.deepEqual(
      detail.versions.map((v: any) => [v.manifest.instances.length, v.manifest.instanceCount]),
      [[0, 2], [0, 2]],
    );
    const diff: any = await get(`/api/projects/${created.id}/version-diff?from=v1&to=v2`);
    assert.deepEqual(
      diff.changes.map((c: any) => [c.path, !!c.before, !!c.after]),
      [["Workspace/A", true, true], ["Workspace/B", true, false], ["Workspace/C", false, true]],
    );
  } finally {
    server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

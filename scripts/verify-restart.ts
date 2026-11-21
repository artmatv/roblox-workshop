import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { DEFAULT_SKILL_IDS } from "../server/default-skills.js";
const root = resolve(import.meta.dirname, ".."),
  dataRoot = mkdtempSync(resolve(tmpdir(), "automation-restart-"));
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>((r) => probe.close(() => r()));
const env = {
  ...process.env,
  AUTOMATION_DATA_DIR: dataRoot,
  AUTOMATION_PORT: String(port),
};
let child: ChildProcess | undefined,
  token: string | undefined,
  projectId: string | undefined;
const sessions: number[] = [];
const call = async (path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.ok(r.ok, d.error);
  return d;
};
try {
  for (let pass = 0; pass < 2; pass++) {
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    sessions.push(child.pid!);
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error("Test service exited during startup");
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(700),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, "Isolated service startup timeout");
    const s = new Store(dataRoot);
    assert.equal(
      s.get<any>("service", "runtime").pid,
      child.pid,
      "Only operate our own test service",
    );
    token = await new Vault(s).get("dashboard-token");
    s.close();
    const p =
      pass === 0
        ? await call("/projects", {
            name: "Restart and automatic skills fixture",
            genre: "Obby",
            goal: "Verify clean start, automatic skills and persistence",
          })
        : (await call("/projects/" + projectId)).project;
    projectId = p.id;
    for (const id of DEFAULT_SKILL_IDS)
      assert.ok(p.skillPins[id], "No automatic pin " + id);
    const stop = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/stop-service.ts", String(port)],
      { cwd: root, env, windowsHide: true, stdio: "ignore" },
    );
    const [code] = await once(stop, "close");
    assert.equal(code, 0, "Stop tool must await actual shutdown");
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      }),
    );
    if (child.exitCode === null) await once(child, "close");
    child = undefined;
  }
  assert.notEqual(sessions[0], sessions[1]);
  writeFileSync(
    resolve(root, "docs/verification/restart.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        isolated: true,
        sessions,
        projectPersisted: true,
        automaticSkills: DEFAULT_SKILL_IDS,
        manualPinCalls: 0,
        portClosedBeforeRestart: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Verified clean service start, automatic skills, completed shutdown, restart and retained project pins.",
  );
} finally {
  if (child?.exitCode === null) {
    try {
      await call("/service/stop", {});
      await Promise.race([
        once(child, "close"),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    } catch {}
    if (child.exitCode === null) child.kill();
  }
  assert.equal(dirname(dataRoot), resolve(tmpdir()));
  assert.ok(basename(dataRoot).startsWith("automation-restart-"));
  rmSync(dataRoot, { recursive: true, force: true });
}

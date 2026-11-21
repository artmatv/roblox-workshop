import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import {
  browserCookieName,
  browserSession,
  issueBrowserSession,
  sameSecret,
  BROWSER_SESSION_MS,
} from "../server/browser-session.js";
import { ApiError, connectionError } from "../shared/connection-error.js";

test("browser authorization is signed, expires, is bound to the service and cannot expose the original dashboard token", () => {
  const secret = "fixture-dashboard-token",
    port = 4317,
    at = 1_000_000;
  const value = issueBrowserSession(secret, port, at),
    cookie = browserCookieName(port) + "=" + value;
  assert.ok(!value.includes(secret));
  assert.ok(browserSession(cookie, secret, port, at + 1));
  assert.equal(browserSession(cookie, "another-token", port, at + 1), null);
  assert.equal(browserSession(cookie, secret, 4318, at + 1), null);
  assert.equal(
    browserSession(cookie, secret, port, at + BROWSER_SESSION_MS),
    null,
  );
  assert.equal(
    browserSession(cookie.slice(0, -3) + "aaa", secret, port, at + 1),
    null,
  );
  assert.equal(
    browserSession(browserCookieName(port) + "=invalid", secret, port, at),
    null,
  );
  assert.equal(browserSession(cookie, secret, port, at - 6000), null);
  assert.equal(sameSecret("é", "e"), false);
});

test("a proven browser keeps API access in a fresh tab and after service restart; anonymous and cross-site requests remain denied", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-browser-session-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  const secret = "fixture-browser-secret",
    options = { port: 0, appRoot: resolve(".") };
  let server = createApp(store, engine, secret, options).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  options.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${options.port}`;
  const call = (headers: Record<string, string> = {}) =>
    fetch(base + "/api/state", {
      headers: { Connection: "close", ...headers },
    });
  try {
    const anonymous = await call();
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("set-cookie"), null);
    assert.equal((await anonymous.json()).code, "DASHBOARD_SESSION_REQUIRED");
    const initial = await call({ Authorization: "Bearer " + secret });
    assert.equal(initial.status, 200);
    await initial.arrayBuffer();
    const setCookie = initial.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/api/);
    assert.match(setCookie, /Max-Age=2592000/);
    const cookie = setCookie.split(";")[0];
    const restored = await call({ Cookie: cookie });
    assert.equal(restored.status, 200);
    assert.equal(restored.headers.get("cache-control"), "no-store");
    await restored.arrayBuffer();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    server = createApp(store, engine, secret, options).listen(
      options.port,
      "127.0.0.1",
    );
    await new Promise<void>((r) => server.once("listening", r));
    const afterRestart = await call({ Cookie: cookie });
    assert.equal(afterRestart.status, 200);
    await afterRestart.arrayBuffer();
    const staleTab = await call({
      Cookie: cookie,
      Authorization: "Bearer old-session-token",
    });
    assert.equal(staleTab.status, 200);
    await staleTab.arrayBuffer();
    const outside = await call({
      Cookie: cookie,
      Origin: "https://example.com",
    });
    assert.equal(outside.status, 403);
    await outside.arrayBuffer();
    const crossSite = await call({
      Cookie: cookie,
      "Sec-Fetch-Site": "cross-site",
    });
    assert.equal(crossSite.status, 401);
    await crossSite.arrayBuffer();
    const forged = await call({
      Cookie: browserCookieName(options.port) + "=forged",
    });
    assert.equal(forged.status, 401);
    await forged.arrayBuffer();
    const bridge = await fetch(base + "/bridge/poll", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(bridge.status, 401);
    await bridge.arrayBuffer();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("lost access, a service error and a disconnected service get distinct recovery states", () => {
  assert.equal(connectionError(new ApiError(401, "Denied")).kind, "access");
  assert.equal(
    connectionError(new ApiError(503, "Service unavailable")).kind,
    "service",
  );
  assert.equal(
    connectionError(new TypeError("Failed to fetch")).kind,
    "offline",
  );
});

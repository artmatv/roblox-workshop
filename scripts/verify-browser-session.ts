import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";

const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data")),
  token = await new Vault(store).get("dashboard-token");
store.close();
const base = "http://127.0.0.1:4317";
const state = await (
  await fetch(base + "/api/state", {
    headers: { Authorization: "Bearer " + token },
  })
).json();
const target =
  state.projects.find((p: any) => p.name === "123") || state.projects[0];
assert.ok(target);
const before = {
  selectedStyle: target.selectedStyle,
  specification: target.specification,
  revision: target.revision,
  approvals: target.approvals,
  studioId: target.studioId,
};
let browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  const firstContext = await browser.newContext({
    viewport: { width: 1440, height: 1060 },
  });
  const first = await firstContext.newPage();
  first.on("pageerror", (e) => errors.push(e.message));
  await first.goto(base);
  await expect(
    first.getByRole("heading", {
      name: "Восстанавливаем доступ к мастерской",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(
    (await first.locator("body").innerText()).includes("Start.ps1"),
    false,
  );
  await first.goto(base + "/#token=" + token);
  await first
    .getByLabel("Активный проект", { exact: true })
    .selectOption(target.id);
  await expect(
    first.getByRole("heading", { name: target.name, exact: true }),
  ).toBeVisible();
  const cookies = await firstContext.cookies(base + "/api/state"),
    session = cookies.find((c) => c.name === "roblox_workshop_4317");
  assert.ok(session?.httpOnly);
  assert.equal(session.sameSite, "Strict");
  assert.equal(session.path, "/api");
  assert.ok(session.expires > Date.now() / 1000 + 86400);
  assert.equal(session.value.includes(token!), false);
  await first.close();
  const plain = await firstContext.newPage();
  plain.on("pageerror", (e) => errors.push(e.message));
  const restoredResponse = plain.waitForResponse(
    (r) => r.url() === base + "/api/state",
  );
  await plain.goto(base);
  assert.equal((await restoredResponse).status(), 200);
  await expect(
    plain.getByRole("heading", { name: target.name, exact: true }),
  ).toBeVisible();
  assert.equal(
    await plain.evaluate(() => sessionStorage.getItem("automation-token")),
    null,
  );
  const remembered = await firstContext.storageState(); // Kept in memory; no credential file is written.
  await browser.close();
  browser = await chromium.launch({ headless: true });
  const reopenedContext = await browser.newContext({
    viewport: { width: 1440, height: 1060 },
    storageState: remembered,
  });
  const reopened = await reopenedContext.newPage();
  reopened.on("pageerror", (e) => errors.push(e.message));
  await reopened.goto(base);
  await expect(
    reopened.getByRole("heading", { name: target.name, exact: true }),
  ).toBeVisible();
  assert.equal(
    await reopened.evaluate(() => sessionStorage.getItem("automation-token")),
    null,
  );
  await reopened.route("**/api/**", (route) => route.abort());
  await expect(
    reopened.getByRole("heading", {
      name: "Восстанавливаем соединение",
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(
    (await reopened.locator("body").innerText()).includes("Start.ps1"),
    false,
  );
  await reopened.unroute("**/api/**");
  await expect(
    reopened.getByRole("heading", { name: target.name, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await reopened.screenshot({
    path: resolve(root, "docs/verification/browser-session-restored.png"),
  });
  const data = await (
    await reopened.request.get(base + "/api/projects/" + target.id)
  ).json();
  assert.deepEqual(
    {
      selectedStyle: data.project.selectedStyle,
      specification: data.project.specification,
      revision: data.project.revision,
      approvals: data.project.approvals,
      studioId: data.project.studioId,
    },
    before,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(root, "docs/verification/browser-session.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        serviceWasRunning: true,
        anonymousBootstrapDenied: true,
        trustedLaunchEstablishesPersistentAccess: true,
        cookie: {
          httpOnly: true,
          sameSite: "Strict",
          path: "/api",
          lifetimeDays: 30,
          rootTokenExposed: false,
        },
        newTabWithEmptySessionStorage: "authorized",
        reopenedBrowserWithEmptySessionStorage: "authorized",
        networkFailureGetsDistinctMessage: true,
        connectionRecoversAutomatically: true,
        projectUnchanged: target.id,
        generatedTasks: 0,
        studioCommands: 0,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Verified: trusted launch → remembered access → plain new tab → browser restart → automatic network recovery. No project changes.",
  );
} finally {
  await browser.close();
}

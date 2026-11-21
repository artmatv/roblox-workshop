import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Store, hash } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { DEFAULT_SKILL_IDS } from "../server/default-skills.js";

// Four phases let Studio's real Play mode be controlled independently of the browser test.
const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const phase = process.argv[2];
assert.ok(["setup", "bind", "playing", "finish"].includes(phase));
const reportPath = resolve(root, "docs/verification/product-flow.json");
const report: any = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : { startedAt: new Date().toISOString(), checks: {} };
const call = async (path: string) => {
  const response = await fetch("http://127.0.0.1:4317/api" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  const value = await response.json();
  assert.ok(response.ok, value.error);
  return value;
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const open = async (section: string) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: section, exact: true })
    .click();
const detail = () => call("/projects/" + report.projectId);
const waitFor = async (condition: () => Promise<boolean>) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await condition()) return;
    await page.waitForTimeout(350);
  }
  throw new Error("Product flow timed out: " + phase);
};
try {
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  await page.getByLabel("Активный проект", { exact: true }).waitFor();
  if (phase === "setup") {
    const state = await call("/state");
    const existing = state.projects.find(
      (p: any) => p.name === "Приёмка плагина и дашборда",
    );
    if (existing) report.projectId = existing.id;
    else {
      await page
        .getByRole("button", { name: "Создать проект", exact: true })
        .click();
      await page
        .getByLabel("Название проекта", { exact: true })
        .fill("Приёмка плагина и дашборда");
      await page.locator('select[name="genre"]').selectOption("Другое");
      await page
        .getByLabel("Идея и ограничения", { exact: true })
        .fill(
          "Техническая проверка продукта: автоматические навыки и English UI, подключение пустого Place1, ожидание команд во время Play, отвязка. Игру и агентов не запускать.",
        );
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/projects") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Создать проект", exact: true })
        .last()
        .click();
      const created = await (await response).json();
      assert.ok(created.id, created.error);
      report.projectId = created.id;
      report.checks.createdThroughDashboard = true;
    }
  }
  assert.ok(report.projectId);
  await page
    .getByLabel("Активный проект", { exact: true })
    .selectOption(report.projectId);
  await page
    .getByRole("heading", { name: "Приёмка плагина и дашборда", exact: true })
    .waitFor();
  const policy = page.getByRole("region", {
    name: "Правила разработки",
    exact: true,
  });
  await policy.getByText("English · en-us", { exact: true }).waitFor();
  const d = await detail();
  assert.equal(
    d.development.skills.filter((s: any) => s.status === "ready").length,
    DEFAULT_SKILL_IDS.length,
  );
  assert.equal(d.development.localization.status, "not_built");
  assert.equal(d.development.localization.required, true);
  assert.equal(
    d.tasks.some((t: any) => t.provider === "codex" || t.provider === "openai"),
    false,
  );
  report.checks.automaticSkillsAndEnglishPolicy = true;
  const studioCard = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "Roblox Studio", exact: true }),
  });
  if (phase === "setup") {
    const pairingResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/pairing") && r.request().method() === "POST",
    );
    await studioCard
      .getByRole("button", { name: "Код подключения", exact: true })
      .click();
    const pairing = await (await pairingResponse).json();
    assert.ok(pairing.code);
    mkdirSync(resolve(root, "data/verification"), { recursive: true });
    writeFileSync(
      resolve(root, "data/verification/product-pairing.json"),
      JSON.stringify(pairing),
    );
    report.checks.pairingThroughDashboard = true;
    const downloadEvent = page.waitForEvent("download");
    await studioCard
      .getByRole("button", { name: "Плагин", exact: true })
      .click();
    const download = await downloadEvent;
    mkdirSync(resolve(root, "outputs/product-verification"), {
      recursive: true,
    });
    const path = resolve(root, "outputs/product-verification/Automation.rbxmx");
    await download.saveAs(path);
    assert.equal(
      hash(readFileSync(path).toString("base64")),
      hash(
        readFileSync(resolve(root, "plugin/Automation.rbxmx")).toString(
          "base64",
        ),
      ),
    );
    report.checks.pluginDownloadedFromDashboard = true;
  } else if (phase === "bind") {
    const studioId = process.argv[3];
    const state = await call("/state"),
      studio = state.studios.find((s: any) => s.id === studioId);
    assert.ok(["Place1", "Place1.rbxl"].includes(studio?.name));
    assert.equal(studio.placeId, "0");
    assert.equal(studio.universeId, "0");
    report.studioId = studio.id;
    report.beforeFingerprint = studio.fingerprint;
    const row = studioCard
      .locator(".connection")
      .filter({ has: page.getByText(studio.name, { exact: true }) });
    await row.getByRole("button", { name: "Связать", exact: true }).click();
    await waitFor(async () =>
      (await detail()).commands.some(
        (c: any) => c.operation === "snapshot" && c.status === "succeeded",
      ),
    );
    assert.equal((await detail()).project.studioId, studio.id);
    report.checks.boundThroughDashboard = true;
    report.pluginExecution =
      process.argv[4] === "--installed"
        ? "Installed local Automation.rbxmx, paired through native plugin UI"
        : "Temporary PluginManager harness";
    report.checks.initialSnapshot = true;
  } else if (phase === "playing") {
    await waitFor(
      async () =>
        (await call("/state")).studios.find(
          (s: any) => s.id === report.studioId,
        )?.playMode === true,
    );
    const until = Date.now() + 17000;
    let oldest = 0;
    while (Date.now() < until) {
      const studio = (await call("/state")).studios.find(
        (s: any) => s.id === report.studioId,
      );
      assert.equal(studio.playMode, true);
      const age = Date.now() - Date.parse(studio.lastSeen);
      assert.ok(age < 8000, "Lost Play heartbeat");
      oldest = Math.max(oldest, age);
      await page.waitForTimeout(2000);
    }
    await studioCard.getByText("Игра запущена", { exact: true }).waitFor();
    report.checks.liveDuringPlay = {
      observedSeconds: 17,
      oldestHeartbeatMs: oldest,
    };
    await open("Сборка и проверки");
    const queuedResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${report.projectId}/commands`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Снимок сцены", exact: true })
      .click();
    const command = await (await queuedResponse).json();
    assert.equal(command.status, "queued");
    report.queuedCommandId = command.id;
    await page.waitForTimeout(4500);
    assert.equal(
      (await detail()).commands.find((c: any) => c.id === command.id).status,
      "queued",
    );
    report.checks.noCommandsExecutedDuringPlay = true;
    await page.screenshot({
      path: resolve(root, "docs/verification/product-play-queue.png"),
      fullPage: true,
    });
  } else if (phase === "finish") {
    await waitFor(
      async () =>
        (await detail()).commands.find(
          (c: any) => c.id === report.queuedCommandId,
        )?.status === "succeeded",
    );
    const command = (await detail()).commands.find(
      (c: any) => c.id === report.queuedCommandId,
    );
    assert.equal(command.result.fingerprint, report.beforeFingerprint);
    report.afterFingerprint = command.result.fingerprint;
    report.checks.queueContinuedAfterPlay = true;
    report.checks.sceneUnchanged = true;
    await studioCard
      .getByRole("button", { name: "Отвязать Studio", exact: true })
      .click();
    await waitFor(async () => (await detail()).project.studioId === null);
    report.checks.unboundThroughDashboard = true;
    await page.reload();
    await page
      .getByRole("heading", { name: "Приёмка плагина и дашборда", exact: true })
      .waitFor();
    await policy.getByText("English · en-us", { exact: true }).waitFor();
    await page.screenshot({
      path: resolve(root, "docs/verification/product-dashboard.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(root, "docs/verification/product-dashboard-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    report.checks.reloadedAndMobileLayout = true;
    report.completedAt = new Date().toISOString();
  }
  assert.deepEqual(errors, []);
  report.errors = [];
  save();
  console.log(
    JSON.stringify({
      phase,
      projectId: report.projectId,
      checks: report.checks,
    }),
  );
} catch (error) {
  report.errors = [...errors, (error as Error).message];
  save();
  throw error;
} finally {
  await browser.close();
}

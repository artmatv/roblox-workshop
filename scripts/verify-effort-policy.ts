import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import { effortModels } from "../tests/effort-fixture.js";

const root = resolve(import.meta.dirname, ".."),
  temp = mkdtempSync(resolve(tmpdir(), "effort-ui-"));
const store = new Store(temp),
  engine = new Engine(store, new Codex());
engine.models = effortModels;
const project = engine.createProject({
  name: "Проверка effort",
  genre: "Simulator",
  goal: "Изолированная проверка без запуска агентов",
});
const task = engine.task(project, {
  title: "Настраиваемая задача",
  role: "ui",
  kind: "ui",
  instructions: "Test",
});
engine.task(project, {
  title: "Сборка",
  role: "orchestrator",
  kind: "build",
  provider: "studio",
  instructions: "Test",
});
const port = 48329,
  token = "isolated-effort-ui-token";
const server = createApp(store, engine, token, { port, appRoot: root }).listen(
  port,
  "127.0.0.1",
);
await new Promise<void>((r) => server.once("listening", r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = resolve(root, "outputs/effort-policy-verification");
mkdirSync(output, { recursive: true });
try {
  await page.addInitScript(
    ({ token, projectId }) => {
      sessionStorage.setItem("automation-token", token);
      localStorage.setItem("automation-project", projectId);
    },
    { token, projectId: project.id },
  );
  await page.goto(`http://127.0.0.1:${port}`);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "План и агенты", exact: true })
    .click();
  await expect(
    page.getByText("Базовый effort: high", { exact: true }).first(),
  ).toBeVisible();
  const row = page
    .locator("article")
    .filter({ has: page.getByText("Настраиваемая задача", { exact: true }) });
  await row
    .getByText("Следующий запуск: effort high · Настроить", { exact: true })
    .click();
  await row.getByLabel("Тип задачи").selectOption("routine");
  await row.getByLabel("Effort задачи", { exact: true }).selectOption("low");
  await row
    .getByLabel("Причина ручного выбора")
    .fill("Изменить только одну подпись");
  await row
    .getByRole("button", { name: "Сохранить effort", exact: true })
    .click();
  await expect(
    row.locator("summary").filter({ hasText: "Следующий запуск" }),
  ).toHaveText("Следующий запуск: effort low · Настроить");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "План и агенты", exact: true })
    .click();
  await expect(
    row.locator("summary").filter({ hasText: "Следующий запуск" }),
  ).toHaveText("Следующий запуск: effort low · Настроить");
  await row
    .getByText("Следующий запуск: effort low · Настроить", { exact: true })
    .click();
  for (const viewport of [
    { width: 1440, height: 1060 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(row.getByLabel("Тип задачи")).toBeVisible();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      errors.push(`Overflow at ${viewport.width}`);
    await page.screenshot({
      path: resolve(output, `${viewport.width}.png`),
      fullPage: true,
    });
  }
  const saved = store.get<any>("task", task.id);
  if (saved.effortOverride !== "low" || saved.effortClass !== "routine")
    throw new Error("Effort settings were not persisted");
  if (errors.length) throw new Error(errors.join("; "));
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: true,
        checks: [
          "role defaults",
          "manual effort",
          "API persistence",
          "reload",
          "desktop",
          "mobile",
          "no page errors",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Effort UI: role defaults, save, reload, desktop and mobile passed",
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
  rmSync(temp, { recursive: true, force: true });
}

import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import { effortModels } from "../tests/effort-fixture.js";
import { fixtureNames, mockNamingAI } from "../tests/project-naming-fixture.js";
const root = resolve(import.meta.dirname, ".."),
  temp = mkdtempSync(resolve(tmpdir(), "naming-ui-"));
const store = new Store(temp),
  codex = new Codex(),
  engine = new Engine(store, codex);
engine.models = effortModels;
engine.account = { account: { type: "chatgpt" } };
mockNamingAI(codex);
const project = engine.createProject({
  name: "123",
  genre: "Simulator",
  goal: "Clean and restore a park",
});
project.concept = "Collect litter and restore a park with a bubble tool";
engine.save(project);
const port = 48335,
  token = "isolated-naming-ui-token";
const server = createApp(store, engine, token, { port, appRoot: root }).listen(
  port,
  "127.0.0.1",
);
await new Promise<void>((r) => server.once("listening", r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = resolve(root, "outputs/project-naming-verification");
mkdirSync(output, { recursive: true });
try {
  await page.addInitScript(
    ({ token, id }) => {
      sessionStorage.setItem("automation-token", token);
      localStorage.setItem("automation-project", id);
    },
    { token, id: project.id },
  );
  await page.goto(`http://127.0.0.1:${port}`);
  await page
    .getByRole("button", { name: "Изменить название проекта", exact: true })
    .click();
  await page
    .getByLabel("Название проекта", { exact: true })
    .fill("Парк Чистоты");
  await page
    .getByRole("button", { name: "Сохранить название", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Парк Чистоты", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Парк Чистоты", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Активный проект").locator("option:checked"),
  ).toHaveText("Парк Чистоты");
  await page
    .getByRole("button", { name: "Изменить название проекта", exact: true })
    .click();
  await page
    .getByLabel("Название проекта", { exact: true })
    .fill("Не сохранять");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Парк Чистоты", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Придумать название", exact: true })
    .click();
  await expect(page.locator(".project-name-suggestions > button")).toHaveCount(
    5,
  );
  await expect(
    page.getByRole("heading", { name: "Парк Чистоты", exact: true }),
  ).toBeVisible();
  await page.locator(".project-name-suggestions > button").first().click();
  await expect(
    page.getByLabel("Название проекта", { exact: true }),
  ).toHaveValue(fixtureNames[0].name);
  await page
    .getByLabel("Название проекта", { exact: true })
    .fill("My Bubble Park");
  await page.waitForTimeout(5200);
  await expect(
    page.getByLabel("Название проекта", { exact: true }),
  ).toHaveValue("My Bubble Park");
  await page
    .getByText("Стиль названий и анализ топовых игр", { exact: true })
    .click();
  await expect(page.locator(".naming-research ol > li")).toHaveCount(24);
  for (const viewport of [
    { width: 1440, height: 1060 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("button", { name: "Сохранить название", exact: true }),
    ).toBeVisible();
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
  await page
    .getByRole("button", { name: "Сохранить название", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My Bubble Park", exact: true }),
  ).toBeVisible();
  if (engine.project(project.id).name !== "My Bubble Park")
    throw new Error("Selected name was not saved");
  if (errors.length) throw new Error(errors.join("; "));
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: true,
        checks: [
          "manual rename",
          "reload and sidebar",
          "cancel",
          "five AI candidates",
          "no auto-rename",
          "edit candidate",
          "draft survives polling",
          "research list",
          "desktop",
          "mobile",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Naming UI: rename, reload, generation, selection, editing, cancellation and both viewports passed",
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
  rmSync(temp, { recursive: true, force: true });
}

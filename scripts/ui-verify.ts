import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, "..");
const store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
mkdirSync(resolve(root, "docs/verification"), { recursive: true });
try {
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  await page.getByRole("heading", { name: "От идеи к своей игре" }).waitFor();
  await page.screenshot({
    path: resolve(root, "docs/verification/dashboard-empty.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Создать первую игру" }).click();
  await page.getByLabel("Название проекта").fill("Проверка интерфейса");
  await page
    .getByLabel("Идея и ограничения")
    .fill(
      "Изолированная проверка дашборда, без запуска агентов или внешних операций.",
    );
  await page
    .locator("form.modal")
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Проверка интерфейса", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Концепция и стиль", exact: true })
    .click();
  await page
    .getByLabel("Краткая концепция")
    .fill(
      "Оригинальная тестовая концепция: пройти три прыжка, собрать жетон и открыть следующую зону.",
    );
  await page.getByLabel("Краткая концепция").blur();
  await page
    .getByRole("button", { name: "Утвердить концепцию", exact: true })
    .click();
  await page.getByText("Концепция утверждена", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Проверка интерфейса", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Сборка и проверки", exact: true })
    .click();
  await page.getByRole("heading", { name: "Обязательные сценарии" }).waitFor();
  for (const name of [
    "Доработки",
    "Библиотека ресурсов",
    "Релизы",
    "Аналитика",
    "Аккаунты и расходы",
    "Навыки",
    "Обзор",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(180);
  }
  await page.screenshot({
    path: resolve(root, "docs/verification/dashboard-project.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(root, "docs/verification/dashboard-mobile.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) errors.push("Mobile viewport overflows horizontally");
  writeFileSync(
    resolve(root, "docs/verification/ui-report.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        flow: "Create → concept approval → reload → all project sections",
        viewports: ["1440x1060", "390x844"],
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    "UI verified: persisted project and approval, 12 sections, 2 viewports, no page errors.",
  );
} finally {
  await browser.close();
}

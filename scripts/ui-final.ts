import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  await page
    .getByRole("button", { name: "Концепция и стиль", exact: true })
    .waitFor();
  if (process.argv[2])
    await page.getByLabel("Активный проект").selectOption(process.argv[2]);
  const sections = [
    "Исследование",
    "Концепция и стиль",
    "Спецификация",
    "План и агенты",
    "Сборка и проверки",
    "Доработки",
    "Библиотека ресурсов",
    "Релизы",
    "Аналитика",
    "Аккаунты и расходы",
    "Навыки",
    "Обзор",
  ];
  const visited: string[] = [];
  for (const viewport of [
    { width: 1440, height: 1060 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of sections) {
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await page.waitForTimeout(120);
      visited.push(`${viewport.width}x${viewport.height}: ${name}`);
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )
      )
        errors.push("Horizontal overflow: " + visited.at(-1));
    }
    await page.screenshot({
      path: resolve(
        root,
        "docs/verification/" +
          (viewport.width === 1440
            ? "dashboard-project.png"
            : "dashboard-mobile.png"),
      ),
      fullPage: true,
    });
  }
  writeFileSync(
    resolve(root, "docs/verification/ui-final.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        sections: 12,
        viewports: ["1440x1060", "390x844"],
        visited,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("; "));
  console.log("Final UI check passed: 12 sections, 2 viewports, no errors.");
} finally {
  await browser.close();
}

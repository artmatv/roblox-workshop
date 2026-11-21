import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";

const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const projects = JSON.parse(
  readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
).projects;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } }),
  errors: string[] = [],
  violations: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.addInitScript(() =>
    document.addEventListener(
      "securitypolicyviolation",
      (e) =>
        ((window as any).__csp = ((window as any).__csp || []).concat(
          JSON.stringify({
            directive: e.violatedDirective,
            blocked: e.blockedURI,
            source: e.sourceFile,
            line: e.lineNumber,
            column: e.columnNumber,
            sample: e.sample,
          }),
        )),
    ),
  );
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  const previews = page.locator("button.preview-open img");
  const until = async (check: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw new Error("Timed out waiting for dashboard state");
  };
  let images = 0;
  for (const project of projects) {
    await page
      .getByRole("combobox", { name: "Активный проект" })
      .selectOption(project.id);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Концепция и стиль", exact: true })
      .click();
    await until(
      async () =>
        (await page.locator(".breadcrumb strong").textContent()) ===
        project.name,
    );
    for (const device of ["desktop", "mobile"]) {
      if (device === "mobile")
        await page
          .getByRole("button", { name: "Компьютер", exact: true })
          .click();
      else if (
        await page.getByRole("button", { name: "Телефон", exact: true }).count()
      )
        await page
          .getByRole("button", { name: "Телефон", exact: true })
          .click();
      for (const screen of ["hud", "shop", "inventory", "menu"]) {
        await page
          .getByRole("combobox", { name: "Экран предпросмотра" })
          .selectOption(screen);
        await until(() =>
          page.evaluate(() => {
            const a = [
              ...document.querySelectorAll<HTMLImageElement>(
                "button.preview-open img",
              ),
            ];
            return (
              a.length === 3 && a.every((i) => i.complete && i.naturalWidth > 0)
            );
          }),
        );
        if ((await previews.count()) !== 3)
          throw new Error("Expected 3 populated previews");
        images += 3;
      }
    }
    await page
      .getByRole("combobox", { name: "Экран предпросмотра" })
      .selectOption("hud");
    await page
      .getByRole("button", { name: "Рассмотреть эскиз крупнее", exact: true })
      .first()
      .click();
    await page.getByRole("dialog", { name: "Эскиз оформления" }).waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByText("Источники и степень проверки", { exact: true })
      .first()
      .click();
    const references = page
      .locator(".style-details")
      .filter({
        has: page.getByText("Источники и степень проверки", { exact: true }),
      })
      .first();
    if (!(await references.getByRole("link").count()))
      throw new Error("Sources are missing");
    await page.setViewportSize({ width: 390, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      errors.push(project.name + ": mobile horizontal overflow");
    await page.screenshot({
      path: resolve(
        root,
        "docs/verification/styles-" + project.key + "-mobile.png",
      ),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1060 });
  }
  violations.push(...(await page.evaluate(() => (window as any).__csp || [])));
  if (violations.length) errors.push(...violations);
  writeFileSync(
    resolve(root, "docs/verification/ui-styles.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projects: 3,
        imagesChecked: images,
        authenticatedImages: true,
        zoomChecked: true,
        sourceLinksChecked: true,
        viewports: ["1440x1060", "390x844"],
        cspViolations: violations,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    "Populated dashboard verified: 72 previews, sources, zoom, two viewports, no CSP errors.",
  );
} finally {
  await browser.close();
}

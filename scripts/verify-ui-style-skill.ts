import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { DEFAULT_SKILL_IDS } from "../server/default-skills.js";

const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data")),
  token = await new Vault(store).get("dashboard-token");
store.close();
const call = async (path: string) => {
  const response = await fetch("http://127.0.0.1:4317/api" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await response.json();
  assert.ok(response.ok, data.error);
  return data;
};
const fixtureName = "Проверка готовых UI стилей",
  initial = await call("/state"),
  protectedProjects = initial.projects
    .filter((p: any) => p.name !== fixtureName)
    .map((p: any) => ({
      id: p.id,
      selectedStyle: p.selectedStyle,
      approvals: p.approvals,
      studioId: p.studioId,
      revision: p.revision,
    }));
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1060 } }),
  errors: string[] = [],
  fileFailures: string[] = [],
  selected: string[] = [],
  screens: any[] = [];
let fixtureId = "";
const folder = resolve(root, "docs/verification");
mkdirSync(folder, { recursive: true });
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().includes("/api/files?") && !r.ok())
    fileFailures.push(String(r.status()));
});
const openStyles = async () => {
  await page
    .getByRole("navigation")
    .getByRole("button", {
      name: "Концепция и стиль",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Выберите готовый стиль", exact: true })
    .waitFor();
};
const library = page.getByRole("region", {
  name: "Готовые стили",
  exact: true,
});
const waitImages = async () => {
  await expect(library.locator(".preset-card .preview-open > img")).toHaveCount(
    6,
  );
  await expect
    .poll(() =>
      library
        .locator(".preset-card .preview-open > img")
        .evaluateAll((images) =>
          images.every(
            (i) =>
              (i as HTMLImageElement).complete &&
              (i as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
};
try {
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  await page.getByLabel("Активный проект", { exact: true }).waitFor();
  const existing = initial.projects.find((p: any) => p.name === fixtureName);
  if (existing) {
    fixtureId = existing.id;
    await page
      .getByLabel("Активный проект", { exact: true })
      .selectOption(fixtureId);
    await page
      .getByRole("heading", { name: fixtureName, exact: true })
      .waitFor();
  } else {
    await page
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    await page.getByLabel("Название проекта").fill(fixtureName);
    await page
      .getByLabel("Идея и ограничения")
      .fill(
        "Техническая проверка выбора готовых стилей. Без разработки игры, запуска агентов и подключения Studio.",
      );
    await page
      .locator("form.modal")
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    await page
      .getByRole("heading", { name: fixtureName, exact: true })
      .waitFor();
    fixtureId = (await call("/state")).projects.find(
      (p: any) => p.name === fixtureName,
    ).id;
  }
  await openStyles();
  await expect(library.locator(".preset-card")).toHaveCount(3);
  const kits = (await call("/projects/" + fixtureId)).uiStyles.items;
  assert.equal(kits.length, 3);
  for (const kit of kits) {
    const button = library.getByRole("button", {
      name: `Выбрать стиль «${kit.name}»`,
      exact: true,
    });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    let detail = await call("/projects/" + fixtureId);
    const style = detail.styles.find(
      (s: any) => s.id === detail.project.selectedStyle,
    );
    assert.equal(style.rules.preset.id, kit.id);
    assert.equal(style.rules.preset.version, "1.0.0");
    selected.push(kit.id);
    await page.reload();
    await openStyles();
    await expect(
      library.getByRole("button", {
        name: `Выбрать стиль «${kit.name}»`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    detail = await call("/projects/" + fixtureId);
    assert.equal(detail.project.selectedStyle, style.id);
    assert.equal(detail.tasks.length, 0);
    assert.equal(detail.commands.length, 0);
  }
  await library
    .getByRole("button", {
      name: `Выбрать стиль «${kits[0].name}»`,
      exact: true,
    })
    .click();
  await expect(
    library.getByRole("button", {
      name: `Выбрать стиль «${kits[0].name}»`,
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const device of ["desktop", "mobile"]) {
    if (device === "mobile")
      await library
        .getByRole("button", { name: "Компьютер", exact: true })
        .click();
    for (const screen of ["hud", "menu", "shop", "inventory"]) {
      await library.getByLabel("Экран предпросмотра").selectOption(screen);
      await waitImages();
      const images = await library
        .locator(".preset-card > .preview-open img")
        .evaluateAll((elements) =>
          elements.map((el) => ({
            width: (el as HTMLImageElement).naturalWidth,
            height: (el as HTMLImageElement).naturalHeight,
          })),
        );
      assert.equal(images.length, 3);
      assert.ok(
        images.every((i) => i.width === (device === "mobile" ? 390 : 1280)),
      );
      screens.push({ device, screen, images: images.length });
    }
  }
  await library.getByRole("button", { name: "Телефон", exact: true }).click();
  await library.getByLabel("Экран предпросмотра").selectOption("hud");
  await waitImages();
  for (const card of await library.locator(".preset-card").all()) {
    await card.getByText("Иконки и состав пакета", { exact: true }).click();
    const sheet = card.getByRole("img", { name: /^Набор иконок:/ }).first();
    await expect(sheet).toBeVisible();
    await expect
      .poll(() =>
        sheet.evaluate(
          (i) =>
            (i as HTMLImageElement).complete &&
            (i as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await card.getByText("Иконки и состав пакета", { exact: true }).click();
    await card.getByText("Ваш визуальный пример", { exact: true }).click();
    const photo = card.getByRole("img", { name: /^Ваш пример:/ }).first();
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate(
          (i) =>
            (i as HTMLImageElement).complete &&
            (i as HTMLImageElement).naturalWidth > 1000,
        ),
      )
      .toBe(true);
    await card.getByText("Ваш визуальный пример", { exact: true }).click();
  }
  const firstPreview = library.locator(".preset-card > .preview-open").first();
  await firstPreview.click();
  const dialog = page.getByRole("dialog", { name: /^Яркий симулятор:/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  const concept = page.getByLabel("Краткая концепция", { exact: true });
  await concept.fill(
    "Техническая проверка инструмента: выбрать оформление, сохранить его и передать в спецификацию. Игровое производство не запускать.",
  );
  await concept.blur();
  await expect
    .poll(async () => (await call("/projects/" + fixtureId)).project.concept)
    .toContain("Техническая проверка инструмента");
  await page
    .getByRole("button", { name: "Утвердить концепцию", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Утвердить выбранное оформление",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: "Утвердить выбранное оформление",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Оформление утверждено", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await openStyles();
  await waitImages();
  await expect(
    page.getByRole("button", { name: "Оформление утверждено", exact: true }),
  ).toBeDisabled();
  await library.screenshot({
    path: resolve(folder, "ui-style-presets-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await library.getByRole("button", { name: "Компьютер", exact: true }).click();
  await waitImages();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await library.screenshot({
    path: resolve(folder, "ui-style-presets-mobile.png"),
  });
  const detail = await call("/projects/" + fixtureId),
    state = await call("/state");
  for (const id of DEFAULT_SKILL_IDS)
    assert.ok(detail.project.skillPins[id], "Missing automatic skill: " + id);
  assert.equal(detail.tasks.length, 0);
  assert.equal(detail.commands.length, 0);
  assert.equal(detail.project.stage, "specification");
  assert.ok(detail.project.requiredChecks.includes("localization"));
  for (const prior of protectedProjects) {
    const p = state.projects.find((p: any) => p.id === prior.id);
    assert.deepEqual(
      {
        id: p.id,
        selectedStyle: p.selectedStyle,
        approvals: p.approvals,
        studioId: p.studioId,
        revision: p.revision,
      },
      prior,
    );
  }
  assert.deepEqual(fileFailures, []);
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(folder, "ui-style-presets.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projectId: fixtureId,
        skills: DEFAULT_SKILL_IDS,
        selectedAndReloaded: selected,
        screens,
        iconSheetsLoaded: 3,
        originalUserPhotosLoaded: 3,
        approvalPersisted: true,
        generatedTasks: 0,
        studioCommands: 0,
        unchangedOtherProjects: protectedProjects.map((p: any) => p.id),
        nativeGameChecks: "Not run; style examples are not runtime evidence",
        viewports: ["1440x1060", "390x844"],
        errors,
        fileFailures,
      },
      null,
      2,
    ),
  );
  console.log(
    "UI style skill verified: all 3 choices persist, 24 screens and icon/reference previews load, approval persists, no agents or Studio commands.",
  );
} finally {
  await browser.close();
}

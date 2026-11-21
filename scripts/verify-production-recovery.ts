import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
import { createApp } from "../server/app.js";
import { manifestSchema } from "../shared/domain.js";
const root = resolve(import.meta.dirname, ".."),
  temp = mkdtempSync(resolve(tmpdir(), "recovery-ui-"));
const store = new Store(temp),
  engine = new Engine(store, new Codex());
const p = engine.createProject({
  name: "Проверка продолжения",
  genre: "Simulator",
  goal: "Isolated recovery UI",
});
p.stage = "production";
p.execution = "error";
p.budget.approved = true;
for (const name of ["specification", "budget"])
  p.approvals[name] = {
    revision: 0,
    hash: engine.approvalHash(p, name),
    at: new Date().toISOString(),
  };
engine.save(p);
const source = engine.task(p, {
  title: "Интерфейс и управление",
  role: "ui",
  kind: "ui",
  scope: ["StarterGui"],
  instructions: "UI",
  status: "failed",
  attempt: 3,
  maxAttempts: 3,
  reviewId: "recovery-review",
  error:
    "Результат не принят: основная кнопка скрыта.\nИсправьте доступность кнопки в горизонтальном режиме.",
});
store.put("agentCandidate", {
  id: source.reviewId!,
  raw: manifestSchema.parse({ summary: "Saved UI candidate" }),
  prepared: manifestSchema.parse({ summary: "Saved UI candidate" }),
});
store.put("resultReview", {
  id: source.reviewId!,
  taskId: source.id,
  projectId: p.id,
  status: "rejected",
  createdAt: new Date().toISOString(),
  summary: "Основная кнопка скрыта в горизонтальном режиме телефона",
  issues: [],
});
engine.task(p, {
  title: "Сборка",
  role: "orchestrator",
  kind: "build",
  provider: "studio",
  instructions: "Build",
  dependencies: [source.id],
  status: "dependencies",
});
const port = 48339,
  token = "recovery-ui-token";
const server = createApp(store, engine, token, { port, appRoot: root }).listen(
  port,
  "127.0.0.1",
);
await new Promise<void>((r) => server.once("listening", r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1060 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ token, id }) => {
      sessionStorage.setItem("automation-token", token);
      localStorage.setItem("automation-project", id);
    },
    { token, id: p.id },
  );
  await page.goto(`http://127.0.0.1:${port}`);
  const button = page.getByRole("button", {
    name: "Исправить замечания и продолжить",
    exact: true,
  });
  await expect(button).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(button).toBeVisible();
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw new Error("Recovery panel overflows on mobile");
  await button.click();
  await expect(page.locator(".controls .badge")).toHaveText("В работе");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "План и агенты", exact: true })
    .click();
  await expect(
    page.locator(".task-list > article .task-body > strong").first(),
  ).toHaveText("Исправление: Интерфейс и управление");
  await expect(
    page.getByText("Продолжение перенесено в новую задачу исправления", {
      exact: true,
    }),
  ).toBeVisible();
  if (errors.length) throw new Error(errors.join("; "));
  mkdirSync(resolve(root, "outputs/production-recovery-verification"), {
    recursive: true,
  });
  await page.screenshot({
    path: resolve(root, "outputs/production-recovery-verification/mobile.png"),
    fullPage: true,
  });
  console.log(
    "Recovery UI: actionable reason, mobile layout, recovery API, updated execution and preserved history passed",
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
  rmSync(temp, { recursive: true, force: true });
}

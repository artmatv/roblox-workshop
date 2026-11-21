import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { DEFAULT_SKILL_IDS } from "../server/default-skills.js";

const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const call = async (path: string, body?: unknown) => {
  const r = await fetch("http://127.0.0.1:4317/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.ok(r.ok, data.error);
  return data;
};
const reportPath = resolve(root, "docs/verification/automatic-skills.json");
let previous: any;
try {
  previous = JSON.parse(readFileSync(reportPath, "utf8"));
} catch {}
const before = await call("/state");
previous ||= before.projects.find(
  (p: any) => p.name === "Проверка автоматических навыков",
)
  ? {
      projectId: before.projects.find(
        (p: any) => p.name === "Проверка автоматических навыков",
      ).id,
    }
  : undefined;
const project = previous?.projectId
  ? (await call("/projects/" + previous.projectId)).project
  : await call("/projects", {
      name: "Проверка автоматических навыков",
      genre: "Obby",
      goal: "Проверочный проект: навыки назначаются без ручного импорта и закрепления. Агентов не запускать.",
    });
const state = await call("/state"),
  detail = await call("/projects/" + project.id);
const selected = DEFAULT_SKILL_IDS.map((id) => {
  const skill = state.skills.find((s: any) => s.id === id);
  assert.ok(skill?.instructions.length > 1000, "Missing full skill " + id);
  assert.equal(
    project.skillPins[id],
    skill.hash,
    "Missing automatic pin " + id,
  );
  return { id, version: skill.version, hash: skill.hash, roles: skill.roles };
});
const realRoleTasks: any[] = [];
const controls = JSON.parse(
  readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
).projects;
for (const p of controls) {
  const detail = await call("/projects/" + p.id);
  for (const style of detail.styles) {
    const t = detail.tasks.find((t: any) => t.id === style.previewTaskId);
    if (t?.threadId && t.skills.length)
      realRoleTasks.push({
        projectId: p.id,
        taskId: t.id,
        role: t.role,
        kind: t.kind,
        status: t.status,
        skills: t.skills.map((s: any) => s.id),
        studioEvidence: style.studioEvidence,
      });
  }
}
assert.equal(project.skillPins["local-ui"], undefined);
assert.ok(detail.events.some((e: any) => e.type === "skill.autoAssigned"));
assert.equal(detail.tasks.length, 0);
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1060 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  await page.locator("aside select").selectOption(project.id);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Навыки", exact: true })
    .click();
  await page
    .getByText("Roblox-навыки подключаются к новым проектам автоматически.", {
      exact: false,
    })
    .waitFor();
  for (const id of DEFAULT_SKILL_IDS) {
    const skill = state.skills.find((s: any) => s.id === id);
    const row = page.locator(".skill-row").filter({
      has: page.getByRole("heading", { name: skill.name, exact: true }),
    });
    await row.getByText("Используется в проекте", { exact: true }).waitFor();
  }
  await page.screenshot({
    path: resolve(root, "docs/verification/automatic-skills.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(root, "docs/verification/automatic-skills-mobile.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        className: e.className,
        text: e.textContent?.slice(0, 100),
      }))
      .slice(0, 12),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    JSON.stringify(overflow),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      projectId: project.id,
      skills: selected,
      manualImportCalls: 0,
      manualPinCalls: 0,
      generatedTasks: 0,
      automaticAssignmentEvent: true,
      dashboardBadges: `all ${DEFAULT_SKILL_IDS.length} present`,
      viewports: ["1440x1060", "390x844"],
      errors,
      realRoleTasks,
      roleRouting:
        "Covered by tests/default-skills.test.ts; native task verification recorded separately",
    },
    null,
    2,
  ),
);
console.log(
  `Automatic skills verified through live API, SQLite journal and dashboard: all ${DEFAULT_SKILL_IDS.length} pinned without manual setup.`,
);

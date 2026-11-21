import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { Store, hash } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { REQUIRED_CHECKS } from "../server/engine.js";

const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data")),
  token = await new Vault(store).get("dashboard-token");
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
const state = await call("/state"),
  target = state.projects.find(
    (p: any) =>
      p.id === process.argv[2] || (!process.argv[2] && p.name === "123"),
  );
assert.ok(target, "Target project not found");
const initial = await call("/projects/" + target.id),
  previousSummary = initial.project.specification;
const latestSource = initial.tasks
  .filter(
    (t: any) =>
      t.kind === "specification" &&
      t.result?.files.some((f: any) => /(^|\/)SPEC\.md$/i.test(f.path)),
  )
  .at(-1);
const source = latestSource?.sourceTaskId
  ? initial.tasks.find((t: any) => t.id === latestSource.sourceTaskId)
  : latestSource;
assert.ok(source, "No saved SPEC.md found");
const actual = source.result.files.find((f: any) =>
  /(^|\/)SPEC\.md$/i.test(f.path),
).content;
assert.ok(actual.length > 10000);
const before = {
  revision: target.revision,
  selectedStyle: target.selectedStyle,
  studioId: target.studioId,
  concept: target.approvals.concept,
  style: target.approvals.style,
  commandIds: initial.commands.map((c: any) => c.id),
};
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1060 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const openSpecification = async () =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: "Спецификация", exact: true })
    .click();
const out = resolve(root, "docs/verification");
try {
  await page.goto("http://127.0.0.1:4317/#token=" + token);
  await page
    .getByLabel("Активный проект", { exact: true })
    .selectOption(target.id);
  await page.getByRole("heading", { name: target.name, exact: true }).waitFor();
  await openSpecification();
  let task: any;
  if (!initial.project.specificationArtifact) {
    const previousCount = initial.tasks.filter(
      (t: any) => t.sourceTaskId === source.id,
    ).length;
    await expect(
      page.getByRole("button", {
        name: "Утвердить эту спецификацию",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Проверить сохранённый документ",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await call("/projects/" + target.id)).tasks.filter(
            (t: any) => t.sourceTaskId === source.id,
          ).length,
      )
      .toBeGreaterThan(previousCount);
    task = (await call("/projects/" + target.id)).tasks
      .filter((t: any) => t.sourceTaskId === source.id)
      .at(-1);
    await page.screenshot({
      path: resolve(out, "specification-reviewing.png"),
    });
  } else
    task = initial.tasks.find(
      (t: any) => t.id === initial.project.specificationArtifact.taskId,
    );
  const deadline = Date.now() + 180000;
  let detail: any,
    review: any,
    last = "";
  while (Date.now() < deadline) {
    detail = await call("/projects/" + target.id);
    task = detail.tasks.find((t: any) => t.id === task.id);
    review = detail.resultReviews.find((r: any) => r.id === task.reviewId);
    if (task.status !== last) {
      console.log(
        "Specification: " +
          task.status +
          "; orchestrator: " +
          (review?.status || "pending"),
      );
      last = task.status;
    }
    if (["succeeded", "failed", "blocked", "cancelled"].includes(task.status))
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  writeFileSync(
    resolve(out, "orchestrator-live-review.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projectId: target.id,
        sourceTaskId: source.id,
        taskId: task.id,
        review,
        taskStatus: task.status,
        error: task.error,
      },
      null,
      2,
    ),
  );
  assert.equal(task.status, "succeeded", task.error);
  assert.equal(review.status, "accepted");
  assert.ok(review.appliedAt);
  assert.ok(review.threadId && review.turnId);
  assert.equal(
    task.threadId,
    null,
    "Recovery must not generate a new specification",
  );
  assert.equal(detail.project.specification, actual);
  assert.equal(detail.project.specificationArtifact.hash, hash(actual));
  assert.equal(
    detail.project.approvals.specification,
    initial.project.approvals.specification,
  );
  assert.deepEqual(
    {
      revision: detail.project.revision,
      selectedStyle: detail.project.selectedStyle,
      studioId: detail.project.studioId,
      concept: detail.project.approvals.concept,
      style: detail.project.approvals.style,
      commandIds: detail.commands.map((c: any) => c.id),
    },
    before,
  );
  await page.reload();
  await openSpecification();
  const article = page.getByRole("article", {
    name: "Полный документ спецификации",
    exact: true,
  });
  await expect(article).toBeVisible();
  await expect(
    page.getByText("Проверено оркестратором", { exact: true }),
  ).toBeVisible();
  const rendered = await article.innerText();
  assert.ok(rendered.length > 10000);
  for (const id of REQUIRED_CHECKS)
    assert.ok(rendered.includes(id), "Missing acceptance criterion: " + id);
  if (previousSummary !== actual)
    assert.equal(
      await page.getByText(previousSummary, { exact: true }).count(),
      0,
    );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать SPEC.md", exact: true })
    .click();
  assert.equal(
    readFileSync((await (await downloaded).path())!, "utf8"),
    actual,
  );
  await page
    .locator(".toast")
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  await page.screenshot({ path: resolve(out, "specification-result.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile document overflows",
  );
  await page.screenshot({
    path: resolve(out, "specification-result-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "План и агенты", exact: true })
    .click();
  const row = page
    .locator(".task-list article")
    .filter({ has: page.getByText(task.title, { exact: true }) })
    .filter({ has: page.locator(".badge.succeeded") });
  await row
    .getByText("Проверка оркестратора · Оркестратор принял результат", {
      exact: true,
    })
    .click();
  if (await page.locator(".toast").count())
    await page
      .locator(".toast")
      .getByRole("button", { name: "Закрыть", exact: true })
      .click();
  await row.screenshot({ path: resolve(out, "orchestrator-history.png") });
  const afterState = await call("/state");
  for (const p of state.projects.filter((p: any) => p.id !== target.id)) {
    const current = afterState.projects.find((q: any) => q.id === p.id);
    assert.equal(current.specification, p.specification);
    assert.equal(current.selectedStyle, p.selectedStyle);
    assert.equal(current.studioId, p.studioId);
    assert.deepEqual(current.approvals, p.approvals);
    assert.equal(current.revision, p.revision);
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(out, "orchestrator-flow.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projectId: target.id,
        sourceTaskId: source.id,
        taskId: task.id,
        reviewId: review.id,
        reviewerThreadId: review.threadId,
        candidateHash: review.candidateHash,
        completeDocumentCharacters: actual.length,
        acceptanceChecks: REQUIRED_CHECKS,
        approvalGranted: false,
        newGenerationTurns: 0,
        newStudioCommands: 0,
        sourcePreserved: true,
        downloadMatchesDocument: true,
        reloadPreservesDocument: true,
        viewports: ["1440x1060", "390x844"],
        unchangedOtherProjects: state.projects
          .filter((p: any) => p.id !== target.id)
          .map((p: any) => p.id),
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Verified: real orchestrator acceptance → full stored SPEC.md → readable document → matching download and reload, without regeneration or Studio commands.",
  );
} finally {
  await browser.close();
}

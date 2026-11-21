import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
import {
  SKILL_VALIDATION_CHECKS,
  SKILL_VALIDATION_PROFILE,
  SKILL_VALIDATION_PROMPT,
  skillValidationReportPath,
} from "../shared/skill-validation.js";

const root = resolve(import.meta.dirname, ".."),
  reportPath = resolve(root, "docs/verification/sypho-workshop.json"),
  base = "http://127.0.0.1:4317/api",
  expectedVersion =
    "5aad881d1e6553cc3671ad549fdf01b8191bdc37-workshop.1",
  packageIds = [
    "sypho-roblox-map",
    "sypho-roblox-sfx",
    "sypho-roblox-ui-tools",
  ];

function safeFile(workspace: string, relativeFile: string) {
  if (!relativeFile || isAbsolute(relativeFile))
    throw new Error("Путь отчёта должен быть относительным к workspace");
  const basePath = realpathSync(workspace),
    target = resolve(basePath, relativeFile),
    rel = relative(basePath, target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Путь отчёта выходит за корень task workspace");
  const actual = realpathSync(target), actualRel = relative(basePath, actual);
  if (actualRel === ".." || actualRel.startsWith(".." + sep) || isAbsolute(actualRel))
    throw new Error("Отчёт через ссылку покидает корень task workspace");
  return actual;
}

const store = new Store(resolve(root, "data"));
let token: string | null;
try {
  token = await new Vault(store).get("dashboard-token");
} finally {
  store.close();
}
if (!token) throw new Error("В Vault отсутствует dashboard-token");
const call = async (path: string, method = "GET", body?: unknown) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error(data.error || `API ${response.status}`);
  return data;
};

const args = process.argv.slice(2),
  mode = args[0],
  projectId = mode === "--start" ? args[1] : undefined;
if (mode === "--start") {
  if (!projectId) throw new Error("Использование: --start PROJECT_ID");
  let previous: any;
  if (existsSync(reportPath)) {
    previous = JSON.parse(readFileSync(reportPath, "utf8"));
    if (previous.taskId && previous.projectId) {
      const old = await call("/projects/" + encodeURIComponent(previous.projectId));
      const priorTask = old.tasks.find((t: any) => t.id === previous.taskId);
      if (priorTask && ["planned", "dependencies", "queued", "running", "reviewing", "verifying"].includes(priorTask.status))
        throw new Error(`Задача ${priorTask.id} ещё активна (${priorTask.status}); report не перезаписан`);
    }
  }
  const state = await call("/state");
  const codexReady =
    state.codex?.connected === true &&
    state.codex?.account?.account?.type === "chatgpt" &&
    Array.isArray(state.codex?.models) &&
    state.codex.models.length > 0;
  if (!codexReady)
    throw new Error(
      "Сервис мастерской ещё не готов: дождитесь подключения Codex, аккаунта ChatGPT и загрузки моделей, затем повторно запустите --start вручную. Автоматического повтора нет.",
    );
  const detail = await call("/projects/" + encodeURIComponent(projectId)),
    project = detail.project;
  if (!project) throw new Error("Проект не найден");
  const active = detail.tasks.filter((t: any) => t.status === "running").map((t: any) => ({ projectId, taskId: t.id, status: t.status }));
  if (active.length) throw new Error("У проекта уже есть активная задача: " + JSON.stringify(active));
  const studio = state.studios.find((s: any) => s.id === project.studioId);
  if (!studio || studio.projectId !== projectId || studio.stopped || studio.playMode || Date.now() - Date.parse(studio.lastSeen) > 15000)
    throw new Error("Нужна свежая live bound Studio в остановленном режиме");
  const approvals = ["concept", "style", "specification", "budget"];
  const missingApprovals = approvals.filter((name) => !project.approvals?.[name] || (name === "budget" && project.budget?.approved !== true));
  if (missingApprovals.length) throw new Error("Не хватает согласований: " + missingApprovals.join(", "));
  const skills = packageIds.map((id) => {
    const skill = state.skills.find((s: any) => s.id === id),
      pin = project.skillPins?.[id];
    if (!skill || !["reviewed", "connected"].includes(skill.status) || !skill.checkedAt)
      throw new Error(`Навык ${id} должен иметь reviewed/connected статус и checkedAt`);
    if (skill.version !== expectedVersion) throw new Error(`Непредусмотренная версия ${id}: ${skill.version}`);
    if (!pin || pin !== skill.hash) throw new Error(`Проект не закрепил текущий hash навыка ${id}`);
    return { id, version: skill.version, hash: skill.hash, status: skill.status };
  });
  const startedAt = new Date().toISOString(),
    started = await call(`/projects/${encodeURIComponent(projectId)}/skills/validate`, "POST", {}),
    task = started.task || started;
  if (!task.id) throw new Error("POST /skills/validate не вернул taskId");
  if (task.validationProfile !== SKILL_VALIDATION_PROFILE)
    throw new Error("Сервер не создал задачу с ожидаемым validationProfile; запуска не повторяйте автоматически");
  const afterStart = await call("/projects/" + encodeURIComponent(projectId)),
    launchNative = afterStart.nativeSession?.taskId === task.id ? afterStart.nativeSession : null,
    verificationReportPath = skillValidationReportPath(task.id),
    report = {
      taskId: task.id,
      projectId,
      startedAt,
      commit: expectedVersion,
      skills,
      validationProfile: task.validationProfile,
      verificationReportPath,
      launchWorkspace: launchNative?.workspace || null,
    };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
} else if (mode === "--inspect") {
  let validationReportRel: string | undefined,
    reportOptionSeen = false;
  for (let index = 1; index < args.length; index++) {
    if (args[index] !== "--report" || !args[index + 1])
      throw new Error("Использование: --inspect [--report <relative-path>]");
    if (reportOptionSeen) throw new Error("Опция --report указана более одного раза");
    reportOptionSeen = true;
    validationReportRel = args[++index];
  }
  if (!existsSync(reportPath)) throw new Error("Нет docs/verification/sypho-workshop.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8")),
    detail = await call("/projects/" + encodeURIComponent(report.projectId)),
    task = detail.tasks.find((t: any) => t.id === report.taskId);
  if (!task) throw new Error("Задача из report не найдена в project detail");
  const skillProfile = report.validationProfile === SKILL_VALIDATION_PROFILE || task.validationProfile === SKILL_VALIDATION_PROFILE;
  if (skillProfile && reportOptionSeen && validationReportRel !== skillValidationReportPath(task.id))
    throw new Error("Для Sypho profile отчёт выбирается только по taskId; --report оставлен для прежних задач");
  validationReportRel ||= report.validationReportPath || (skillProfile ? skillValidationReportPath(task.id) : "reports/sypho-validation.json");
  const native = detail.nativeSession,
    workspace = task.result?.data?.skillValidation?.workspace || report.launchWorkspace || (native?.taskId === task.id ? native.workspace : null),
    tracePath = resolve(root, "data/native-runs", task.id, "tools.jsonl");
  let trace: any[] = [];
  if (existsSync(tracePath)) trace = readFileSync(tracePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const shellTrace = trace.filter((r) => /shell/i.test(r.tool || ""));
  const traceSummary = { records: trace.length, shellCalls: shellTrace.length, lastTools: trace.slice(-12).map((r) => ({ tool: r.tool, success: r.success, exitCode: r.exitCode ?? r.result?.exitCode ?? null })) };
  const activeStatuses = ["planned", "dependencies", "queued", "running", "reviewing", "verifying"];
  const reportCandidate = workspace ? resolve(workspace, validationReportRel) : null;
  if (activeStatuses.includes(task.status) && (!reportCandidate || !existsSync(reportCandidate))) {
    console.log(JSON.stringify({ taskId: task.id, status: task.status, nativeStatus: native?.status || null, workspace, trace: traceSummary }, null, 2));
  } else {
    if (!workspace || !existsSync(workspace)) throw new Error("Завершённая задача не имеет доступного nativeSession.workspace");
    const validationPath = safeFile(workspace, validationReportRel),
      validation = JSON.parse(readFileSync(validationPath, "utf8")),
      validationMtime = statSync(validationPath).mtimeMs;
    const namedEvidence = [
      validation.markdownPath,
      validation.mapPath,
      validation.pngPath,
      validation.imagePath,
    ].filter((file: unknown): file is string => typeof file === "string");
    const evidence = namedEvidence.length
      ? namedEvidence
      : ["reports/sypho-validation.md", "reports/sypho-validation.png"];
    const evidenceFiles = evidence
      .filter((file: string) => file.startsWith("reports/") && existsSync(resolve(workspace, file)))
      .map((file: string) => ({ path: file, absolutePath: safeFile(workspace, file) }));
    const legacyChecks = ["map-selftest", "terrain-selftest", "unreachable-check", "sfx-search", "sfx-probe", "sfx-cleanup", "sfx-bank", "ui-selftest", "touch-fit-positive", "touch-fit-negative", "labels-positive", "labels-negative", "hud-desktop-mobile", "five-captures", "existing-assets", "delivery"],
      requiredChecks = skillProfile ? SKILL_VALIDATION_CHECKS : legacyChecks,
      checks = Array.isArray(validation.checks) ? validation.checks : [],
      checkById = new Map(checks.map((check: any) => [check.id, check.status])),
      missingChecks = requiredChecks.filter((id) => checkById.get(id) !== "passed"),
      freshnessIssues = [
        !report.startedAt || !Number.isFinite(Date.parse(report.startedAt))
          ? "launch report has no valid startedAt"
          : validationMtime < Date.parse(report.startedAt)
            ? "validation report mtime predates startedAt"
            : null,
        skillProfile && validation.profile !== SKILL_VALIDATION_PROFILE
          ? `validation profile is missing or is not ${SKILL_VALIDATION_PROFILE}`
          : null,
        skillProfile && task.validationProfile !== SKILL_VALIDATION_PROFILE
          ? "task validationProfile does not match the Sypho profile"
          : null,
        skillProfile && !validation.taskId
          ? "validation report has no required taskId"
          : validation.taskId && validation.taskId !== task.id
            ? "validation taskId does not match the launched task"
            : null,
        !Number.isInteger(validation.attempt)
          ? "validation report has no integer attempt"
          : validation.attempt !== task.attempt
            ? `validation attempt ${validation.attempt} does not match current task attempt ${task.attempt}`
            : null,
      ].filter(Boolean),
      gatesPassed = validation.status === "passed" && missingChecks.length === 0,
      validationBlocked = freshnessIssues.length > 0,
      taskActive = activeStatuses.includes(task.status),
      overallStatus = validationBlocked
        ? "blocked"
        : taskActive
          ? "pending"
          : task.status === "succeeded" && gatesPassed
            ? "passed"
            : task.status === "blocked" || validation.status === "blocked" || checks.some((check: any) => check.status === "blocked")
              ? "blocked"
              : "failed";
    const final = { ...report, ...(taskActive ? {} : { completedAt: new Date().toISOString() }), status: overallStatus, taskStatus: task.status, validationReportPath: validationReportRel, validation: { status: validationBlocked ? "blocked" : validation.status || null, taskId: validation.taskId || null, attempt: validation.attempt ?? null, mtime: new Date(validationMtime).toISOString(), freshnessIssues, gatesPassed: !validationBlocked && gatesPassed, checks: checks.map((check: any) => ({ id: check.id, status: check.status })), missingChecks, commands: validation.commands || [], title: validation.title || null }, trace: { ...traceSummary, shellCalls: validation.commands?.length ?? shellTrace.length }, evidenceFiles };
    writeFileSync(reportPath, JSON.stringify(final, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(final, null, 2));
  }
} else {
  throw new Error("Режим: --start PROJECT_ID | --inspect [--report <relative-path>]");
}

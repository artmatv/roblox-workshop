export const MOTION_VALIDATION_PROFILE = "sypho-motion" as const;

export const MOTION_VALIDATION_SKILLS = [
  "sypho-roblox-animation",
  "sypho-roblox-3d-model",
  "sypho-roblox-vfx",
] as const;

export const MOTION_VALIDATION_CHECKS = [
  "pins-and-resources",
  "animation-export",
  "animation-live",
  "glb-measure",
  "mesh-live",
  "vfx-selftest",
  "vfx-negative",
  "vfx-export",
  "vfx-live",
  "preview-captures",
  "probe-cleanup",
  "scene-preserved",
  "blender-runtime",
  "blender-mesh-pipeline",
  "blender-texture-pipeline",
  "blender-animation-render",
] as const;

export const MOTION_VALIDATION_CAPTURE_IDS = [
  "animation-rest",
  "animation-action",
  "mesh-preview",
  "vfx-preview",
] as const;

export function motionValidationExportPaths(taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error("Invalid motion task ID");
  const root = `reports/sypho-motion-${taskId}/exports`;
  return { animationPath: `${root}/animation.luau`, meshPath: `${root}/mesh.glb`, vfxPath: `${root}/vfx.lua` };
}

export const MOTION_VALIDATION_PROMPT = `Проведи ограниченную диагностику трёх закреплённых навыков Sypho: Roblox animation, 3D model и VFX. Не меняй и не сохраняй игру, не публикуй её, не покупай и не подключай платные сервисы. Все артефакты и отчёты размещай только в своей рабочей папке задачи. Работай офлайн; не устанавливай пакеты и не обращайся к сети.

Прочитай skills/ACTIVE.json и используй только закреплённые записи, их фактические roots и files[].path. Host уже скопировал task-local fixture-файлы в validation-inputs/motion; читай их, не изменяя fixtures. Запусти имеющиеся локальные скрипты проверки/экспорта с абсолютными путями внутри workspace и запиши команды, exit codes, версии и sha256. Запиши экспортированные файлы в reports/sypho-motion-<taskId>/exports/animation.luau, mesh.glb и vfx.lua. Host проверит их полные байты и canonical hashes перед запуском Studio; не дописывай код и не подменяй артефакты.

У PowerShell фактический cwd может быть C:/ даже если в журнале указан workspace, поэтому во всех shell-командах передавай абсолютные пути к scripts, fixtures и outputs; никогда не полагайся на cwd или относительные пути. Обычные Python-утилиты запускай подтверждённым системным Python 3.12 по пути C:/Python312/python.exe с флагом -B. Не используй Python, встроенный в Blender (например, Blender 5.2/5.2/python/bin/python.exe), и не запускай его с task-local PYTHONPATH: ABI пакетов несовместим.

Для анимации запусти ACTIVE animation root/resources/scripts/to_roblox.py системным Python 3.12 с абсолютными путями к скрипту, fixture validation-inputs/motion/animation.json и output reports/sypho-motion-<taskId>/exports/animation.luau. Передай точные аргументы --folder ReplicatedStorage.__SyphoMotionDiagnostic_Anims --no-verify. Сохрани stdout без изменения в UTF-8 без BOM в animation.luau. Не меняй имя папки и не убирай --no-verify. Для GLB скопируй байты validation-inputs/motion/mesh.glb в reports/sypho-motion-<taskId>/exports/mesh.glb, затем запусти ACTIVE 3D root/resources/scripts/glb_tool.py системным Python 3.12 с аргументами measure --glb <абсолютный путь к mesh.glb> --json; зафиксируй размеры, вершины и треугольники.

Перед запуском зафиксируй состояние сцены фиксированным workshop.validation_control({action:'before'}). Выполни только фиксированные workshop.motion_probe actions: create({animationPath,meshPath,vfxPath}), pose_rest, pose_action, mesh_sample, vfx, cleanup. Сразу после каждого pose/mesh/vfx action сними соответствующий кадр с camera_position/look_at_position из его результата. Пути create должны точно соответствовать указанным exports файлам; эти host actions принимают лишь готовые task-local artifact paths, никогда исходный Luau от пользователя. Проверяй реальное изменение суставов AnimationConstraint или legacy Motor6D во время AnimationTrack, реальный MeshPart из экспортированного GLB с ненулевой геометрией/треугольниками и фактический ParticleEmitter с Emit; не принимай constant/mock JSON за доказательство. Все временные объекты должны быть привязаны к taskId/attempt и удалены cleanup. Работай в Play; не применяй изменения в Edit и не запускай произвольный execute_luau.

Сними четыре свежих настоящих кадра Studio: animation-rest, animation-action, mesh-preview, vfx-preview. Каждый кадр должен показывать соответствующий реальный probe. После cleanup останови Play и вызови validation_control({action:'after'}); зафиксируй совпадение scene fingerprint. На ошибке честно укажи failed/blocked.

Выполни ровно четыре точные команды из validation-inputs/dcc/attempt-<attempt>/commands.json в указанном порядке через обычный sandbox shell. В PowerShell открывается C:/ независимо от cwd из метаданных, поэтому открой этот JSON по абсолютному пути внутри workspace и запускай каждую записанную команду без изменений; для каждой команды и каждого poll запроса указывай max_output_tokens не меньше 12000. Не добавляй prefix/suffix-команды, не запускай другие DCC scripts и не удаляй результаты. Это task-local копия установленного Blender, без сети и автозапуска скриптов. В report.json укажи только краткие сведения о команде/action, exit code, native item IDs и проверяемые счётчики/хеши артефактов; не копируй туда полный stdout/stderr или raw journal. Host сохраняет полные stdout/stderr и записи команд в закрытом локальном журнале. Runtime должен подтвердить Blender 5.2.3, mesh 19/19, texture 9/9, animation — минимум два разных декодированных кадра. Команды производят артефакты в фиксированных уникальных каталогах текущей attempt. Сервер сверит фактические completed command-записи текущего turn с точным планом и перепроверит хеши исходников/результатов; JSON-отчёт сам по себе доказательством не является. Если фактический вывод команды был усечён и ты не можешь проверить её результат, явно укажи blocked.

Сохрани reports/sypho-motion-<taskId>/report.json с taskId, attempt, profile='sypho-motion', status='passed' и checks — массивом ровно из 16 уникальных ID: pins-and-resources, animation-export, animation-live, glb-measure, mesh-live, vfx-selftest, vfx-negative, vfx-export, vfx-live, preview-captures, probe-cleanup, scene-preserved, blender-runtime, blender-mesh-pipeline, blender-texture-pipeline, blender-animation-render. Каждый check содержит evidence. Успех разрешён только при фактическом host ledger evidence для всех live checks, фактических completed native command records для четырёх DCC checks, четырёх требуемых свежих кадров, cleanup и подтверждённом совпадении сцены.`;

export function motionValidationReportPath(taskId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId))
    throw new Error("Нужен корректный UUID taskId для motion validation report path");
  return `reports/sypho-motion-${taskId}/report.json`;
}

export function assertMotionValidationReport(report: any, task: { id: string; attempt: number }) {
  if (
    report?.taskId !== task.id ||
    report?.attempt !== task.attempt ||
    report?.profile !== MOTION_VALIDATION_PROFILE ||
    report?.status !== "passed" ||
    !Array.isArray(report.checks) ||
    report.checks.length !== MOTION_VALIDATION_CHECKS.length
  ) throw new Error("Отчёт не соответствует текущей задаче motion validation");
  const ids = report.checks.map((check: any) => check?.id);
  if (
    new Set(ids).size !== MOTION_VALIDATION_CHECKS.length ||
    MOTION_VALIDATION_CHECKS.some((id) => !ids.includes(id)) ||
    report.checks.some((check: any) => check.status !== "passed" || check.evidence == null)
  ) throw new Error("Не пройдены все уникальные gates motion validation");
}

export function assertMotionValidationEvidence(records: any[], task: { id: string; attempt: number }) {
  const current = records.filter((r) => r.taskId === task.id && r.attempt === task.attempt && r.success);
  const probe = current.filter((r) => r.tool === "motion_probe" && r.result?.profile === MOTION_VALIDATION_PROFILE && r.result?.taskId === task.id && r.result?.attempt === task.attempt);
  const action = (name: string) => probe.find((r) => r.arguments?.action === name)?.result;
  for (const name of ["create", "pose_rest", "pose_action", "mesh_sample", "vfx", "cleanup"])
    if (!action(name)) throw new Error(`Нет host evidence для motion_probe ${name}`);
  const create = action("create"), rest = action("pose_rest"), moved = action("pose_action"), mesh = action("mesh_sample"), vfx = action("vfx"), cleanup = action("cleanup");
  const expectedPaths = motionValidationExportPaths(task.id);
  const createRecord = probe.find((r) => r.arguments?.action === "create");
  if (!(create?.verifiedArtifacts === true && ["animation", "mesh", "vfx"].every((key) => /^[a-f0-9]{64}$/.test(create.trustedExports?.[key]?.sha256 || "")) &&
    createRecord?.arguments?.animationPath === expectedPaths.animationPath && createRecord?.arguments?.meshPath === expectedPaths.meshPath && createRecord?.arguments?.vfxPath === expectedPaths.vfxPath))
    throw new Error("Host не подтвердил целые доверенные экспортированные артефакты");
  if (!(rest?.trackPlaying === true && moved?.trackPlaying === true && moved?.jointChanged === true))
    throw new Error("Animation probe не подтвердил реальное движение суставов");
  if (!(mesh?.className === "MeshPart" && mesh?.vertexCount > 0 && mesh?.triangleCount > 0))
    throw new Error("Mesh probe не подтвердил реальную геометрию MeshPart");
  if (!(vfx?.emitterClass === "ParticleEmitter" && vfx?.emitted === true && vfx?.propertiesVerified === true))
    throw new Error("VFX probe не подтвердил ParticleEmitter и Emit");
  if (!(cleanup?.removed === true && cleanup?.verifiedAbsent === true && cleanup?.studioMode === "Play" && Array.isArray(cleanup.remaining) && cleanup.remaining.length === 0))
    throw new Error("Временные motion probe объекты не очищены");
  const at = (tool: string, name: string) => current.findIndex((r) => r.tool === tool && r.arguments?.action === name);
  const stopAt = current.findIndex((r) => r.tool === "start_stop_play" && r.success && r.arguments?.is_start === false);
  const startAt = current.findIndex((r) => r.tool === "start_stop_play" && r.success && r.arguments?.is_start === true && r.ownedStart === true && r.playModeBefore === "Edit" && r.playModeAfter === "Play");
  if (!(at("validation_control", "before") < startAt && startAt < at("motion_probe", "create") &&
    at("motion_probe", "create") < at("motion_probe", "pose_rest") &&
    at("motion_probe", "pose_rest") < at("motion_probe", "pose_action") &&
    at("motion_probe", "pose_action") < at("motion_probe", "mesh_sample") &&
    at("motion_probe", "mesh_sample") < at("motion_probe", "vfx") &&
    at("motion_probe", "vfx") < at("motion_probe", "cleanup") &&
    at("motion_probe", "cleanup") < stopAt && current[stopAt]?.playModeBefore === "Play" && current[stopAt]?.playModeAfter === "Edit" &&
    stopAt < at("validation_control", "after")))
    throw new Error("Motion probe lifecycle выполнялся вне фиксированного порядка");
  const controls = current.filter((r) => r.tool === "validation_control" && r.result?.profile === MOTION_VALIDATION_PROFILE);
  const before = controls.find((r) => r.arguments?.action === "before")?.result;
  const after = controls.find((r) => r.arguments?.action === "after")?.result;
  if (!(before && after && before.fingerprint && before.fingerprint === after.fingerprint && before.count === after.count && after.scenePreserved === true))
    throw new Error("Не подтверждено сохранение исходной сцены");
  const captures = new Set(current.filter((r) => r.tool === "screen_capture" && r.captures?.length).map((r) => r.arguments?.capture_id));
  for (const capture of MOTION_VALIDATION_CAPTURE_IDS) if (!captures.has(capture)) throw new Error(`Нет свежего Studio кадра ${capture}`);
  assertMotionBlenderEvidence(records, task);
  const phases = [
    ["animation-rest", "pose_rest", "pose_action"],
    ["animation-action", "pose_action", "mesh_sample"],
    ["mesh-preview", "mesh_sample", "vfx"],
    ["vfx-preview", "vfx", "cleanup"],
  ] as const;
  for (const [captureId, actionBefore, actionAfter] of phases) {
    const beforeIndex = at("motion_probe", actionBefore), afterIndex = at("motion_probe", actionAfter);
    const captureIndex = current.findIndex((r) => r.tool === "screen_capture" && r.success && r.taskId === task.id && r.attempt === task.attempt && r.arguments?.capture_id === captureId && r.captures?.length);
    const actionResult = action(actionBefore);
    const capture = current[captureIndex];
    const expected = actionResult?.frame;
    if (!(beforeIndex >= 0 && captureIndex > beforeIndex && captureIndex < afterIndex &&
      JSON.stringify(capture?.arguments?.camera_position) === JSON.stringify(expected?.cameraPosition) &&
      JSON.stringify(capture?.arguments?.look_at_position) === JSON.stringify(expected?.lookAtPosition ?? expected?.cameraTarget)))
      throw new Error(`Кадр ${captureId} должен быть снят в своем live-phase с фиксированной камерой`);
  }
}

export function assertMotionBlenderEvidence(records: any[], task: { id: string; attempt: number }) {
  const actions = ["runtime", "mesh", "texture", "animation"];
  let lastIndex = -1;
  for (const action of actions) {
    const index = records.findIndex((r) => r.tool === "blender_command" && r.success && r.taskId === task.id && r.attempt === task.attempt && r.arguments?.action === action && r.result?.action === action && r.result?.status === "passed" && r.result?.exitCode === 0 && typeof r.result?.version === "string" && /^[a-f0-9]{64}$/.test(r.result?.sourceSha256 || "") && /^[a-f0-9]{64}$/.test(r.result?.outputSha256 || "") && Array.isArray(r.result?.outputs) && r.result.outputs.length > 0 && r.result.processId != null);
    if (index <= lastIndex) throw new Error(`Нет подтверждённой завершённой Blender команды ${action}`);
    lastIndex = index;
  }
}

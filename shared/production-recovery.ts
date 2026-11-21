import type { Project, Task } from "./domain.js";
export function productionRepairSources(
  project: Project,
  tasks: Task[],
): Task[] {
  const required = new Set(
    tasks
      .filter(
        (t) =>
          t.kind === "build" &&
          t.baseRevision === project.revision &&
          ["queued", "dependencies"].includes(t.status),
      )
      .flatMap((t) => t.dependencies),
  );
  return tasks.filter(
    (t) =>
      required.has(t.id) &&
      t.projectId === project.id &&
      t.baseRevision === project.revision &&
      t.provider === "codex" &&
      !t.supersededByTaskId &&
      ["gameplay", "ui", "assets", "integration"].includes(t.kind) &&
      ["failed", "blocked"].includes(t.status) &&
      t.attempt >= t.maxAttempts &&
      t.error?.startsWith("Результат не принят:"),
  );
}
export const ROLE_DELIVERY_RULES: Record<string, string> = {
  gameplay:
    "Ты отвечаешь только за серверную логику, протокол, сохранения и покупки в ServerScriptService/ReplicatedStorage. Не реализуй чужие UI и статический мир. Для требуемых объектов мира и UI опиши точный data.integrationContract с путями, событиями и форматом сообщений: их создают следующие исполнители. Отдельные модульные тесты можно вернуть в files, исполняемый QA в ServerStorage готовит агент qa. Исправь реальные дефекты своей логики и тестов. Не маскируй отсутствие чужих результатов обещаниями, но не создавай их за других исполнителей.",
  ui: "Ты отвечаешь за интерфейс и клиентское управление только в StarterGui/StarterPlayer. Используй принятый серверный контракт из dependencies. Не переписывай сервер и сцену. Исправляй свои UI-дефекты, включая постоянно доступное основное действие на узком landscape, навигацию, safe area и локализацию. Для недостающих внешних объектов опиши data.integrationContract, не выходи за scope.",
  assets:
    "Ты отвечаешь только за мир, геометрию, освещение и звук в Workspace/Lighting/SoundService. Реализуй объекты по серверному контракту dependencies и стилю. Не создавай клиентский интерфейс, сохранения, покупки и тестовый стенд других ролей в обход scope через integration-файлы. Удали такие чужие реализации из возвращаемого кандидата; сохрани собственные ресурсы и точный data.integrationContract.",
};

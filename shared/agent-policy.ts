import type { Project, Task } from "./domain.js";

export const SPECIALIST_POLICY = "sol-luna-astra-v1";
// Sol/Luna/Astra are roles; each agent backend maps them to its own models.
export const AGENT_MODELS = {
  codex: {
    owner: "gpt-6.1-sol",
    coder: "gpt-6-luna",
    architect: "gpt-6-astra",
  },
  claude: {
    owner: "claude-opus-5-5",
    coder: "claude-sonnet-5-5",
    architect: "claude-opus-5-5",
  },
} as const;
export const SIMPLE_DEVELOPMENT_RULES = `KISS/YAGNI: выполняй запрошенную задачу минимальным понятным изменением. Используй существующий код и один основной путь исполнения. Не добавляй новые фреймворки, абстракции, альтернативные реализации, тестовые среды, резервные копии, ветки/worktree или формальные этапы без конкретной необходимости. Сохранение игровых данных и результата работы обязательно. Короткая задача требует короткого ТЗ и конкретных критериев приёмки. Проверяй затронутое поведение существующими подходящими проверками; не дублируй проверки. Тесты не доказывают художественное качество. Перед существенной сменой архитектуры нужен независимый разбор другой моделью; обычной локальной правке новый архитектурный этап не нужен.`;
export const SPECIALIST_INSTRUCTIONS = `Ты ведущий Sol 6.1 Medium. Ты составляешь конкретное ТЗ, принимаешь результат и единолично изменяешь живую Studio. Для ограниченных подзадач используй ask_specialist: coder — Luna Medium, код по ТЗ и списку локальных файлов; architect — Astra Medium, только проектирование и независимая проверка архитектуры, без программных исходников; reviewer — Sol Medium, независимая приёмка по конкретным критериям. Помощники изолированы от Studio, shell и сети. Укажи цель, разрешённые файлы, существующий контракт и проверяемый результат. Специалист не принимает собственную работу: прочитай его результат, проверь соответствие ТЗ и только затем применяй в Studio. Запрос к помощнику нужен только для содержательной подзадачи, не для каждой строки. Не запускай встроенные collab/subagent: они наследуют инструменты Studio. Максимум один помощник одновременно; не повышай effort автоматически после ошибки. Сначала уточни конкретную причину. Astra нельзя назначать coding, исправление или генерацию исходников. Внешняя проверка владельцем и настоящие кадры Studio сохраняются.`;
export function usesSpecialists(project: Pick<Project, "settings">) {
  return project.settings.agentPolicy === SPECIALIST_POLICY;
}
export function specialistProfile(
  task: Pick<Task, "role" | "kind">,
  reviewer = false,
  backend: keyof typeof AGENT_MODELS = "codex",
) {
  const models = AGENT_MODELS[backend];
  const owner =
    reviewer ||
    task.kind === "studio-development" ||
    ["orchestrator", "designer", "researcher"].includes(task.role);
  return {
    model: owner ? models.owner : models.coder,
    effort: "medium" as const,
    reason: owner
      ? "Sol: постановка и приёмка, фиксированный Medium"
      : "Luna: исполнение по ТЗ, фиксированный Medium",
  };
}
export function assertModelRole(
  model: string,
  task: Pick<Task, "kind">,
  reviewer: boolean,
) {
  if (
    /astra/i.test(model) &&
    !reviewer &&
    !["specification", "production-plan", "architecture", "design"].includes(
      task.kind,
    )
  )
    throw new Error(
      "Astra разрешена только для проектирования; недоступна для разработки, выберите Sol или Luna",
    );
}

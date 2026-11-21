import type { Role, Task } from "./domain.js";

export const EFFORT_POLICY_VERSION = "role-effort-v1";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof EFFORTS)[number];
export type EffortClass = "routine" | "standard" | "complex" | "diagnostic";
export interface EffortPlan {
  effort: ReasoningEffort;
  reason: string;
}
export interface EffortRun extends EffortPlan {
  requestedEffort: ReasoningEffort;
  model: string;
  at: string;
  turnId: string;
  attempt: number;
}
export const ROLE_EFFORT: Record<Role, ReasoningEffort> = {
  researcher: "medium",
  designer: "high",
  art: "medium",
  gameplay: "high",
  ui: "high",
  assets: "medium",
  qa: "high",
  orchestrator: "high",
};

// Only semantic reviewer rejections are counted, never transport/schema failures.
export function planEffort(
  task: Task,
  rejections = 0,
  reviewer = false,
): EffortPlan | null {
  if (!reviewer && task.provider === "studio") return null;
  if (!reviewer && task.effortOverride) {
    if (task.effortOverride === "low" && task.effortClass !== "routine")
      throw new Error(
        "Уровень low доступен только для небольшой точной задачи",
      );
    if (
      task.effortOverride === "max" &&
      (task.effortClass !== "diagnostic" ||
        !(task.effortOverrideReason || "").trim() ||
        !task.effortHistory?.some((run) => run.effort === "xhigh"))
    )
      throw new Error(
        "Уровень max требует диагностической задачи, причины и предыдущего запуска xhigh",
      );
    return {
      effort: task.effortOverride,
      reason: "Ручной выбор: " + task.effortOverrideReason,
    };
  }
  const base = reviewer
    ? ROLE_EFFORT.orchestrator
    : task.effortClass === "routine"
      ? "low"
      : ROLE_EFFORT[task.role];
  const complexity = ["complex", "diagnostic"].includes(task.effortClass || "")
    ? 1
    : 0;
  const steps = Math.max(0, Math.floor(rejections)) + complexity;
  return {
    effort: EFFORTS[Math.min(3, EFFORTS.indexOf(base) + steps)],
    reason: [
      reviewer
        ? "Проверка оркестратора"
        : task.effortClass === "routine"
          ? "Небольшая точная задача"
          : "Базовый уровень роли",
      ...(complexity ? ["Повышенная сложность"] : []),
      ...(rejections ? [`Содержательных отклонений: ${rejections}`] : []),
    ].join("; "),
  };
}

export interface EffortModel {
  id: string;
  model: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
}
export function supportedEffort(
  plan: EffortPlan,
  models: EffortModel[],
  selected: string | null,
) {
  const model = selected
    ? models.find((m) => m.model === selected || m.id === selected)
    : models.find((m) => m.isDefault);
  if (!model)
    throw new Error(
      "Недоступен каталог выбранной модели; обновите подключение ChatGPT",
    );
  const supported =
    model.supportedReasoningEfforts?.map((e) => e.reasoningEffort) || [];
  if (supported.includes(plan.effort)) return { ...plan, model: model.model };
  // Never silently exceed the selected effort or switch to max.
  const fallback = EFFORTS.slice(0, EFFORTS.indexOf(plan.effort))
    .reverse()
    .find((e) => supported.includes(e));
  if (!fallback || plan.effort === "max")
    throw new Error(
      `Уровень ${plan.effort} недоступен для модели ${model.model}`,
    );
  return {
    effort: fallback,
    model: model.model,
    reason: `${plan.reason}; модель поддерживает ${fallback} вместо ${plan.effort}`,
  };
}

import { z } from "zod";

// Production plan derived from the approved specification. Milestones are
// accepted one by one; architecture decisions hold across all milestones so an
// early milestone does not build something a later requirement must tear down.
const planId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/);
export const planItemSchema = z
  .object({
    id: planId,
    requirement: z.string().trim().min(5).max(600),
    area: z.enum(["world", "ui", "loop", "systems", "art"]),
    evidence: z.array(z.enum(["frame", "play", "test"])).min(1).max(3),
    specRef: z.string().trim().min(1).max(120),
  })
  .strict();
export const architectureDecisionSchema = z
  .object({
    id: planId,
    decision: z.string().trim().min(10).max(800),
    reason: z.string().trim().min(5).max(600),
    specRef: z.string().trim().min(1).max(120),
  })
  .strict();
export const productionPlanSchema = z
  .object({
    architecture: z.array(architectureDecisionSchema).max(30),
    milestones: z
      .array(
        z
          .object({
            id: planId,
            title: z.string().trim().min(3).max(120),
            goal: z.string().trim().min(10).max(1500),
            items: z.array(planItemSchema).min(1).max(60),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const ids = [
      ...plan.architecture.map((a) => a.id),
      ...plan.milestones.map((m) => m.id),
      ...plan.milestones.flatMap((m) => m.items.map((i) => i.id)),
    ];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id))
        ctx.addIssue({ code: "custom", message: `Повторный ID плана: ${id}` });
      seen.add(id);
    }
  });
export type ProductionPlan = z.infer<typeof productionPlanSchema>;
export type PlanMilestone = ProductionPlan["milestones"][number];
export type PlanItem = z.infer<typeof planItemSchema>;
export type ProductionProgress = {
  completed: {
    milestoneId: string;
    taskId: string;
    at: string;
    // Owner notes accepted with the milestone stay requirements afterwards.
    ownerNotes?: string[];
  }[];
};
export function acceptedOwnerItems(progress?: ProductionProgress): PlanItem[] {
  return (progress?.completed || []).flatMap((c) =>
    (c.ownerNotes || []).map((text, n) => ({
      id: `owner.${c.milestoneId}.${n + 1}`,
      requirement: "Требование владельца: " + text,
      area: "world" as const,
      evidence: ["frame" as const],
      specRef: "владелец",
    })),
  );
}

export const PRODUCTION_PLAN_CONTRACT = `data.productionPlan = {architecture:[{id,decision,reason,specRef}], milestones:[{id,title,goal,items:[{id,requirement,area:"world"|"ui"|"loop"|"systems"|"art",evidence:["frame"|"play"|"test"],specRef}]}]}. ID — латиница a-z0-9._- (2–64 символа) и уникальны во всём плане. Лимиты: до 12 этапов, до 60 пунктов в этапе, до 30 решений; requirement ≤600 символов (дели длинное требование на атомарные пункты), goal ≤1500, decision ≤800, reason ≤600, specRef ≤120, title ≤120. Этапы идут в порядке выполнения; каждый этап — законченный проверяемый результат в одной сцене Studio. Если ТЗ описывает мир или уровень, первый этап — полная планировка мира с отдельным пунктом на каждую обязательную зону, улицу, участок, маршрут и ориентир. Каждый обязательный пункт ТЗ (не только сценарии приёмки) попадает ровно в один этап; каждый requiredCheck покрыт хотя бы одним пунктом. architecture — сквозные решения, которые требуются более поздними пунктами, но должны соблюдаться с первого этапа (например, данные раскладки, стабильные ID, модульность, серверная авторитетность, сохранения), чтобы ранний результат не пришлось ломать. Последний этап включает финальную сверку всей игры с ТЗ.`;

export function completedMilestones(
  plan: ProductionPlan,
  progress?: ProductionProgress,
) {
  const done = new Set((progress?.completed || []).map((c) => c.milestoneId));
  return plan.milestones.filter((m) => done.has(m.id));
}
export function currentMilestone(
  plan: ProductionPlan,
  progress?: ProductionProgress,
) {
  const done = new Set((progress?.completed || []).map((c) => c.milestoneId));
  return plan.milestones.find((m) => !done.has(m.id));
}
const itemLines = (list: PlanItem[]) =>
  list
    .map(
      (i) =>
        `- [${i.id}] (${i.area}; доказательство: ${i.evidence.join("+")}; ${i.specRef}) ${i.requirement}`,
    )
    .join("\n");
// Items of the accepted milestones and the owner's notes accepted with them.
// The developer reads them from this workspace file: repeated in the task text
// of every attempt, the list was most of that text by the late milestones.
export const ACCEPTED_FILE = "ACCEPTED.md";
export function acceptedItems(
  plan: ProductionPlan,
  progress?: ProductionProgress,
): PlanItem[] {
  return [
    ...completedMilestones(plan, progress).flatMap((m) => m.items),
    ...acceptedOwnerItems(progress),
  ];
}
export function acceptedItemsText(
  plan: ProductionPlan,
  progress?: ProductionProgress,
) {
  return itemLines(acceptedItems(plan, progress));
}
// Plan items the workshop verifies by running the game's own test module in
// Play: every item that names "test" as evidence. The module lives in the
// scene; the same text in the workspace file lets check_delivery see coverage.
export const TESTS_MODULE = "ServerStorage/AutomationTests";
export const TESTS_FILE = "AutomationTests.luau";
// Checks per Play run: the installed plugin ends a run after 90 seconds.
export const TEST_BATCH = 8;
export function testItems(items: PlanItem[]) {
  return items.filter((i) => i.evidence.includes("test"));
}
export function milestoneInstruction(
  plan: ProductionPlan,
  milestone: PlanMilestone,
  progress?: ProductionProgress,
  tests = false,
) {
  const index = plan.milestones.indexOf(milestone) + 1;
  const prior = acceptedItems(plan, progress);
  const ownTests = testItems(milestone.items).map((i) => i.id);
  const priorTests = testItems(prior).length;
  return [
    `Этап ${index}/${plan.milestones.length} «${milestone.title}» по SPEC.md. Цель: ${milestone.goal}`,
    `Критерии приёмки этапа:\n${itemLines(milestone.items)}`,
    plan.architecture.length
      ? `Сквозные архитектурные решения (соблюдай уже сейчас, даже если функция появится на следующих этапах):\n${plan.architecture.map((a) => `- [${a.id}] ${a.decision} (${a.specRef}; почему: ${a.reason})`).join("\n")}`
      : "",
    prior.length
      ? `Принятые пункты прошлых этапов и принятые с ними решения владельца (${prior.length}) перечислены в файле ${ACCEPTED_FILE} рабочей папки. Прочитай его до начала работы: принятое не ломай, а решения владельца соблюдай и в новом содержимом этого этапа. Отдельные кадры для них не нужны и в delivery.json frames не обязательны: приёмщик сверяет их по обязательным обзорным кадрам и кадрам этого этапа, а видимая поломка отклоняет этап.`
      : "",
    tests && (ownTests.length || priorTests)
      ? `Приёмка тестами: мастерская сама запускает в Play модуль ${TESTS_MODULE} (ModuleScript) и не принимает этап, пока каждая обязательная проверка не пройдена на компьютере и на телефоне. Контракт: run(args) возвращает {checks={{id="<id пункта>",name="…",status="passed"|"failed"|"blocked"|"not_run",evidence="измеренные значения"}},findings={}}. args.checks — id проверок этого запуска (не больше ${TEST_BATCH}): выполняй только их, весь запуск должен уложиться в 60 секунд, поэтому ускоряй ожидание тестовыми переключателями, а не настоящими таймерами. Обязательные id: ${ownTests.length ? ownTests.join(", ") : "у этого этапа своих нет"}${priorTests ? `; и все ${priorTests} пунктов принятых этапов с доказательством test из ${ACCEPTED_FILE} — их проверки остаются в модуле, удалять их нельзя` : ""}. Проверка вызывает настоящий игровой путь (серверные команды, сохранение, выдачи) и сравнивает измеренное с требованием; evidence — конкретные числа и состояния, passed без evidence не засчитывается. Тестовые данные пиши только в отдельные тестовые ключи и профили, данные игроков не трогай. Если проверке нужно несколько клиентов, укажи их число в delivery.json multiplayerTests:[{item,players}]. Тот же текст модуля держи в рабочей папке в файле ${TESTS_FILE}: check_delivery сверяет по нему, что для каждого обязательного id есть проверка. Перед сдачей сам запусти модуль в Play и добейся passed по всем обязательным id: провал на приёмке отклоняет попытку.`
      : "",
    `В delivery.json добавь implementation: [{id, files:[...]}] для пунктов этапа и архитектурных решений — какие файлы рабочей папки их реализуют. Перед завершением вызови check_delivery и исправь найденные проблемы.`,
    `Приёмщик оценивает не только наличие, но и качество по кадрам баллами 1–5: стыки и чистота геометрии (перекрёстки без нахлёстов и торчащих концов, сомкнутые стены и крыши), композиция уровня, законченность (материалы и цвета стиля, узнаваемые формы, никаких серых болванок и незатекстуренных заглушек) и видимый интерфейс на кадрах Play (кнопки и панели с фоном, обводкой и скруглением, иконки на подложках, раскладка HUD по SPEC) — на любом этапе, даже если пунктов про UI нет. Любой балл ниже 4 отклоняет этап. Всё, что ты ставишь в мир на этом этапе, делай законченным, а не черновым; оценки видны в preview_visual_review.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
// Structural evidence the milestone needs: UI captures only once UI is in
// scope, art assets only when art/ui is in scope, an overview frame for world.
export function milestoneEvidenceScope(
  plan: ProductionPlan,
  milestone: PlanMilestone,
) {
  const areas = new Set(milestone.items.map((i) => i.area));
  const last = plan.milestones.at(-1) === milestone;
  // The overview and HUD views stay required once the world and the UI exist:
  // they are the regression frames for items accepted on earlier milestones,
  // which no longer need frames of their own.
  const built = new Set(
    plan.milestones
      .slice(0, plan.milestones.indexOf(milestone) + 1)
      .flatMap((m) => m.items.map((i) => i.area)),
  );
  return {
    ui: last || built.has("ui"),
    art: last || areas.has("art") || areas.has("ui"),
    layout: built.has("world"),
  };
}

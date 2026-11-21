import React, { useState } from "react";
import type { Project, Task } from "../shared/domain";
import { currentMilestone, type PlanItem } from "../shared/production-plan";

type Verdict = { itemId: string; status: string; note?: string };
type PlanReview = {
  milestoneId: string;
  attempt: number;
  status: string;
  at: string;
  checklist: Verdict[];
  quality: { aspect: string; score: number; note?: string }[];
} | null;

const verdictLabel: Record<string, [string, string]> = {
  met: ["выполнен", "good"],
  missing: ["не выполнен", "failed"],
  not_visible: ["нет кадра", "warn"],
};

// Production milestones of the approved plan with their items: accepted ones,
// the current one with the latest visual verdict per item, and the rest.
export function ProductionPlan({
  project,
  tasks,
  review,
}: {
  project: Project;
  tasks: Task[];
  review: PlanReview;
}) {
  const plan = project.productionPlan;
  const current = plan
    ? currentMilestone(plan, project.productionProgress)
    : undefined;
  const [open, setOpen] = useState<string | null>(current?.id ?? null);
  if (!plan) return null;
  const accepted = new Map(
    (project.productionProgress?.completed || []).map((c) => [c.milestoneId, c]),
  );
  const verdicts = new Map(
    review?.milestoneId === current?.id
      ? review!.checklist.map((v) => [v.itemId, v])
      : [],
  );
  const currentTask = [...tasks]
    .filter((t) => t.milestoneId === current?.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  const ownerItems = (notes: string[] | undefined, prefix: string): PlanItem[] =>
    (notes || []).map((text, n) => ({
      id: `${prefix}${n + 1}`,
      requirement: text,
      area: "world",
      evidence: ["frame"],
      specRef: "владелец",
    }));
  const met = [...verdicts.values()].filter((v) => v.status === "met").length;
  return (
    <section className="card production-plan">
      <div className="section-title">
        <div>
          <h2>План производства</h2>
          <p>
            Принято {accepted.size} из {plan.milestones.length} этапов
            {review && current
              ? ` · последняя проверка этапа ${plan.milestones.indexOf(current) + 1}: ${met} из ${verdicts.size} пунктов, попытка ${review.attempt}`
              : ""}
          </p>
        </div>
      </div>
      <ol className="milestones">
        {plan.milestones.map((m, index) => {
          const done = accepted.get(m.id);
          const isCurrent = m.id === current?.id;
          const items = [
            ...m.items,
            ...(done
              ? ownerItems(done.ownerNotes, "owner.")
              : isCurrent
                ? ownerItems(currentTask?.ownerNotes, "owner.")
                : []),
          ];
          const expanded = open === m.id;
          return (
            <li key={m.id} className={isCurrent ? "current" : ""}>
              <button
                className="milestone-head"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : m.id)}
              >
                <span className="milestone-index">{index + 1}</span>
                <span className="milestone-title">{m.title}</span>
                <span
                  className={
                    "badge " + (done ? "good" : isCurrent ? "running" : "")
                  }
                >
                  {done ? "принят" : isCurrent ? "в работе" : "впереди"}
                </span>
              </button>
              {expanded && (
                <div className="milestone-body">
                  <p>{m.goal}</p>
                  {isCurrent && review && review.quality.length > 0 && (
                    <p className="quality">
                      Качество:{" "}
                      {review.quality
                        .map((q) => `${q.aspect} ${q.score}/5`)
                        .join(" · ")}
                    </p>
                  )}
                  <ul>
                    {items.map((item) => {
                      const v = verdicts.get(item.id);
                      const [label, tone] = done
                        ? ["принят", "good"]
                        : v
                          ? (verdictLabel[v.status] ?? [v.status, ""])
                          : ["", ""];
                      return (
                        <li key={item.id}>
                          <div>
                            <code>{item.id}</code> {item.requirement}
                            {v && v.status !== "met" && v.note && (
                              <small>{v.note}</small>
                            )}
                          </div>
                          {label && <span className={"badge " + tone}>{label}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {isCurrent &&
                    (() => {
                      const own = new Set(items.map((i) => i.id));
                      const earlier = [...verdicts.values()].filter(
                        (v) => !own.has(v.itemId) && v.status !== "met",
                      );
                      return earlier.length ? (
                        <>
                          <h3>Пункты прошлых этапов: замечания проверки</h3>
                          <ul>
                            {earlier.map((v) => (
                              <li key={v.itemId}>
                                <div>
                                  <code>{v.itemId}</code>
                                  {v.note && <small>{v.note}</small>}
                                </div>
                                <span className={"badge " + (verdictLabel[v.status]?.[1] ?? "")}>
                                  {verdictLabel[v.status]?.[0] ?? v.status}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null;
                    })()}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

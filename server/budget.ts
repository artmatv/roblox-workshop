import type { Ledger, Project, Task } from "../shared/domain.js";
import { now } from "../shared/domain.js";
import { Store, id } from "./store.js";
export function balance(store: Store, p: Project) {
  const rows = store.all<Ledger>("ledger").filter((r) => r.projectId === p.id);
  const spent = rows
    .filter((r) => r.kind === "charge")
    .reduce((a, r) => a + r.micros, 0);
  const reserved = rows.reduce(
    (a, r) =>
      a +
      (r.kind === "reservation"
        ? r.micros
        : r.kind === "release"
          ? -r.micros
          : 0),
    0,
  );
  return {
    limitMicros: p.budget.limitMicros,
    spentMicros: spent,
    reservedMicros: reserved,
    availableMicros: p.budget.limitMicros - spent - reserved,
  };
}
export function reserve(store: Store, p: Project, t: Task) {
  return store.transaction(() => {
    if (!Number.isSafeInteger(t.estimateMicros) || t.estimateMicros < 0)
      throw new Error("Некорректный резерв");
    if (t.estimateMicros === 0) return null;
    if (!p.budget.approved) throw new Error("Бюджет не согласован");
    if (balance(store, p).availableMicros < t.estimateMicros)
      throw new Error("Недостаточно бюджета");
    const rows = store
      .all<Ledger>("ledger")
      .filter((r) => r.projectId === p.id);
    const used = (match: (r: Ledger) => boolean) =>
      rows
        .filter(match)
        .reduce((a, r) => a + (r.kind === "release" ? -r.micros : r.micros), 0);
    const day = now().slice(0, 10);
    if (
      used((r) => r.createdAt.startsWith(day)) + t.estimateMicros >
      p.settings.dailyLimitMicros
    )
      throw new Error("Дневной лимит исчерпан");
    const sl = p.budget.stageLimits[p.stage],
      pl = p.budget.providerLimits[t.provider];
    if (
      sl !== undefined &&
      used((r) => r.stage === p.stage) + t.estimateMicros > sl
    )
      throw new Error("Лимит этапа исчерпан");
    if (
      pl !== undefined &&
      used((r) => r.provider === t.provider) + t.estimateMicros > pl
    )
      throw new Error("Лимит провайдера исчерпан");
    const r: Ledger = {
      id: id(),
      projectId: p.id,
      taskId: t.id,
      kind: "reservation",
      micros: t.estimateMicros,
      provider: t.provider,
      stage: p.stage,
      createdAt: now(),
      externalId: null,
    };
    store.put("ledger", r);
    return r.id;
  });
}
export function settle(
  store: Store,
  t: Task,
  actualMicros: number,
  externalId: string | null = null,
) {
  store.transaction(() => {
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0)
      throw new Error("Некорректный расход");
    const key = externalId
      ? `charge:${t.provider}:${externalId}`
      : `charge:${t.id}:${t.attempt}`;
    if (store.get("ledger", key)) return;
    const r = t.reservationId
      ? store.get<Ledger>("ledger", t.reservationId)
      : undefined;
    if (r && !store.get("ledger", "release:" + r.id))
      store.put("ledger", { ...r, id: "release:" + r.id, kind: "release" });
    store.put("ledger", {
      id: key,
      projectId: t.projectId,
      taskId: t.id,
      kind: "charge",
      micros: actualMicros,
      provider: t.provider,
      stage: r?.stage || "production",
      createdAt: now(),
      externalId,
    });
  });
}
export function releaseReservation(store: Store, t: Task) {
  if (t.reservationId) {
    const r = store.get<Ledger>("ledger", t.reservationId);
    if (r)
      store.put("ledger", { ...r, id: "release:" + r.id, kind: "release" });
  }
}

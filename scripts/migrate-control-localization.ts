import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { isCompleteNativePreview } from "../server/native-preview.js";
const root = resolve(import.meta.dirname, ".."), store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const prepare = process.argv.includes("--prepare");
const call = async (path: string, body?: unknown) => {
  const r = await fetch("http://127.0.0.1:4317/api" + path, {
    method: body ? "POST" : "GET", headers: {Authorization: "Bearer " + token, "Content-Type": "application/json"},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
};
const projects = JSON.parse(readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8")).projects;
const report: any[] = [];
for (const p of projects) {
  let detail = await call("/projects/" + p.id);
  const active = detail.tasks.filter((t: any) => ["queued", "running", "verifying", "dependencies"].includes(t.status));
  if (prepare && !active.length) {
    const candidate = detail.styles.find((style: any) => {
      const t = detail.tasks.find((t: any) => t.id === style.previewTaskId);
      return !isCompleteNativePreview(t?.result) || t.result.data.localization?.sourceLocaleId !== "en-us";
    });
    if (candidate) {
      if (!detail.feedback.some((f: any) => f.text.startsWith("[English UI requirement]")))
        await call("/projects/" + p.id + "/feedback", {target: "style", priority: "high", text:
          "[English UI requirement] Новое обязательное требование пользователя: весь игровой UI изначально на английском, с автоматической локализацией Roblox. Исправь previousPreview, сохрани мир, материалы, героя, камеру, функции и отличия стиля. Переведи все статические подписи, в том числе мировые таблички. Тексты статического UI должны находиться в properties; динамические счётчики и сообщения используют AutomationI18n.set, data.localization.entries, целые английские шаблоны с именованными параметрами. Не возвращай служебные AutomationI18n/AutomationLocaleCatalog/AutomationLocalization/AutomationPreviewEnvironment: их добавляет сервис. Добавь реальный localization check с I18n.audit на 4 экранах, desktop и portrait. Следуй автоматически подключённым Roblox навыкам. Названия игр Lunar Couriers, Crystal Nursery, Light Beacons. Исправь обрезанные подписи и проверь TextBounds и safe area; у Toy Orbit ранее обрезалась подпись о выключенных покупках внизу магазина, портретный игровой мир был слишком мелким. Не меняй выбранные концепции, не согласовывай стиль за пользователя."});
      const prior = detail.tasks.find((t: any) => t.id === candidate.previewTaskId);
      if (prior && ["failed", "blocked"].includes(prior.status) && prior.attempt < prior.maxAttempts)
        await call("/tasks/" + prior.id + "/retry", {});
      else
        await call("/projects/" + p.id + "/styles/prepare", {styleId: candidate.id});
      detail = await call("/projects/" + p.id);
    }
  }
  report.push({key: p.key, projectId: p.id, styles: detail.styles.map((style: any) => {
    const t = detail.tasks.find((t: any) => t.id === style.previewTaskId);
    return {id: style.id, name: style.name, taskId: t?.id, status: t?.status, attempt: t?.attempt,
      sourceLocaleId: t?.result?.data?.localization?.sourceLocaleId || null,
      entries: t?.result?.data?.localization?.entries?.length || 0,
      instances: t?.result?.instances?.length || 0, error: t?.error,
      skills: t?.skills?.map((s: any) => s.id)};
  })});
}
writeFileSync(resolve(root, "docs/control-projects/english-ui-migration.json"), JSON.stringify({at: new Date().toISOString(), projects: report}, null, 2));
console.log(JSON.stringify(report, null, 2));

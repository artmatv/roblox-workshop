import { z } from "zod";
import type { Metric, Project, Release, Version } from "../shared/domain.js";
import { now } from "../shared/domain.js";
import { Store, id } from "./store.js";
import { Vault } from "./vault.js";
import type { Engine } from "./engine.js";
export async function jsonFetch(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Источник вернул HTTP ${r.status}`);
  return r.json();
}
export class Adapters {
  constructor(
    public store: Store,
    public vault: Vault,
  ) {}
  async research(universeIds: string[]) {
    const ids = universeIds.map((v) => z.string().regex(/^\d+$/).parse(v));
    if (!ids.length || ids.length > 30)
      throw new Error("Укажите от 1 до 30 UniverseId");
    const result = await jsonFetch(
      "https://games.roblox.com/v1/games?universeIds=" + ids.join(","),
    );
    const snapshots = [];
    for (const g of result.data || []) {
      const r = {
        id: id(),
        universeId: String(g.id),
        name: g.name,
        author: g.creator?.name,
        online: g.playing ?? null,
        visits: g.visits ?? null,
        favorites: g.favoritedCount ?? null,
        created: g.created ?? null,
        updated: g.updated ?? null,
        description: g.description ?? null,
        source: "https://games.roblox.com/v1/games",
        fetchedAt: now(),
      };
      this.store.put("trend", r);
      snapshots.push(r);
    }
    return snapshots;
  }
  trendRanking() {
    const all = this.store.all<any>("trend");
    const ids = [...new Set(all.map((s) => s.universeId))];
    return ids.map((universeId) => {
      const rows = all
        .filter((r) => r.universeId === universeId)
        .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
      const first = rows[0],
        last = rows.at(-1);
      const elapsed = Date.parse(last.fetchedAt) - Date.parse(first.fetchedAt);
      const growth =
        rows.length >= 2 && elapsed >= 3600000 && first.online > 0
          ? (last.online - first.online) / first.online
          : null;
      const values = rows.map((s) => s.online).filter((v) => v !== null);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stability =
        rows.length >= 3 && elapsed >= 86400000 && mean > 0
          ? 1 -
            Math.min(
              1,
              Math.sqrt(
                values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
              ) / mean,
            )
          : null;
      return {
        ...last,
        samples: rows.length,
        growth,
        stability,
        preliminary: growth === null || stability === null,
        score:
          growth !== null && stability !== null
            ? Math.round(
                100 *
                  (0.6 * Math.max(-1, Math.min(1, growth)) + 0.4 * stability),
              )
            : null,
        formula:
          "trend-v1: growth 60% + stability 40%; saturation/complexity — отдельная оценка исследователя",
      };
    });
  }
  importCsv(projectId: string, csv: string, releaseId: string | null) {
    const rows = parseCsv(csv);
    if (!rows.length) throw new Error("CSV пуст");
    const header = rows.shift()!.map((s) => s.trim());
    const required = ["date", "metric", "value"];
    if (required.some((k) => !header.includes(k)))
      throw new Error(
        "CSV: нужны столбцы date,metric,value; необязательно unit",
      );
    const metrics: Metric[] = [];
    for (const row of rows) {
      if (row.every((s) => !s.trim())) continue;
      const get = (k: string) => row[header.indexOf(k)]?.trim() || "";
      const date = get("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
        throw new Error("Некорректная дата CSV");
      const raw = get("value"),
        value = raw === "" ? null : Number(raw);
      if (value !== null && !Number.isFinite(value))
        throw new Error("Некорректное число CSV");
      const metric = z
        .enum(["active_players", "d1", "d7", "session_minutes", "revenue"])
        .parse(get("metric"));
      const m: Metric = {
        id: `csv:${projectId}:${releaseId || "none"}:${date}:${metric}`,
        projectId,
        releaseId,
        date,
        metric,
        value,
        source: "Roblox CSV (импорт пользователя)",
        fetchedAt: now(),
        unit: get("unit") || "unknown",
      };
      metrics.push(m);
    }
    this.store.transaction(() =>
      metrics.forEach((m) => this.store.put("metric", m)),
    );
    return metrics;
  }
  async analytics(
    p: Project,
    start: string,
    end: string,
    releaseId: string | null,
  ) {
    if (!/^\d+$/.test(p.universeId)) throw new Error("Укажите UniverseId");
    const key = await this.vault.get("roblox-analytics");
    if (!key) throw new Error("Нужен ключ universe.analytics:read");
    const names: Record<string, string> = {
      active_players: "DailyActiveUsers",
      d1: "ForwardD1Retention",
      d7: "ForwardD7Retention",
      session_minutes: "AverageSessionLengthMinutes",
      revenue: "DailyRevenue",
    };
    const config =
      this.store.get<any>("setting", "analyticsMetrics")?.value || names;
    const outcomes = [];
    for (const [metric, apiName] of Object.entries(config)) {
      try {
        let op = await jsonFetch(
          `https://apis.roblox.com/analytics-query-api/v1/universes/${p.universeId}/metrics`,
          {
            method: "POST",
            headers: { "x-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify({
              metric: apiName,
              granularity: "OneDay",
              startTime: start,
              endTime: end,
            }),
          },
        );
        for (let n = 0; !op.done && n < 10; n++) {
          if (
            typeof op.path !== "string" ||
            !op.path.startsWith(`v1/universes/${p.universeId}/operations/`)
          )
            throw new Error("Неверный путь операции аналитики");
          await new Promise((r) => setTimeout(r, 1000));
          op = await jsonFetch(
            "https://apis.roblox.com/analytics-query-api/" + op.path,
            { headers: { "x-api-key": key } },
          );
        }
        if (!op.done)
          throw new Error(
            "Аналитика ещё готовится; повторите синхронизацию позднее",
          );
        if (op.error) throw new Error("Roblox отклонил запрос показателя");
        for (const series of op.response?.values || [])
          for (const point of series.dataPoints || []) {
            if (series.breakdowns?.length) continue;
            const m: Metric = {
              id: `api:${p.id}:${point.time}:${metric}`,
              projectId: p.id,
              releaseId,
              date: String(point.time).slice(0, 10),
              metric,
              value: point.value == null ? null : Number(point.value),
              source: `Roblox Analytics Query API / ${apiName}`,
              fetchedAt: now(),
              unit: "platform",
            };
            if (m.value !== null && !Number.isFinite(m.value))
              throw new Error("Неверные данные метрики");
            this.store.put("metric", m);
          }
        outcomes.push({ metric, status: "synced" });
      } catch (e) {
        outcomes.push({
          metric,
          status: "unavailable",
          error: (e as Error).message,
        });
      }
    }
    this.store.put("analyticsSync", { id: p.id, at: now(), outcomes });
    return outcomes;
  }
  recommendations(key: string) {
    const rows = this.store
      .all<Metric>("metric")
      .filter((m) => m.projectId === key);
    const values = (metric: string) =>
      rows
        .filter((m) => m.metric === metric && m.value !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
    const active = values("active_players"),
      d1 = values("d1");
    const notes = [];
    if (active.length < 7)
      notes.push(
        "Недостаточно наблюдений: для оценки динамики нужно хотя бы 7 дневных значений аудитории.",
      );
    else {
      const a = active.slice(-7),
        growth =
          a[0].value! > 0
            ? (a.at(-1)!.value! - a[0].value!) / a[0].value!
            : null;
      notes.push(
        growth === null
          ? "Нулевая база: темп роста не определён."
          : `Изменение аудитории за последние 7 наблюдений: ${Math.round(growth * 100)}%. Изучите источники трафика до решения о расширении.`,
      );
    }
    if (d1.length < 2)
      notes.push(
        "Данных D1 недостаточно для выбора изменений обучения и первых минут.",
      );
    else
      notes.push(
        "Сопоставьте D1 с изменениями обучения и версиями релиза; корреляция сама по себе не доказывает причину.",
      );
    return {
      notes,
      action:
        "Расширение запускает пользователь после согласования объёма, миграций и бюджета.",
      updatedAt: now(),
    };
  }
  async costs(
    startTime: number,
    endTime: number,
    organization: string,
    project: string,
  ) {
    const key = await this.vault.get("openai-admin");
    if (!key)
      throw new Error("Нужен отдельный административный ключ Costs API");
    const buckets = [];
    let page: string | undefined;
    for (let n = 0; n < 100; n++) {
      const q = new URLSearchParams({
        start_time: String(startTime),
        end_time: String(endTime),
        bucket_width: "1d",
        limit: "31",
      });
      if (project) q.append("project_ids[]", project);
      if (page) q.set("page", page);
      const data = await jsonFetch(
        "https://api.openai.com/v1/organization/costs?" + q,
        {
          headers: {
            Authorization: "Bearer " + key,
            ...(organization ? { "OpenAI-Organization": organization } : {}),
          },
        },
      );
      buckets.push(...(data.data || []));
      if (!data.has_more) {
        const r = {
          id: id(),
          organization,
          project,
          source: "OpenAI Costs API",
          startTime,
          endTime,
          fetchedAt: now(),
          buckets,
        };
        this.store.put("costSync", r);
        return r;
      }
      page = data.next_page;
      if (!page) throw new Error("Costs API не вернул следующую страницу");
    }
    throw new Error("Превышен лимит страниц Costs API");
  }
  async publish(engine: Engine, releaseId: string) {
    const r = this.store.get<Release>("release", releaseId);
    if (!r || r.status !== "approved")
      throw new Error("Нет действующего подтверждения версии");
    const p = engine.project(r.projectId);
    const v = engine.versions(p.id).find((v) => v.revision === p.revision);
    if (
      !v ||
      v.hash !== r.hash ||
      r.revision !== p.revision ||
      r.placeId !== p.placeId ||
      r.universeId !== p.universeId
    )
      throw new Error(
        "Сборка или целевой experience изменились после подтверждения",
      );
    const blockers = engine.releaseBlockers(p, v);
    if (blockers.length) throw new Error(blockers.join("; "));
    const key = await this.vault.get("roblox-publish");
    if (!key)
      throw new Error("Нужен отдельный ключ публикации целевого experience");
    r.status = "publishing";
    this.store.put("release", r);
    try {
      const body = this.store.read(
        `projects/${p.id}/versions/${v.revision}/place.rbxlx`,
      );
      const response = await fetch(
        `https://apis.roblox.com/universes/v1/${p.universeId}/places/${p.placeId}/versions?versionType=Published`,
        {
          method: "POST",
          headers: { "x-api-key": key, "Content-Type": "application/xml" },
          body,
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!response.ok) {
        r.status = "failed";
        r.result = { httpStatus: response.status };
        this.store.put("release", r);
        throw new Error("Roblox не принял публикацию: " + response.status);
      }
      r.result = {
        ...(await response.json()),
        url: `https://www.roblox.com/games/${p.placeId}`,
        publishedAt: now(),
      };
      r.status = "published";
      this.store.put("release", r);
      engine.setExecution(p, "complete");
      p.stage = "analytics";
      engine.save(p);
      this.store.event(p.id, "release.published", { id: r.id, ...r.result });
      return r;
    } catch (e) {
      if (r.status === "publishing") {
        r.status = "uncertain";
        r.result = {
          error:
            "Ответ не получен. Сверьте версию в Creator Hub перед новой публикацией.",
        };
        this.store.put("release", r);
      }
      throw e;
    }
  }
}
export function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Незакрытые кавычки CSV");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

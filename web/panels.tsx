import React from "react";
import { Download, Plus, ShieldCheck } from "lucide-react";
async function request(path: string, body: unknown) {
  const r = await fetch("/api" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + sessionStorage.getItem("automation-token"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
export function ProviderPanel({ state, p, run, action }: any) {
  return (
    <section className="card">
      <h2>Прямые запросы OpenAI API</h2>
      <p>
        Отдельный режим с ключом, подтверждёнными ценами и бюджетным резервом.
        Подписка не переключается на него автоматически.
      </p>
      <details>
        <summary>Подтверждённые цены и организация</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                request("/providers/pricing", {
                  model: f.get("model"),
                  organization: f.get("organization") || undefined,
                  project: f.get("project") || undefined,
                  inputMicrosPerMillion: Number(f.get("input")) * 1e6,
                  outputMicrosPerMillion: Number(f.get("output")) * 1e6,
                  imageMicrosMax: f.get("image")
                    ? Math.ceil(Number(f.get("image")) * 1e6)
                    : undefined,
                  speechMicrosPerMillionChars: f.get("speech")
                    ? Number(f.get("speech")) * 1e6
                    : undefined,
                  source: f.get("source"),
                  verifiedAt: new Date().toISOString(),
                }),
              "Цены сохранены с датой и источником",
            );
          }}
        >
          <div className="grid two">
            <label>
              Модель API
              <input
                name="model"
                required
                defaultValue={state.providerPricing?.model}
              />
            </label>
            <label>
              Организация API
              <input
                name="organization"
                defaultValue={state.providerPricing?.organization}
              />
            </label>
            <label>
              Проект API
              <input
                name="project"
                defaultValue={state.providerPricing?.project}
              />
            </label>
            <label>
              Вход, USD за 1 млн токенов
              <input
                name="input"
                type="number"
                min="0"
                step="0.0001"
                required
              />
            </label>
            <label>
              Выход, USD за 1 млн токенов
              <input
                name="output"
                type="number"
                min="0"
                step="0.0001"
                required
              />
            </label>
            <label>
              Максимум за изображение, USD
              <input name="image" type="number" min="0" step="0.01" />
            </label>
            <label>
              Озвучка, USD за 1 млн символов
              <input name="speech" type="number" min="0" step="0.0001" />
            </label>
            <label>
              Официальный источник цены
              <input
                name="source"
                type="url"
                required
                placeholder="https://developers.openai.com/..."
              />
            </label>
          </div>
          <button>Сохранить подтверждённые цены</button>
        </form>
      </details>
      {p && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                action("generate", {
                  operation: f.get("operation"),
                  prompt: f.get("prompt"),
                  maxOutputTokens: 4000,
                }),
              "Генерация завершена, результат сохранён",
            );
          }}
        >
          <label>
            Тип
            <select name="operation">
              <option value="responses">Responses API — текст и код</option>
              <option value="image">Изображение</option>
              <option value="speech">Озвучка</option>
            </select>
          </label>
          <label>
            Задание
            <textarea name="prompt" required rows={3} />
          </label>
          <button disabled={!p.budget.approved}>
            <Plus size={15} />
            Выполнить в рамках бюджета
          </button>
        </form>
      )}
      {state.providerOperations?.map((o: any) => (
        <details key={o.id}>
          <summary>
            {o.task.kind} · {o.status}
          </summary>
          <pre>{JSON.stringify(o.result || { error: o.error }, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
export function SkillImport({ run }: any) {
  return (
    <details>
      <summary>Подключить проверенный пакет навыка</summary>
      <p>
        JSON пакет: id, source, version (commit), license, roles, capabilities,
        dependencies, files (полный SKILL.md и необходимые Markdown
        справочники). Импорт сохраняет новую версию отдельно; текущие проекты
        продолжают использовать закреплённую.
      </p>
      <input
        aria-label="JSON пакет навыка"
        type="file"
        accept=".json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void run(
              async () => request("/skills/import", JSON.parse(await f.text())),
              "Пакет сохранён. Проверьте совместимость перед закреплением.",
            );
        }}
      />
    </details>
  );
}
export function GrantPanel({ state, run }: any) {
  return (
    <section className="card">
      <h2>Бесплатные API кредиты</h2>
      <p>
        Срок гранта и сброс подписочной квоты — разные даты. Неизвестные условия
        не считаются разрешением на расход.
      </p>
      <details>
        <summary>Сохранить вручную подтверждённый грант</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                request("/finance/grants", {
                  organization: f.get("organization"),
                  type: f.get("type"),
                  remaining:
                    f.get("remaining") === ""
                      ? null
                      : Number(f.get("remaining")),
                  expiresAt: f.get("expires")
                    ? new Date(String(f.get("expires"))).toISOString()
                    : null,
                  nextGrantAt: null,
                  eligibleForResponses:
                    f.get("eligible") === "yes"
                      ? true
                      : f.get("eligible") === "no"
                        ? false
                        : null,
                  source: f.get("source"),
                }),
              "Условия гранта сохранены как ручные данные",
            );
          }}
        >
          <div className="grid two">
            <label>
              Организация
              <input name="organization" required />
            </label>
            <label>
              Тип гранта
              <input name="type" required />
            </label>
            <label>
              Остаток, USD
              <input name="remaining" type="number" min="0" step="0.01" />
            </label>
            <label>
              Истекает (время этого компьютера)
              <input name="expires" type="datetime-local" />
            </label>
            <label>
              Применим к Responses API
              <select name="eligible">
                <option value="unknown">Неизвестно</option>
                <option value="yes">Подтверждено</option>
                <option value="no">Не применим</option>
              </select>
            </label>
            <label>
              Источник подтверждения
              <input name="source" required />
            </label>
          </div>
          <button>
            Сохранить грант
            <ShieldCheck size={15} />
          </button>
        </form>
      </details>
      {state.finance.grants.map((g: any) => (
        <article className="feedback-item" key={g.id}>
          <strong>
            {g.type} · {g.organization}
          </strong>
          <p>
            {g.remaining === null ? "Остаток неизвестен" : `${g.remaining} USD`}{" "}
            · истекает{" "}
            {g.expiresAt
              ? new Date(g.expiresAt).toLocaleString("ru-RU", {
                  timeZone: "Asia/Bangkok",
                })
              : "неизвестно"}
          </p>
          <small>
            Вручную · {g.source} · применимость:{" "}
            {g.eligibleForResponses === null
              ? "неизвестно"
              : g.eligibleForResponses
                ? "подтверждена"
                : "не применим"}
          </small>
        </article>
      ))}
    </section>
  );
}

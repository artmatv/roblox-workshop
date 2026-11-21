import { useState } from "react";
import { Eye, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";

type Model = {
  id: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
};
type State = {
  enabled: boolean;
  configured: boolean;
  model: string | null;
  models: Model[];
  updatedAt: string | null;
};

function formatContext(value: number | null) {
  if (!value) return "контекст неизвестен";
  return `${new Intl.NumberFormat("ru-RU").format(value)} токенов`;
}

export function ExternalReviewer({
  state = {
    enabled: false,
    configured: false,
    model: null,
    models: [],
    updatedAt: null,
  },
  run,
}: {
  state?: State;
  run: (op: () => Promise<unknown>, message?: string) => Promise<unknown>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(state.model || "");
  const [enabled, setEnabled] = useState(state.enabled);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await run(async () => {
        const response = await fetch("/api/external-reviewer", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            ...(apiKey ? { apiKey } : {}),
            model: model || null,
            enabled,
          }),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body?.error || "Не удалось сохранить настройки проверяющего",
          );
        return body;
      }, "Настройки независимой проверки сохранены");
      if (saved) setApiKey("");
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const result = (await run(async () => {
        const response = await fetch("/api/external-reviewer/models", {
          method: "POST",
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error("Не удалось загрузить модели");
        return response.json();
      }, "Список моделей обновлён")) as State | undefined;
      if (result?.models) {
        const selected =
          result.models.find((item) => item.id === (result.model || model))
            ?.id || "";
        setModel(selected);
      }
    } finally {
      setBusy(false);
    }
  };
  const removeKey = async () => {
    setBusy(true);
    try {
      await run(async () => {
        const response = await fetch("/api/external-reviewer/key", {
          method: "DELETE",
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error("Не удалось удалить ключ");
        return response.json();
      }, "Ключ удалён");
      setApiKey("");
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  };
  const selected = state.models.find((item) => item.id === model);
  return (
    <section className="card" aria-label="Независимая проверка">
      <div className="section-title">
        <div>
          <h2>
            <Eye size={18} /> Независимая проверка
          </h2>
          <p>
            Отдельная модель проверит материалы проекта, не изменяя исходники
          </p>
        </div>
        <span className="badge">
          {state.configured ? "Ключ сохранён" : "Ключ не добавлен"}
        </span>
      </div>
      <div className="form-grid">
        <label>
          API-ключ LLMASS
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              state.configured
                ? "Оставьте пустым, чтобы не менять"
                : "Вставьте ключ LLMASS"
            }
          />
        </label>
        <div className="button-row">
          <button disabled={busy} onClick={refresh}>
            <RefreshCw size={15} /> Загрузить модели
          </button>
          {state.configured && (
            <button className="text-button" disabled={busy} onClick={removeKey}>
              Удалить ключ
            </button>
          )}
        </div>
        <label>
          Модель
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="">Выберите модель</option>
            {state.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {formatContext(item.contextWindow)} · вывод до{" "}
                {item.maxOutputTokens
                  ? new Intl.NumberFormat("ru-RU").format(item.maxOutputTokens)
                  : "неизвестно"}
              </option>
            ))}
          </select>
        </label>
        <p className="policy-detail">
          {selected
            ? `Контекст: ${formatContext(selected.contextWindow)} · максимальный вывод: ${selected.maxOutputTokens ? new Intl.NumberFormat("ru-RU").format(selected.maxOutputTokens) + " токенов" : "неизвестно"}. Тарифы загружаются из каталога API.`
            : "Загрузите каталог, чтобы выбрать доступную модель."}
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{" "}
          <ShieldCheck size={16} /> Использовать для независимой проверки
        </label>
        <p className="policy-detail">
          <KeyRound size={14} /> Ключ хранится локально в защищённом хранилище
          Windows. Проверка использует бюджет проекта.
        </p>
        <button disabled={busy} onClick={save}>
          Сохранить ключ и настройки
        </button>
        {state.updatedAt && (
          <small>
            Каталог обновлён {new Date(state.updatedAt).toLocaleString("ru-RU")}
          </small>
        )}
      </div>
    </section>
  );
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("automation-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

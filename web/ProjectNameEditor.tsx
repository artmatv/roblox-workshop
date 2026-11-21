import { isModelCapacityError } from "../shared/model-capacity";
import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import type { Project } from "../shared/domain";
import {
  namingStudy,
  projectNameSchema,
  type NameSuggestion,
  type NameSuggestionsResult,
} from "../shared/project-naming";

interface Props {
  project: Project;
  onSave: (name: string) => Promise<unknown>;
  onGenerate: () => Promise<NameSuggestionsResult>;
}
export function ProjectNameEditor({ project, onSave, onGenerate }: Props) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(project.name),
    [suggestions, setSuggestions] = useState<NameSuggestion[]>([]),
    [generating, setGenerating] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!editing) setDraft(project.name);
  }, [project.name, editing]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  async function generate() {
    const current = ++request.current;
    setEditing(true);
    setGenerating(true);
    setError("");
    try {
      const result = await onGenerate();
      if (request.current === current) setSuggestions(result.suggestions);
    } catch (e) {
      if (request.current === current)
        setError(
          isModelCapacityError((e as Error).message)
            ? "Выбранная модель перегружена. Попробуйте позже или выберите другую модель в «Плане и агентах»."
            : (e as Error).message,
        );
    } finally {
      if (request.current === current) setGenerating(false);
    }
  }
  function cancel() {
    request.current++;
    setEditing(false);
    setGenerating(false);
    setError("");
    setDraft(project.name);
  }
  return (
    <div className="project-name-editor">
      <div className="project-title-line">
        <h1>{project.name}</h1>
        <button
          className="icon-button"
          aria-label="Изменить название проекта"
          title="Изменить название"
          onClick={() => {
            setEditing(true);
            setError("");
          }}
        >
          <Pencil size={16} />
        </button>
        <button
          className="subtle"
          onClick={() => void generate()}
          disabled={generating || saving}
        >
          {generating ? (
            <RefreshCw className="spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}
          {generating ? "Придумываю…" : "Придумать название"}
        </button>
      </div>
      {editing && (
        <section
          className="project-name-panel"
          aria-label="Редактирование названия"
        >
          <form
            className="project-name-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const parsed = projectNameSchema.safeParse(draft);
              if (!parsed.success) {
                setError(parsed.error.issues[0].message);
                return;
              }
              setSaving(true);
              setError("");
              try {
                await onSave(parsed.data);
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <label>
              Название проекта
              <input
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                minLength={2}
                maxLength={100}
                required
                disabled={saving}
              />
            </label>
            <div className="project-name-actions">
              <button className="primary" disabled={saving || generating}>
                <Check size={15} />
                Сохранить название
              </button>
              <button type="button" onClick={cancel} disabled={saving}>
                <X size={15} />
                Отмена
              </button>
            </div>
          </form>
          {generating && (
            <p role="status">
              ИИ изучает идею, жанр и концепцию проекта и придумывает пять
              вариантов…
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {!!suggestions.length && (
            <div
              className="project-name-suggestions"
              aria-label="Варианты названия от ИИ"
            >
              <p>
                Выберите вариант или отредактируйте название перед сохранением.
              </p>
              {suggestions.map((s) => (
                <button
                  type="button"
                  key={s.name}
                  aria-pressed={draft === s.name}
                  onClick={() => {
                    setDraft(s.name);
                    input.current?.focus();
                  }}
                >
                  <strong>{s.name}</strong>
                  <span>{s.reason}</span>
                  {draft === s.name && <Check size={16} />}
                </button>
              ))}
            </div>
          )}
          <details className="naming-research">
            <summary>Стиль названий и анализ топовых игр</summary>
            <p>{namingStudy.analysis.style}</p>
            <ul>
              {namingStudy.analysis.patterns.map((p) => (
                <li key={p.pattern}>
                  <strong>{p.pattern}:</strong> {p.examples.join(", ")}.{" "}
                  {p.application}
                </li>
              ))}
            </ul>
            <p>
              Выборка: первые {namingStudy.games.length} игры{" "}
              <a href={namingStudy.source} target="_blank" rel="noreferrer">
                Top Playing Now
              </a>
              ,{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Asia/Bangkok",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(namingStudy.checkedAt))}
              . Позиции меняются со временем.
            </p>
            <ol>
              {namingStudy.games.map((g) => (
                <li key={g.placeId}>
                  <a href={g.url} target="_blank" rel="noreferrer">
                    {g.baseName}
                  </a>
                </li>
              ))}
            </ol>
            <a
              href="https://create.roblox.com/docs/discovery"
              target="_blank"
              rel="noreferrer"
            >
              Рекомендации Roblox по оригинальным и точным названиям
            </a>
          </details>
        </section>
      )}
    </div>
  );
}

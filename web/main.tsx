import { ExternalReviewer } from "./ExternalReviewer";
import { AgentPolicy } from "./AgentPolicy";
import { ProductionPlan } from "./ProductionPlan";
import {
  SPECIALIST_POLICY,
  usesSpecialists,
  specialistProfile,
} from "../shared/agent-policy";
import { NativeDevelopment } from "./NativeDevelopment";
import { ProjectDirection } from "./ProjectDirection";
import { productionRepairSources } from "../shared/production-recovery";
import { ProjectNameEditor } from "./ProjectNameEditor";
import { EFFORTS, ROLE_EFFORT, planEffort } from "../shared/effort-policy";
import { isModelCapacityError } from "../shared/model-capacity";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Boxes,
  LayoutDashboard,
  Compass,
  Palette,
  FileCheck2,
  Workflow,
  FlaskConical,
  MessageSquare,
  Package,
  Wallet,
  BookOpen,
  Send,
  ChartNoAxesCombined,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Play,
  Pause,
  Square,
  Check,
  RefreshCw,
  Link,
  ShieldCheck,
  Clock,
  Download,
  AlertCircle,
  Monitor,
  Smartphone,
  X,
  Settings,
  ArrowRight,
  Layers,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { labels, stages, roles } from "../shared/vocabulary";
import type { Project, Task, Version, StylePackage } from "../shared/domain";
import { studioOnline } from "../shared/studio-status";
import { DevelopmentPolicy } from "./DevelopmentPolicy";
import { ProviderPanel, SkillImport, GrantPanel } from "./panels";
import { FeedbackAttachment, type MarkedImage } from "./FeedbackAttachment";
import { VersionComparison } from "./VersionComparison";
import { StyleDetails } from "./StyleDetails";
import { StylePresetLibrary } from "./StylePresetLibrary";
import { AssetPreview } from "./AssetPreview";
import { SpecificationDocument } from "./SpecificationDocument";
import type { ResultReview } from "../server/orchestrator";
import { preferredStylePreview } from "../shared/style-preview-selection";
import { ApiError, connectionError } from "../shared/connection-error";
import "./style.css";
function consumeDashboardLink() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.get("token")) {
    sessionStorage.setItem("automation-token", fragment.get("token")!);
    history.replaceState(null, "", location.pathname + location.search);
  }
}
consumeDashboardLink();
const auth = () => ({
  Authorization: "Bearer " + (sessionStorage.getItem("automation-token") || ""),
});
async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { ...auth(), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(r.status, data.error || "Не удалось выполнить действие");
  return data;
}
async function file(path: string, name?: string) {
  const r = await fetch("/api/files?" + new URLSearchParams({ path }), {
    headers: auth(),
  });
  if (!r.ok) throw new Error("Файл недоступен");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name || path.split("/").at(-1)!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const money = (micros: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(micros / 1e6);
const agentName = (c?: { backend?: string }) =>
  c?.backend === "claude" ? "Claude Code" : "Codex";
const date = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(s))
    : "Неизвестно";
const execution: Record<string, string> = {
  idle: "Можно начинать",
  running: "В работе",
  decision: "Ожидает решения",
  studio: "Ожидает Studio",
  quota: "Ожидает квоты",
  funds: "Ожидает бюджета",
  paused: "На паузе",
  error: "Нужно внимание",
  complete: "Завершено",
};
const status: Record<string, string> = {
  planned: "Запланирована",
  dependencies: "Ждёт зависимости",
  queued: "В очереди",
  running: "Выполняется",
  reviewing: "У оркестратора",
  verifying: "Проверяется",
  succeeded: "Выполнена",
  failed: "Ошибка",
  cancelled: "Отменена",
  blocked: "Заблокирована",
  passed: "Пройдена",
  not_run: "Не запускалась",
};
const skillStatus: Record<string, string> = {
  discovered: "Найден",
  reviewed: "Пакет проверен",
  installed: "Установлен",
  connected: "Подключён",
  incompatible: "Нужна проверка инструментов",
  disabled: "Отключён",
};
const nav = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "research", label: "Исследование", icon: Compass },
  { id: "styles", label: "Концепция и стиль", icon: Palette },
  { id: "spec", label: "Спецификация", icon: FileCheck2 },
  { id: "agents", label: "План и агенты", icon: Workflow },
  { id: "build", label: "Сборка и проверки", icon: FlaskConical },
  { id: "feedback", label: "Доработки", icon: MessageSquare },
  { id: "assets", label: "Библиотека ресурсов", icon: Package },
  { id: "release", label: "Релизы", icon: Send },
  { id: "analytics", label: "Аналитика", icon: ChartNoAxesCombined },
  { id: "finance", label: "Аккаунты и расходы", icon: Wallet },
  { id: "skills", label: "Навыки", icon: BookOpen },
];
function App() {
  const [state, setState] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [selected, setSelected] = useState(
      localStorage.getItem("automation-project") || "",
    ),
    [view, setView] = useState("overview"),
    [modal, setModal] = useState(false),
    [ownSpecification, setOwnSpecification] = useState(false),
    [specificationText, setSpecificationText] = useState(""),
    [fileLoading, setFileLoading] = useState(false),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [deleteModal, setDeleteModal] = useState(false),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [deleteFiles, setDeleteFiles] = useState(false),
    [pairing, setPairing] = useState<any>(null),
    [loadError, setLoadError] = useState<ReturnType<
      typeof connectionError
    > | null>(null);
  const refresh = useCallback(async () => {
    if (deletingProject.current) return;
    const generation = refreshGeneration.current;
    try {
      const s = await api("/state");
      if (generation !== refreshGeneration.current) return;
      setState(s);
      setLoadError(null);
      if (selected && s.projects.some((p: Project) => p.id === selected)) {
        const d = await api("/projects/" + selected);
        if (generation !== refreshGeneration.current) return;
        setDetail(d);
      } else {
        setDetail(null);
        if (s.projects.length) setSelected(s.projects[0].id);
      }
    } catch (e) {
      if (generation === refreshGeneration.current && !deletingProject.current)
        setLoadError(connectionError(e));
    }
  }, [selected]);
  const refreshGeneration = useRef(0);
  const deletingProject = useRef(false);
  useEffect(() => {
    const reconnect = () => {
      consumeDashboardLink();
      void refresh();
    };
    reconnect();
    window.addEventListener("hashchange", reconnect);
    // A slow server must not receive a new poll before the last one answers.
    let polling = false;
    const t = setInterval(() => {
      if (polling) return;
      polling = true;
      void refresh().finally(() => (polling = false));
    }, 5000);
    return () => {
      clearInterval(t);
      window.removeEventListener("hashchange", reconnect);
    };
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("automation-project", selected);
  }, [selected]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 7000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function run(fn: () => Promise<any>, success = "Сохранено") {
    setBusy(true);
    try {
      const r = await fn();
      setToast(success);
      await refresh();
      return r;
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteSelectedProject() {
    if (!p || deleteConfirmation !== p.name) return;
    const generation = ++refreshGeneration.current;
    deletingProject.current = true;
    setBusy(true);
    try {
      await api(
        "/projects/" + p.id,
        { confirmation: deleteConfirmation, deleteFiles },
        "DELETE",
      );
      const s = await api("/state");
      if (generation !== refreshGeneration.current) return;
      const next = s.projects[0]?.id || "";
      setState(s);
      setSelected(next);
      const nextDetail = next ? await api("/projects/" + next) : null;
      if (generation !== refreshGeneration.current) return;
      setDetail(nextDetail);
      setToast("Проект удалён");
      setDeleteModal(false);
      setDeleteConfirmation("");
      setDeleteFiles(false);
      setView("overview");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      deletingProject.current = false;
      setBusy(false);
      void refresh();
    }
  }
  const p: Project | undefined = detail?.project;
  const selectedStudio = state?.studios.find(
    (studio: any) => studio.id === p?.studioId,
  );
  const studioActive = studioOnline(selectedStudio);
  const mutate = (body: unknown) => api("/projects/" + selected, body, "PATCH");
  const action = (name: string, body: unknown = {}) =>
    api("/projects/" + selected + "/" + name, body);
  const codex = state?.codex;
  const quota = codex?.quota?.[0];
  const context = {
    state,
    detail,
    p,
    run,
    mutate,
    action,
    setView,
    setPairing,
    pairing,
  };
  if (loadError)
    return (
      <div className="locked">
        <Boxes size={40} />
        <h1>Мастерская Roblox</h1>
        <h2>{loadError.title}</h2>
        <p>{loadError.message}</p>
        <button onClick={() => void refresh()}>
          <RefreshCw size={16} />
          Проверить снова
        </button>
      </div>
    );
  if (!state)
    return (
      <div className="locked">
        <RefreshCw className="spin" />
        <p>Подключаем локальную мастерскую…</p>
      </div>
    );
  return (
    <div className="shell">
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
        >
          <span className="brand-mark">
            <Boxes size={24} />
          </span>
          <span>
            Мастерская<small>ROBLOX · LOCAL STUDIO</small>
          </span>
        </a>
        <div className="workspace-label">
          ВАШЕ ПРОСТРАНСТВО <span>Личное</span>
        </div>
        <div className="project-select">
          <select
            aria-label="Активный проект"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {!state?.projects.length && <option value="">Нет проектов</option>}
            {state?.projects.map((p: Project) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            aria-label="Создать проект"
            className="icon-button"
            onClick={() => setModal(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav>
          {nav.map((n, i) => (
            <React.Fragment key={n.id}>
              {i === 10 && <div className="nav-divider">ПРОСТРАНСТВО</div>}
              <button
                className={view === n.id ? "active" : ""}
                onClick={() => setView(n.id)}
              >
                <n.icon size={18} />
                {n.label}
                {view === n.id && <span className="active-dot" />}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="local-note">
          <span className="dot" />
          Локальный сервис
          <p>
            Продолжает работу после
            <br />
            закрытия этого окна
          </p>
        </div>
        <div className="profile">
          <span>Я</span>
          <div>
            Личная мастерская<small>Asia/Bangkok · Windows</small>
          </div>
          <ShieldCheck size={16} />
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            Рабочее пространство <ChevronRight size={14} />
            <strong>{p?.name || "Новый проект"}</strong>
          </div>
          <div className="top-status">
            <span>
              <span className={"dot " + (studioActive ? "" : "gray")} />
              Studio{" "}
              {studioActive
                ? selectedStudio.playMode
                  ? "в Play"
                  : "на связи"
                : p?.studioId
                  ? "нет связи"
                  : "не подключена"}
            </span>
            <span className="separator" />
            <span>
              {agentName(codex)} ·{" "}
              {quota?.remaining != null
                ? `${Math.round(quota.remaining)}%`
                : "квота неизвестна"}
            </span>
            <button
              className="icon-button"
              aria-label="Настройки аккаунтов"
              onClick={() => setView("finance")}
            >
              <Settings size={17} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-head">
            <div>
              <div className="eyebrow">
                МАСТЕРСКАЯ /{" "}
                {nav.find((n) => n.id === view)?.label.toUpperCase()}
              </div>
              {view === "overview" && p ? (
                <ProjectNameEditor
                  key={p.id}
                  project={p}
                  onSave={async (name) => {
                    const saved = await mutate({ name });
                    await refresh();
                    setToast("Название проекта сохранено");
                    return saved;
                  }}
                  onGenerate={() =>
                    api("/projects/" + p.id + "/name-suggestions", {})
                  }
                />
              ) : (
                <h1>
                  {view === "overview"
                    ? "От идеи к своей игре"
                    : nav.find((n) => n.id === view)?.label}
                </h1>
              )}
              <p>
                {view === "overview"
                  ? "Исследуйте, создавайте и развивайте игры в одном месте."
                  : descriptions[view]}
              </p>
            </div>
            {p ? (
              <div className="controls">
                <span className={"badge " + p.execution}>
                  {execution[p.execution]}
                </span>
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        action("control", {
                          action:
                            p.execution === "running" ? "pause" : "resume",
                        }),
                      "Состояние обновлено",
                    )
                  }
                >
                  {p.execution === "running" ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}{" "}
                  {p.execution === "running" ? "Пауза" : "Продолжить"}
                </button>
                <button
                  className="icon-button"
                  title="Отменить незавершённые задачи"
                  aria-label="Отменить работу"
                  onClick={() =>
                    void run(
                      () => action("control", { action: "cancel" }),
                      "Работа отменена",
                    )
                  }
                >
                  <Square size={14} />
                </button>
                <button
                  className="icon-button"
                  title="Удалить проект"
                  aria-label="Удалить проект"
                  disabled={busy}
                  onClick={() => {
                    setDeleteConfirmation("");
                    setDeleteFiles(false);
                    setDeleteModal(true);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <button className="primary" onClick={() => setModal(true)}>
                <Plus size={16} />
                Новый проект
              </button>
            )}
          </div>
          {!p && !["finance", "skills"].includes(view) ? (
            <Empty onCreate={() => setModal(true)} />
          ) : view === "overview" ? (
            <Overview {...context} />
          ) : view === "research" ? (
            <Research {...context} />
          ) : view === "styles" ? (
            <Styles {...context} />
          ) : view === "spec" ? (
            <Specification {...context} />
          ) : view === "agents" ? (
            <Agents {...context} />
          ) : view === "build" ? (
            <Build {...context} />
          ) : view === "feedback" ? (
            <Feedback {...context} />
          ) : view === "assets" ? (
            <Assets {...context} />
          ) : view === "release" ? (
            <Releases {...context} />
          ) : view === "analytics" ? (
            <Analytics {...context} />
          ) : view === "finance" ? (
            <Finance {...context} />
          ) : (
            <Skills {...context} />
          )}
        </main>
        <footer>
          <span>
            <ShieldCheck size={13} /> Данные проекта хранятся на этом компьютере
          </span>
          <span>Публикация каждой версии — по вашему решению</span>
        </footer>
      </div>
      {toast && (
        <div role="status" className="toast">
          <AlertCircle size={18} />
          {toast}
          <button aria-label="Закрыть" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="working">
          <RefreshCw size={14} className="spin" />
          Сохраняем…
        </div>
      )}
      {modal && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              data.set("genre", String(data.get("genre") || "").trim());
              void run(async () => {
                const payload: Record<string, any> = Object.fromEntries(data);
                if (ownSpecification) {
                  payload.specification = specificationText;
                } else {
                  delete payload.specification;
                }
                const result = await api("/projects", payload);
                setSelected(result.id);
                if (ownSpecification) setView("styles");
                setModal(false);
                return result;
              }, "Проект создан");
            }}
          >
            <button
              type="button"
              aria-label="Закрыть"
              className="close icon-button"
              onClick={() => setModal(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">НОВАЯ ИГРА</div>
            <h2>С чего начнём?</h2>
            <p>
              Небольшая законченная игра. Объём и бюджет согласуем до
              разработки.
            </p>
            <div
              className="choice-row"
              role="radiogroup"
              aria-label="Основа проекта"
            >
              <label>
                <input
                  type="radio"
                  name="project-source"
                  checked={!ownSpecification}
                  onChange={() => setOwnSpecification(false)}
                />{" "}
                Начать с идеи
              </label>
              <label>
                <input
                  type="radio"
                  name="project-source"
                  checked={ownSpecification}
                  onChange={() => setOwnSpecification(true)}
                />{" "}
                У меня есть спецификация
              </label>
            </div>
            <label>
              Название проекта
              <input
                name="name"
                required
                minLength={2}
                placeholder="Например, Лунный сад"
              />
            </label>
            <ProjectDirection />
            {!ownSpecification && (
              <label>
                Идея и ограничения
                <textarea
                  name="goal"
                  required
                  minLength={3}
                  placeholder="Для кого игра? Какие механики интересны? Что важно учесть?"
                  rows={4}
                />
              </label>
            )}
            {ownSpecification && (
              <>
                <label>
                  Спецификация (.md или .txt)
                  <input
                    type="file"
                    accept=".md,.txt,text/markdown,text/plain"
                    onChange={async (e) => {
                      const selectedFile = e.currentTarget.files?.[0];
                      if (!selectedFile) return;
                      if (!/\.(md|txt)$/i.test(selectedFile.name)) {
                        setToast("Выберите файл .md или .txt");
                        e.currentTarget.value = "";
                        return;
                      }
                      if (selectedFile.size > 200_000) {
                        setToast("Файл должен быть не больше 200 КБ");
                        e.currentTarget.value = "";
                        return;
                      }
                      setFileLoading(true);
                      try {
                        setSpecificationText(await selectedFile.text());
                      } catch {
                        setToast(
                          "Не удалось прочитать файл. Попробуйте вставить текст вручную.",
                        );
                      } finally {
                        setFileLoading(false);
                      }
                    }}
                  />
                </label>
                <label>
                  Полный текст спецификации
                  <textarea
                    name="specification"
                    aria-label="Полный текст спецификации"
                    required
                    minLength={1}
                    maxLength={200000}
                    rows={8}
                    value={specificationText}
                    onChange={(e) => setSpecificationText(e.target.value)}
                    placeholder="Вставьте спецификацию или выберите файл выше"
                  />
                </label>
              </>
            )}
            <button className="primary" disabled={busy || fileLoading}>
              {ownSpecification
                ? "Создать и открыть концепцию"
                : "Создать проект"}
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      )}
      {deleteModal && p && (
        <div className="overlay" role="presentation">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onSubmit={(e) => {
              e.preventDefault();
              void deleteSelectedProject();
            }}
          >
            <button
              type="button"
              aria-label="Закрыть"
              className="close icon-button"
              disabled={busy}
              onClick={() => setDeleteModal(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">УДАЛЕНИЕ ПРОЕКТА</div>
            <h2 id="delete-project-title">Удалить проект «{p.name}»?</h2>
            <p>
              Будут удалены данные проекта и связанные с ним записи. Общие
              резервные копии и история расходов сохранятся.
            </p>
            <label className="delete-files-option">
              <input
                type="checkbox"
                checked={deleteFiles}
                disabled={busy}
                onChange={(e) => setDeleteFiles(e.target.checked)}
              />
              Удалить все связанные файлы
            </label>
            <p>
              {deleteFiles
                ? "Удалятся локальные рабочие файлы проекта, результаты задач, снимки и прикреплённые изображения."
                : "Связанные локальные файлы останутся на диске."}
            </p>
            <label htmlFor="delete-project-confirm">
              Для подтверждения введите точное название проекта
            </label>
            <input
              id="delete-project-confirm"
              autoComplete="off"
              value={deleteConfirmation}
              disabled={busy}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
            />
            <div className="delete-actions">
              <button
                type="button"
                className="subtle"
                disabled={busy}
                onClick={() => setDeleteModal(false)}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="danger"
                disabled={busy || deleteConfirmation !== p.name}
              >
                {busy ? "Удаляем…" : "Удалить навсегда"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
type Ctx = any;
const descriptions: Record<string, string> = {
  research: "Реальные источники, наблюдения и направления для новой игры.",
  styles: "Сначала игровой цикл, затем мир и интерфейс в едином стиле.",
  spec: "Объём, критерии качества и бюджет до начала производства.",
  agents: "Задачи, зависимости и фактические результаты рабочих сессий.",
  build: "Сборки, доказательства проверок и восстановление версий.",
  feedback: "Замечания к конкретной версии, экрану или игровой механике.",
  assets: "Происхождение, версии и доступность ресурсов вашей игры.",
  release: "Проверка на телефоне и выпуск конкретной подтверждённой сборки.",
  analytics: "Динамика собственных игр и решения о дальнейшем развитии.",
  finance: "Подключения, квоты и деньги учитываются раздельно.",
  skills: "Закреплённые инструкции и проверка совместимости инструментов.",
};
function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <>
      <section className="welcome">
        <div>
          <div className="eyebrow">ВАША СЛЕДУЮЩАЯ ИГРА НАЧИНАЕТСЯ ЗДЕСЬ</div>
          <h2>
            Место для идей.
            <br />
            Инструменты для результата.
          </h2>
          <p>
            Выберите направление, утвердите концепцию и оформление. Мастерская
            организует разработку, проверки и доработки — от пустой сцены до
            готовой версии.
          </p>
          <button className="primary" onClick={onCreate}>
            Создать первую игру <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="studio-art" aria-hidden="true">
          <div className="orb" />
          <div className="platform p1" />
          <div className="platform p2" />
          <div className="platform p3" />
          <div className="art-caption">
            <Layers size={15} />
            Ваша идея → новый мир
          </div>
        </div>
      </section>
      <div className="grid three">
        {[
          [
            Compass,
            "01",
            "Исследуйте возможность",
            "Публичные данные, конкуренты и собственные отличия.",
          ],
          [
            Palette,
            "02",
            "Выберите характер игры",
            "Мир, персонажи, HUD и меню — в одном пакете.",
          ],
          [
            ShieldCheck,
            "03",
            "Управляйте результатом",
            "Согласования, лимиты, проверки и история версий.",
          ],
        ].map(([Icon, n, t, d]: any) => (
          <section className="card intro" key={n}>
            <div>
              <Icon size={21} />
              <span>{n}</span>
            </div>
            <h3>{t}</h3>
            <p>{d}</p>
          </section>
        ))}
      </div>
    </>
  );
}
function Overview({
  p,
  detail,
  state,
  run,
  action,
  setView,
  setPairing,
  pairing,
}: Ctx) {
  const tasks: Task[] = detail.tasks,
    done = tasks.filter((t) => t.status === "succeeded").length;
  const repairs = productionRepairSources(p, tasks);
  const failure =
    p.execution === "error"
      ? tasks
          .filter(
            (t) =>
              !t.supersededByTaskId &&
              ["failed", "blocked"].includes(t.status) &&
              t.error,
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      : undefined;
  const failureReview = detail.resultReviews?.find(
    (r: ResultReview) => r.id === failure?.reviewId,
  );
  return (
    <>
      <NativeDevelopment
        project={p}
        session={detail.nativeSession}
        onDevelop={(text) => run(() => action("develop", { text }))}
      />
      {failure && (
        <section className="card" role="alert">
          <h2>
            {isModelCapacityError(failure.error)
              ? "Выбранная модель перегружена"
              : "Задача остановлена"}
          </h2>
          <p>
            {failure.title} · {labels[failure.role]}
          </p>
          <p>
            {isModelCapacityError(failure.error)
              ? "Это временная недоступность модели. В «Плане и агентах» выберите другую модель и нажмите «Повторить» у этой задачи либо повторите позже. Повторное согласование проекта не требуется."
              : failureReview?.summary || failure.error?.split("\n")[0]}
          </p>
          {failure.error?.includes("\n") && (
            <details>
              <summary>Подробности замечаний</summary>
              <p className="error-text">{failure.error}</p>
            </details>
          )}
          {!!repairs.length && (
            <>
              <p>
                Проверяющий вернул замечания, а лимит попыток закончился. Можно
                продолжить исправления с сохранёнными результатами. Новая серия
                ограничена {p.settings.maxAttempts} попытками на задачу.
              </p>
              <button
                className="primary repair-production-button"
                onClick={() =>
                  void run(
                    () => action("repair-production", {}),
                    "Исправления запущены по сохранённым замечаниям",
                  )
                }
              >
                Исправить замечания и продолжить <ArrowRight size={16} />
              </button>
            </>
          )}
          <button onClick={() => setView("agents")}>
            Открыть задачу <ArrowRight size={16} />
          </button>
        </section>
      )}
      <div className="grid stats">
        <Stat
          title="Текущий этап"
          value={labels[p.stage]}
          caption={`${stages.indexOf(p.stage) + 1} из 8 этапов`}
          icon={Layers}
        />
        <Stat
          title="Задачи"
          value={`${done} / ${tasks.length}`}
          caption="Завершено в этом проекте"
          icon={Workflow}
        />
        <Stat
          title="Текущая сборка"
          value={p.revision ? `Версия ${p.revision}` : "Ещё не создана"}
          caption="История сохраняется локально"
          icon={Boxes}
        />
        <Stat
          title="Доступный бюджет"
          value={money(detail.budget.availableMicros)}
          caption={
            p.budget.approved ? "Лимит согласован" : "Ожидает согласования"
          }
          icon={Wallet}
        />
      </div>
      <section className="card journey">
        <div className="section-title">
          <div>
            <h2>Путь проекта</h2>
            <p>Каждое решение связано с конкретной версией</p>
          </div>
          <span className="badge">{execution[p.execution]}</span>
        </div>
        <div className="steps">
          {stages.map((s, i) => (
            <button
              key={s}
              onClick={() =>
                setView(
                  (
                    {
                      concept: "styles",
                      style: "styles",
                      specification: "spec",
                      production: "agents",
                      review: "build",
                      release: "release",
                      analytics: "analytics",
                      research: "research",
                    } as any
                  )[s],
                )
              }
              className={
                stages.indexOf(p.stage) === i
                  ? "current"
                  : stages.indexOf(p.stage) > i
                    ? "done"
                    : ""
              }
            >
              <span>
                {stages.indexOf(p.stage) > i ? <Check size={15} /> : i + 1}
              </span>
              <strong>{labels[s]}</strong>
            </button>
          ))}
        </div>
      </section>
      <div className="grid two unequal">
        <section className="card">
          <div className="section-title">
            <div>
              <div className="eyebrow">СЛЕДУЮЩИЙ ШАГ</div>
              <h2>{nextStep[p.stage]?.title}</h2>
            </div>
            <ArrowUpRight size={21} />
          </div>
          <p>{nextStep[p.stage]?.description}</p>
          <button
            className="primary"
            onClick={() => setView(nextStep[p.stage]?.view || "research")}
          >
            Открыть этап <ArrowRight size={16} />
          </button>
          <div className="soft-note">
            <ShieldCheck size={18} />
            <span>
              Сервис проверяет согласования и лимиты перед исполнением.
              Публикация требует отдельного подтверждения.
            </span>
          </div>
        </section>
        <StudioCard {...{ p, state, run, action, setPairing, pairing }} />
      </div>
      {detail.development && (
        <DevelopmentPolicy
          value={detail.development}
          openSkills={() => setView("skills")}
          openChecks={() => setView("build")}
          download={(path) => void run(() => file(path), "Файл скачан")}
        />
      )}
      <section className="card">
        <div className="section-title">
          <h2>Последние события</h2>
          <button className="text-button" onClick={() => setView("agents")}>
            Открыть план
            <ArrowUpRight size={15} />
          </button>
        </div>
        {detail.events.length ? (
          <div className="events">
            {detail.events.slice(0, 6).map((e: any) => (
              <div key={e.seq}>
                <span className="event-icon">
                  <Clock size={15} />
                </span>
                <div>
                  <strong>{eventLabel(e.type)}</strong>
                  <small>
                    {e.body.message ||
                      e.body.summary ||
                      e.body.name ||
                      "Изменение сохранено в истории"}
                  </small>
                </div>
                <time>{date(e.at)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            Здесь появятся решения, задачи и результаты проверок.
          </p>
        )}
      </section>
    </>
  );
}
const nextStep: Record<string, any> = {
  research: {
    title: "Найдите свою возможность",
    description:
      "Начните исследование направления. Если истории ещё нет, выводы будут отмечены как предварительные.",
    view: "research",
  },
  concept: {
    title: "Зафиксируйте игровой цикл",
    description: "Опишите основной сценарий и отличия от референсов.",
    view: "styles",
  },
  style: {
    title: "Выберите мир и интерфейс",
    description:
      "Сравните готовые пакеты мира, иконок и интерфейса. Выбор не требует сборки прототипа.",
    view: "styles",
  },
  specification: {
    title: "Утвердите объём и бюджет",
    description: "Система подготовит подробную спецификацию и оценку расходов.",
    view: "spec",
  },
  production: {
    title: "Следите за разработкой",
    description:
      "Агенты работают по ролям, а изменения собираются через одну очередь.",
    view: "agents",
  },
  review: {
    title: "Проверьте новую версию",
    description: "Изучите результаты сценариев и оставьте замечания.",
    view: "build",
  },
  release: {
    title: "Подготовьте выпуск",
    description: "Пройдите короткий сценарий на телефоне и подтвердите сборку.",
    view: "release",
  },
  analytics: {
    title: "Оцените результат",
    description:
      "Сопоставьте метрики с релизами и выберите направление развития.",
    view: "analytics",
  },
};
function Stat({ title, value, caption, icon: Icon }: any) {
  return (
    <section className="card stat">
      <div>
        {title}
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{caption}</small>
    </section>
  );
}
function StudioCard({ p, state, run, action, setPairing, pairing }: Ctx) {
  const selectedStudio = state.studios.find((s: any) => s.id === p?.studioId);
  const connected = studioOnline(selectedStudio);
  const visibleStudios = state.studios.filter(
    (s: any) => s.id === p?.studioId || studioOnline(s),
  );
  return (
    <section className="card">
      <div className="section-title">
        <h2>Roblox Studio</h2>
        <span className={"badge " + (connected ? "good" : "")}>
          {connected
            ? selectedStudio.playMode
              ? "Игра запущена"
              : "На связи"
            : p?.studioId
              ? "Нет связи"
              : "Не подключена"}
        </span>
      </div>
      <p>Плагин связывает эту мастерскую с выбранной сценой.</p>
      <div className="stack">
        {visibleStudios.map((s: any) => (
          <div className="connection" key={s.id}>
            <Monitor size={20} />
            <div>
              <strong>{s.name}</strong>
              <small>
                Place {s.placeId} · {date(s.lastSeen)}
              </small>
              <small>
                {!studioOnline(s)
                  ? "Подключение не отвечает"
                  : s.playMode
                    ? "Команды ждут остановки Play"
                    : s.projectId && s.projectId !== p?.id
                      ? "Связана с другим проектом"
                      : "Готова к работе"}
              </small>
            </div>
            <button
              disabled={
                s.id === p?.studioId ||
                !studioOnline(s) ||
                !!(s.projectId && s.projectId !== p?.id)
              }
              onClick={() =>
                void run(
                  () => action("studio", { studioId: s.id }),
                  "Studio выбрана",
                )
              }
            >
              {s.id === p?.studioId ? "Выбрана" : "Связать"}
            </button>
          </div>
        ))}
        {!visibleStudios.length && (
          <div className="blank-line">
            <Monitor size={22} />
            <span>Нет подключённых Studio</span>
          </div>
        )}
        <div className="button-row">
          {p?.studioId && (
            <button
              onClick={() =>
                void run(
                  () => action("studio/unbind"),
                  "Studio отвязана от проекта",
                )
              }
            >
              Отвязать Studio
            </button>
          )}
          <button
            onClick={() =>
              void run(async () => {
                const r = await api("/pairing", {});
                setPairing(r);
                return r;
              }, "Код подключения готов")
            }
          >
            <Link size={15} />
            Код подключения
          </button>
          <button
            className="subtle"
            onClick={() =>
              void run(async () => {
                const r = await fetch("/api/plugin", { headers: auth() });
                if (!r.ok) throw new Error("Не удалось скачать плагин");
                const url = URL.createObjectURL(await r.blob());
                const a = document.createElement("a");
                a.href = url;
                a.download = "Automation.rbxmx";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }, "Плагин скачан")
            }
          >
            <Download size={15} />
            Плагин
          </button>
        </div>
        {pairing && (
          <div className="pair-code">
            <strong>{pairing.code}</strong>
            <small>Введите в плагине до {date(pairing.expiresAt)}</small>
            <small>{pairing.url}</small>
          </div>
        )}
      </div>
    </section>
  );
}
function Research({ p, state, detail, run, action, mutate }: Ctx) {
  return (
    <>
      <div className="grid two unequal">
        <section className="card">
          <div className="eyebrow">ИССЛЕДОВАНИЕ</div>
          <h2>{p.genre}</h2>
          <p>{p.goal}</p>
          <p className="soft-note">
            Язык игры: English · автоматическая локализация Roblox
          </p>
          <button
            className="primary"
            onClick={() =>
              void run(
                () => action("phase", { phase: "research" }),
                "Исследование поставлено в очередь",
              )
            }
          >
            <Compass size={16} />
            Исследовать направление
          </button>
          <div className="soft-note">
            <Clock size={17} />
            <span>
              Одно значение онлайна не доказывает тренд. Без истории рост и
              устойчивость остаются неизвестными.
            </span>
          </div>
        </section>
        <section className="card">
          <h2>Наблюдение за конкурентами</h2>
          <p>
            Снимки публичных показателей Roblox. Укажите Universe ID через
            запятую.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api("/trends", {
                    universeIds: String(f.get("ids"))
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                "Снимки получены",
              );
            }}
          >
            <label>
              Universe ID
              <input name="ids" required placeholder="123456789, 987654321" />
            </label>
            <button>
              <RefreshCw size={15} />
              Получить снимки
            </button>
          </form>
        </section>
      </div>
      {state.trendRanking.length > 0 && (
        <section className="card">
          <h2>Динамика наблюдений</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Игра</th>
                  <th>Онлайн</th>
                  <th>Изменение</th>
                  <th>Наблюдения</th>
                  <th>Вывод</th>
                </tr>
              </thead>
              <tbody>
                {state.trendRanking.map((r: any) => (
                  <tr key={r.universeId}>
                    <td>
                      {r.name}
                      <small>{date(r.fetchedAt)}</small>
                    </td>
                    <td>{r.online ?? "Неизвестно"}</td>
                    <td>
                      {r.growth === null
                        ? "Неизвестно"
                        : Math.round(r.growth * 100) + "%"}
                    </td>
                    <td>{r.samples}</td>
                    <td>
                      {r.preliminary ? "Предварительно" : `Оценка ${r.score}`}
                      <small>{r.formula}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {detail.research.map((r: any) => (
        <section key={r.id} className="card">
          <h2>Результаты исследования</h2>
          {r.effortRun && (
            <small title={r.effortRun.reason}>
              Effort проверки: {r.effortRun.effort} · {r.effortRun.model}
            </small>
          )}
          <p>{r.summary}</p>
          <div className="grid three">
            {r.concepts?.map((c: any, i: number) => (
              <div className="concept" key={i}>
                <span className="eyebrow">КОНЦЕПЦИЯ {i + 1}</span>
                <h3>{c.title}</h3>
                <p>
                  {typeof c.loop === "string" ? c.loop : JSON.stringify(c.loop)}
                </p>
                <p className="muted">
                  {typeof c.differences === "string"
                    ? c.differences
                    : JSON.stringify(c.differences)}
                </p>
                <button
                  onClick={() =>
                    void run(
                      () => mutate({ concept: JSON.stringify(c, null, 2) }),
                      "Концепция выбрана. Её можно изменить и утвердить на вкладке стиля.",
                    )
                  }
                >
                  Выбрать
                  <ArrowRight size={15} />
                </button>
              </div>
            ))}
          </div>
          <details>
            <summary>Источники и доказательства</summary>
            <pre>{JSON.stringify(r.sources, null, 2)}</pre>
          </details>
        </section>
      ))}
    </>
  );
}
function Styles({ p, state, detail, run, mutate, action }: Ctx) {
  const selectedPackage: StylePackage | undefined = detail.styles.find(
    (s: StylePackage) => s.id === p.selectedStyle,
  );
  const presetId = (selectedPackage?.rules.preset as { id: string } | undefined)
    ?.id;
  const [historyOpen, setHistoryOpen] = useState(false);
  const legacyStyles: StylePackage[] = detail.styles.filter(
    (s: StylePackage) => !s.rules.preset,
  );
  const [legacyScreen, setLegacyScreen] = useState("hud");
  return (
    <>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Краткая концепция</h2>
            <p>Основной цикл, аудитория, отличия и необходимые экраны</p>
          </div>
          {p.approvals.concept && (
            <span className="badge good">
              <Check size={13} />
              Утверждена
            </span>
          )}
        </div>
        <textarea
          key={p.concept}
          defaultValue={p.concept}
          rows={5}
          aria-label="Краткая концепция"
          onBlur={(e) => {
            if (e.target.value !== p.concept)
              void run(() => mutate({ concept: e.target.value }));
          }}
          placeholder="Опишите игровой цикл или выберите концепцию из исследования"
        />
        <button
          className="primary"
          onClick={() =>
            void run(
              () => action("approve", { name: "concept" }),
              "Концепция утверждена",
            )
          }
        >
          <Check size={16} />
          Утвердить концепцию
        </button>
      </section>
      <StylePresetLibrary
        library={
          detail.uiStyles || state.uiStyles || { items: [], error: null }
        }
        selectedId={presetId}
        onSelect={(id) =>
          run(
            () => action("styles/preset", { presetId: id }),
            "Стиль выбран. Его версия, иконки и раскладки закреплены за проектом.",
          )
        }
      />
      {selectedPackage && (
        <section
          className="card selected-style-card"
          aria-label="Выбранное оформление"
        >
          <div className="section-title">
            <div>
              <h2>Выбрано: {selectedPackage.name}</h2>
              <p>
                {presetId
                  ? "Этот пакет будет использован для интерфейса и оформления игры."
                  : "Вариант из предыдущей итерации. Можно сохранить его или выбрать готовый пакет выше."}
              </p>
            </div>
            <span className={"badge " + (p.approvals.style ? "good" : "")}>
              {p.approvals.style
                ? "Выбор утверждён"
                : presetId
                  ? "Готов к утверждению"
                  : "Предыдущий вариант"}
            </span>
          </div>
          {!presetId && (
            <AssetPreview
              path={
                preferredStylePreview(selectedPackage, "hud", "desktop")?.file
              }
              label={selectedPackage.name}
            />
          )}
          <button
            className="primary"
            disabled={!p.approvals.concept || !!p.approvals.style}
            onClick={() =>
              void run(
                () => action("approve", { name: "style" }),
                "Оформление утверждено. Можно подготовить спецификацию.",
              )
            }
          >
            <Check size={16} />
            {p.approvals.style
              ? "Оформление утверждено"
              : "Утвердить выбранное оформление"}
          </button>
          {!p.approvals.concept && (
            <p className="muted">Сначала утвердите краткую концепцию выше.</p>
          )}
          {presetId && (
            <p className="muted">
              Работу интерфейса на устройствах система проверит в Studio при
              создании игры.
            </p>
          )}
        </section>
      )}
      {(legacyStyles.length > 0 || detail.styleHistory?.length > 0) && (
        <details
          className="card legacy-style-history"
          onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
        >
          <summary>
            Варианты из предыдущих итераций (
            {legacyStyles.length + (detail.styleHistory?.length || 0)})
          </summary>
          {historyOpen && (
            <>
              <p>
                Материалы сохранены. Готовые пакеты выше заменяют прежний этап
                сборки демонстраций для выбора оформления.
              </p>
              {!!legacyStyles.length && (
                <>
                  <select
                    aria-label="Экран прежнего варианта"
                    value={legacyScreen}
                    onChange={(e) => setLegacyScreen(e.target.value)}
                  >
                    <option value="hud">Сцена и HUD</option>
                    <option value="shop">Магазин</option>
                    <option value="inventory">Инвентарь</option>
                    <option value="menu">Главное меню</option>
                  </select>
                  <div className="grid three">
                    {legacyStyles.map((s) => {
                      const image = preferredStylePreview(
                        s,
                        legacyScreen,
                        "desktop",
                      );
                      return (
                        <article className="concept" key={s.id}>
                          <h3>{s.name}</h3>
                          <AssetPreview path={image?.file} label={s.name} />
                          <small>
                            {image?.kind === "studio"
                              ? "Снимок Studio"
                              : "Сохранённый эскиз, не снимок Studio"}
                          </small>
                          <StyleDetails style={s} />
                          <button
                            onClick={() =>
                              void run(
                                () => mutate({ selectedStyle: s.id }),
                                "Предыдущий вариант выбран",
                              )
                            }
                          >
                            Выбрать прежний вариант
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
              {detail.styleHistory?.map((s: StylePackage) => (
                <p key={s.id}>
                  {s.name} · v{s.version} · архив
                </p>
              ))}
            </>
          )}
        </details>
      )}
    </>
  );
}
const Preview = AssetPreview;
function Specification({ p, detail, run, mutate, action }: Ctx) {
  const review: ResultReview | undefined = detail.resultReviews?.find(
    (r: ResultReview) => r.id === p.specificationArtifact?.reviewId,
  );
  const pending = detail.tasks.some(
    (t: Task) =>
      t.kind === "specification" &&
      ["queued", "running", "reviewing", "dependencies"].includes(t.status),
  );
  const legacy =
    !p.specificationArtifact &&
    detail.tasks.some(
      (t: Task) =>
        t.kind === "specification" &&
        t.result?.data.specification === p.specification,
    );
  return (
    <>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Окончательная спецификация</h2>
            <p>Игровой цикл, объём, экономика, устройства и критерии приёмки</p>
          </div>
          <button
            disabled={pending}
            onClick={() =>
              void run(
                () => action("phase", { phase: "specification" }),
                "Подготовка спецификации запущена",
              )
            }
          >
            Подготовить спецификацию
            <ArrowUpRight size={15} />
          </button>
        </div>
        {pending && (
          <p className="soft-note" role="status">
            Готовим документ. Ответ исполнителя появится здесь после проверки
            оркестратором.
          </p>
        )}
        {legacy && !pending && (
          <div className="soft-note">
            <p>
              Сохранённый ответ ещё не прошёл проверку оркестратора. Можно
              проверить готовый SPEC.md без повторной генерации.
            </p>
            <button
              onClick={() =>
                void run(
                  () => action("specification/review"),
                  "Документ передан оркестратору",
                )
              }
            >
              <ShieldCheck size={15} /> Проверить сохранённый документ
            </button>
          </div>
        )}
        <SpecificationDocument
          key={p.id}
          text={legacy ? "" : p.specification}
          reviewed={review?.status === "accepted" && !!review.appliedAt}
          source={
            review?.status === "accepted"
              ? `Проверка завершена ${date(review.reviewedAt)}`
              : undefined
          }
          onSave={(text) =>
            run(
              () => mutate({ specification: text }),
              "Документ сохранён; требуется новое согласование",
            )
          }
          onDownload={
            p.specificationArtifact
              ? () =>
                  void run(
                    () => file(p.specificationArtifact!.file, "SPEC.md"),
                    "SPEC.md скачан",
                  )
              : undefined
          }
        />
        <button
          className="primary"
          disabled={pending || legacy || !p.specification.trim()}
          onClick={() =>
            void run(
              () => action("approve", { name: "specification" }),
              "Спецификация утверждена",
            )
          }
        >
          Утвердить эту спецификацию
          <Check size={16} />
        </button>
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Оценка и лимит</h2>
          {p.budget.approved && <span className="badge good">Согласован</span>}
        </div>
        <p className="pre-wrap">{p.budget.estimate}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              await mutate({
                budget: {
                  limitMicros: Math.round(Number(f.get("limit")) * 1e6),
                },
                settings: {
                  dailyLimitMicros: Math.round(Number(f.get("daily")) * 1e6),
                },
              });
              return action("approve", { name: "budget" });
            }, "Бюджет согласован");
          }}
        >
          <div className="grid two">
            <label>
              Общий лимит внешних расходов, USD
              <input
                name="limit"
                type="number"
                min="0"
                step="0.01"
                defaultValue={p.budget.limitMicros / 1e6}
                required
              />
            </label>
            <label>
              Дневной лимит, USD
              <input
                name="daily"
                type="number"
                min="0"
                step="0.01"
                defaultValue={p.settings.dailyLimitMicros / 1e6}
                required
              />
            </label>
          </div>
          <small className="muted">
            Нулевой лимит разрешает работу Codex по подписочной квоте и
            собственное процедурное создание. Платные запросы потребуют резерва.
          </small>
          <div className="button-row">
            <button>
              Согласовать лимит
              <ShieldCheck size={15} />
            </button>
            <button
              className="primary"
              type="button"
              onClick={() =>
                void run(
                  () => action("phase", { phase: "production" }),
                  "Разработка запущена",
                )
              }
            >
              Начать производство
              <Play size={16} />
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
function ReviewHistory({
  task,
  reviews,
}: {
  task: Task;
  reviews: ResultReview[];
}) {
  const history = reviews.filter((r) => r.taskId === task.id);
  if (!history.length)
    return task.threadId && task.result ? (
      <small className="muted">
        Прежний результат: проверка оркестратора не записана.
      </small>
    ) : null;
  const names: Record<ResultReview["status"], string> = {
    queued: "Ожидает проверки",
    reviewing: "Оркестратор проверяет результат",
    accepted: "Оркестратор принял результат",
    rejected: "Возвращён исполнителю",
    blocked: "Проверка остановлена",
    stale: "Результат устарел",
  };
  return (
    <details className="review-history">
      <summary>Проверка оркестратора · {names[history.at(-1)!.status]}</summary>
      {history.map((r) => (
        <div key={r.id} className="review-entry">
          <strong>{names[r.status]}</strong>
          <small>{date(r.reviewedAt || r.createdAt)}</small>
          <p>{r.summary}</p>
          {!!r.issues.length && (
            <ul>
              {r.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </details>
  );
}
function Agents({ p, detail, state, run, mutate }: Ctx) {
  const repairs = productionRepairSources(p, detail.tasks);
  const newestTasks: Task[] = [...detail.tasks]
    .reverse()
    .sort((a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <ProductionPlan
        project={p}
        tasks={detail.tasks}
        review={detail.planReview}
      />
      <AgentPolicy
        project={p}
        onEnable={() =>
          run(() =>
            mutate({
              settings: {
                agentPolicy: SPECIALIST_POLICY,
                productionMode: "single-owner",
                model: null,
              },
            }),
          )
        }
      />
      <ExternalReviewer state={state.externalReviewer} run={run} />
      {!!repairs.length && (
        <section className="card">
          <h2>Сборку блокируют задачи с исчерпанными попытками</h2>
          <p>
            Таких задач: {repairs.length}. Сохранённые результаты и замечания
            можно передать на исправление, сохранив готовую работу.
          </p>
          <button
            className="primary repair-production-button"
            onClick={() =>
              void run(
                () => api("/projects/" + p.id + "/repair-production", {}),
                "Исправления запущены",
              )
            }
          >
            Исправить замечания и продолжить
          </button>
        </section>
      )}
      <section className="card">
        <h2>Ограничения исполнения</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                mutate({
                  settings: {
                    maxAttempts: Number(f.get("attempts")),
                    timeoutMinutes: Number(f.get("timeout")),
                    autoResumeQuota: f.get("auto") === "on",
                    autoResetLimits: f.get("resets") === "on",
                    testAcceptance: f.get("tests") === "on",
                    creditsFloor:
                      f.get("floor") === "" ? null : Number(f.get("floor")),
                    freeCreditsOnly: f.get("credits") === "on",
                  },
                }),
              "Ограничения сохранены",
            );
          }}
        >
          <div className="grid two">
            <label>
              Попыток исправления
              <input
                name="attempts"
                type="number"
                min="1"
                max="6"
                required
                defaultValue={p.settings.maxAttempts}
              />
            </label>
            <label>
              Минут на задачу
              <input
                name="timeout"
                type="number"
                min="1"
                max="180"
                required
                defaultValue={p.settings.timeoutMinutes}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              name="auto"
              type="checkbox"
              defaultChecked={p.settings.autoResumeQuota}
            />
            Возобновлять после подтверждённого восстановления квоты
          </label>
          <label className="checkbox">
            <input
              name="tests"
              type="checkbox"
              defaultChecked={!!p.settings.testAcceptance}
            />
            Принимать этап только после того, как мастерская сама запустит тесты
            игры в Studio и они пройдут (действует для новых задач этапов)
          </label>
          <label className="checkbox">
            <input
              name="resets"
              type="checkbox"
              defaultChecked={!!p.settings.autoResetLimits}
            />
            Тратить бесплатный сброс лимита, если квота исчерпана больше чем за
            6 часов до её обычного сброса
          </label>
          <label>
            Работать на кредитах аккаунта, пока их баланс выше (пусто — кредиты
            не тратить)
            <input
              name="floor"
              type="number"
              min="0"
              defaultValue={p.settings.creditsFloor ?? ""}
            />
          </label>
          <label className="checkbox">
            <input
              name="credits"
              type="checkbox"
              defaultChecked={p.settings.freeCreditsOnly}
            />
            В прямом API режиме использовать только подтверждённые применимые
            бесплатные кредиты
          </label>
          <button>Сохранить ограничения</button>
        </form>
      </section>
      <div className="grid four">
        {roles.map((r) => {
          const tasks = detail.tasks.filter((t: Task) => t.role === r);
          return (
            <section className="card role" key={r}>
              <span className={"role-icon " + r}>
                <Workflow size={20} />
              </span>
              <h3>{labels[r]}</h3>
              <small>
                {usesSpecialists(p)
                  ? `${specialistProfile({ role: r, kind: "" }, false, state.codex.backend).model} · Medium`
                  : `Базовый effort: ${ROLE_EFFORT[r]}`}
              </small>
              <small>
                {tasks.filter((t: Task) => t.status === "running").length
                  ? "Работает"
                  : tasks.length
                    ? `${tasks.filter((t: Task) => t.status === "succeeded").length} из ${tasks.length} выполнено`
                    : "Нет задач"}
              </small>
            </section>
          );
        })}
      </div>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>План работ</h2>
            <p>
              Каждая сессия получает роль, закреплённые навыки и область
              изменений
            </p>
          </div>
          {!usesSpecialists(p) && (
            <label className="inline">
              Модель
              <select
                aria-label="Модель агентов"
                value={p.settings.model || ""}
                onChange={(e) =>
                  void run(() =>
                    mutate({ settings: { model: e.target.value || null } }),
                  )
                }
              >
                <option value="">По умолчанию {agentName(state.codex)}</option>
                {state.codex.models.map((m: any) => (
                  <option key={m.id} value={m.model}>
                    {m.displayName || m.model}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="inline">
            Параллельно
            <select
              value={p.settings.parallelism}
              onChange={(e) =>
                void run(() =>
                  mutate({ settings: { parallelism: Number(e.target.value) } }),
                )
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        {!detail.tasks.length ? (
          <Blank text="Задачи появятся после запуска этапа." />
        ) : (
          <div className="task-list">
            {newestTasks.map((t: Task) => (
              <article key={t.id}>
                <div className={"task-state " + t.status}>
                  {t.status === "succeeded" ? (
                    <Check size={18} />
                  ) : (
                    <Workflow size={18} />
                  )}
                </div>
                <div className="task-body">
                  <strong>{t.title}</strong>
                  <small>
                    {labels[t.role]} · база v{t.baseRevision} · попытка{" "}
                    {t.attempt}/{t.maxAttempts} · {t.provider}
                  </small>
                  {t.repairOfTaskId && (
                    <small>
                      Исправление по сохранённым замечаниям проверяющего
                    </small>
                  )}
                  {t.supersededByTaskId && (
                    <small>
                      Продолжение перенесено в новую задачу исправления
                    </small>
                  )}
                  <TaskEffort
                    specialists={usesSpecialists(p)}
                    backend={state.codex.backend}
                    task={t}
                    reviews={detail.resultReviews || []}
                    tasks={detail.tasks}
                    run={run}
                  />
                  {t.error && (
                    <p className="error-text">
                      {isModelCapacityError(t.error)
                        ? "Выбранная модель перегружена. Выберите другую модель выше и нажмите «Повторить» либо повторите позже. Это не ошибка игры и не исчерпание квоты."
                        : t.error}
                    </p>
                  )}
                  {t.result && <p>{t.result.summary}</p>}
                  <ReviewHistory
                    task={t}
                    reviews={detail.resultReviews || []}
                  />
                  <details>
                    <summary>Контракт, навыки и зависимости</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          scope: t.scope,
                          dependencies: t.dependencies,
                          skills: t.skills,
                          threadId: t.threadId,
                          instructions: t.instructions,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
                <div className="stack">
                  <span className={"badge " + t.status}>
                    {status[t.status]}
                  </span>
                  {!t.supersededByTaskId &&
                    ["blocked", "failed"].includes(t.status) &&
                    (t.attempt < t.maxAttempts ||
                      isModelCapacityError(t.error) ||
                      detail.resultReviews?.some(
                        (r: ResultReview) =>
                          r.id === t.reviewId && r.status === "blocked",
                      )) && (
                      <button
                        onClick={() =>
                          void run(
                            () => api("/tasks/" + t.id + "/retry", {}),
                            "Задача поставлена на повтор с прежней причиной ошибки",
                          )
                        }
                      >
                        Повторить
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function TaskEffort({
  specialists = false,
  backend,
  task,
  reviews,
  tasks,
  run,
}: {
  specialists?: boolean;
  backend?: "codex" | "claude";
  task: Task;
  reviews: ResultReview[];
  tasks: Task[];
  run: Ctx["run"];
}) {
  if (specialists && task.provider !== "studio")
    return (
      <>
        <small>
          {task.effortRun
            ? `Последний запуск: ${task.effortRun.model} · ${task.effortRun.effort}`
            : "Запуск ещё не записан"}
        </small>
        <small>
          Следующий запуск: {specialistProfile(task, false, backend).model} ·
          Medium
        </small>
      </>
    );
  if (task.provider === "studio")
    return <small>Effort не применяется к операции Studio</small>;
  const lineage = new Set<string>();
  let ancestor: Task | undefined = task;
  while (ancestor && !lineage.has(ancestor.id)) {
    lineage.add(ancestor.id);
    ancestor = tasks.find((t) => t.id === ancestor?.repairOfTaskId);
  }
  const rejected = reviews.filter(
    (r) => lineage.has(r.taskId) && r.status === "rejected",
  ).length;
  const plan = planEffort(task, rejected);
  const editable =
    !task.supersededByTaskId &&
    task.provider === "codex" &&
    ["queued", "dependencies", "planned", "blocked", "failed"].includes(
      task.status,
    );
  return (
    <>
      <small title={task.effortRun?.reason}>
        {task.effortRun
          ? `Effort последнего запуска: ${task.effortRun.effort} · ${task.effortRun.model}`
          : "Effort прежнего запуска не записан"}
      </small>
      {editable && (
        <details>
          <summary>Следующий запуск: effort {plan?.effort} · Настроить</summary>
          <p>
            {plan?.reason}. После содержательных замечаний уровень повышается до
            xhigh. Технические сбои его не повышают.
          </p>
          <form
            key={JSON.stringify([
              task.effortClass,
              task.effortOverride,
              task.effortOverrideReason,
            ])}
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run(
                () =>
                  api("/tasks/" + task.id + "/effort", {
                    complexity: form.get("complexity"),
                    override: form.get("override") || null,
                    reason: form.get("reason"),
                  }),
                "Effort сохранён для следующего запуска",
              );
            }}
          >
            <label>
              Тип задачи
              <select
                name="complexity"
                defaultValue={task.effortClass || "standard"}
              >
                <option value="standard">Обычная задача роли</option>
                <option value="routine">Небольшая точная правка</option>
                <option value="complex">Повышенная сложность</option>
                <option value="diagnostic">Сложная диагностика</option>
              </select>
            </label>
            <label>
              Effort
              <select
                name="override"
                aria-label="Effort задачи"
                defaultValue={task.effortOverride || ""}
              >
                <option value="">Автоматически по правилам</option>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Причина ручного выбора
              <input
                name="reason"
                defaultValue={task.effortOverrideReason || ""}
                maxLength={2000}
              />
            </label>
            <small>
              low — только для небольшой точной правки. max — только для
              диагностики после запуска xhigh.
            </small>
            <button>Сохранить effort</button>
          </form>
        </details>
      )}
    </>
  );
}
function Build({ p, detail, run, action }: Ctx) {
  const v: Version | undefined = detail.versions.find(
    (v: Version) => v.revision === p.revision,
  );
  return (
    <>
      <VersionComparison
        versions={detail.versions}
        load={(from, to) =>
          api(
            `/projects/${p.id}/version-diff?` +
              new URLSearchParams({ from, to }),
          )
        }
      />
      <div className="grid two">
        <section className="card">
          <h2>Текущая сборка</h2>
          <strong className="big-number">{v ? `v${v.revision}` : "—"}</strong>
          <p>
            {v
              ? v.manifest.summary
              : "Сборка будет создана из проверенных результатов агентов."}
          </p>
          <div className="button-row">
            <button
              disabled={!v}
              onClick={() =>
                void run(
                  () =>
                    file(
                      `projects/${p.id}/versions/${v!.revision}/place.rbxlx`,
                    ),
                  "Сборка скачана",
                )
              }
            >
              <Download size={15} />
              Открыть в Studio
            </button>
            <button
              onClick={() =>
                void run(
                  () => action("commands", { operation: "snapshot" }),
                  "Снимок запрошен",
                )
              }
            >
              Снимок сцены
            </button>
          </div>
        </section>
        <section className="card">
          <h2>Проверка в Studio</h2>
          <p>
            Запуск реальных сценариев через плагин. Недоступная проверка
            остаётся заблокированной.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={!v}
              onClick={() =>
                void run(
                  () => action("commands", { operation: "test" }),
                  "Проверка поставлена в очередь",
                )
              }
            >
              <Play size={15} />
              Запустить проверки
            </button>
            <button
              onClick={() =>
                void run(
                  () => action("commands", { operation: "capture" }),
                  "Снимок экрана запрошен",
                )
              }
            >
              <Monitor size={15} />
              Снимок экрана
            </button>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="section-title">
          <h2>Обязательные сценарии</h2>
          <span className="badge">
            {v?.checks.filter((c) => c.status === "passed").length || 0} /{" "}
            {p.requiredChecks.length}
          </span>
        </div>
        {v ? (
          <div className="check-grid">
            {v.checks.map((c) => (
              <div key={c.id}>
                <span className={"task-state " + c.status}>
                  {c.status === "passed" ? (
                    <Check size={17} />
                  ) : (
                    <Clock size={17} />
                  )}
                </span>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {status[c.status]} · {c.evidence || "Нет доказательств"}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Blank text="Нет сборки для проверки." />
        )}
      </section>
      <section className="card">
        <div className="section-title">
          <h2>История версий</h2>
          <button
            onClick={() =>
              void run(() => api("/backups", {}), "Резервная копия создана")
            }
          >
            Резервная копия
            <Download size={15} />
          </button>
        </div>
        {detail.versions.map((v: Version) => (
          <div className="version-row" key={v.id}>
            <span className="version-tag">v{v.revision}</span>
            <div>
              <strong>{v.reason}</strong>
              <small>
                {date(v.createdAt)} · {v.hash.slice(0, 12)} · стиль v
                {v.styleVersion}
              </small>
            </div>
            <button
              onClick={() =>
                void run(
                  () => action("restore", { versionId: v.id }),
                  "Откат поставлен в очередь",
                )
              }
            >
              Восстановить
            </button>
          </div>
        ))}
        {!detail.versions.length && (
          <Blank text="Контрольные версии ещё не создавались." />
        )}
      </section>
      <section className="card">
        <h2>Очередь Studio</h2>
        {detail.commands.map((c: any) => (
          <details key={c.id}>
            <summary>
              {c.operation} · {c.status} · {date(c.createdAt)}
            </summary>
            <pre>{JSON.stringify(c.result, null, 2)}</pre>
            {c.status === "uncertain" && (
              <>
                <p>
                  Переподключите плагин для повторной отправки сохранённого
                  результата. Если результата нет, сначала осмотрите сцену.
                </p>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        api("/commands/" + c.id + "/reconcile", {
                          action: "mark-failed",
                        }),
                      "Неуспех подтверждён",
                    )
                  }
                >
                  Подтверждаю: операция не завершена
                </button>
              </>
            )}
            {c.operation === "snapshot" && c.status === "succeeded" && (
              <button
                onClick={() =>
                  void run(
                    () => action("studio/adopt", { commandId: c.id }),
                    "Снимок принят как новая версия. Проверки сброшены.",
                  )
                }
              >
                Принять правки Studio новой версией
              </button>
            )}
            {c.operation === "capture" && c.status === "succeeded" && (
              <Preview path={`captures/${c.id}.png`} />
            )}
          </details>
        ))}
      </section>
    </>
  );
}
function Feedback({ detail, run, action }: Ctx) {
  const [attachments, setAttachments] = useState<MarkedImage[]>([]);
  return (
    <div className="grid two unequal">
      <section className="card">
        <h2>Что изменить?</h2>
        <p>
          Фидбек сам запускает доработку в рамках утверждённой спецификации и
          бюджета, на безопасной границе текущей задачи.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                action("feedback", { ...Object.fromEntries(f), attachments }),
              "Замечание сохранено",
            );
            e.currentTarget.reset();
          }}
        >
          <label>
            Замечание
            <textarea
              name="text"
              required
              minLength={3}
              rows={6}
              placeholder="Например, увеличьте кнопки магазина на телефоне"
            />
          </label>
          <div className="grid two">
            <label>
              Элемент
              <input
                name="target"
                defaultValue="game"
                placeholder="Экран, объект, механика"
              />
            </label>
            <label>
              Приоритет
              <select name="priority">
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
                <option value="blocker">Блокирующий</option>
              </select>
            </label>
          </div>
          <FeedbackAttachment run={run} onChange={setAttachments} />
          <button className="primary">
            Передать в работу
            <ArrowRight size={15} />
          </button>
        </form>
      </section>
      <section className="card">
        <h2>История доработок</h2>
        {detail.feedback.map((f: any) => (
          <article className="feedback-item" key={f.id}>
            <div>
              <span className="badge">
                v{f.revision} · {f.status}
              </span>
              <small>{date(f.createdAt)}</small>
            </div>
            <h3>{f.target}</h3>
            <p>{f.text}</p>
            <small>{f.taskIds.length} связанных задач</small>
          </article>
        ))}
        {!detail.feedback.length && (
          <Blank text="Здесь сохранятся замечания и связанные с ними задачи." />
        )}
      </section>
    </div>
  );
}
function Assets({ detail }: Ctx) {
  return (
    <section className="card">
      <h2>Ресурсы проекта</h2>
      <p>
        Источник, разрешения, модерация и доступность для целевого experience.
      </p>
      {detail.assets.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ресурс</th>
                <th>Источник</th>
                <th>Лицензия</th>
                <th>Стиль</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {detail.assets.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.source || "Неизвестно"}</td>
                  <td>{a.license || "Не подтверждена"}</td>
                  <td>v{a.styleVersion ?? "?"}</td>
                  <td>{a.status || "Не проверен"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Blank text="Ресурсы появятся после производства. Неподтверждённые зависимости не считаются готовыми." />
      )}
    </section>
  );
}
function Releases({ p, detail, run, mutate, action }: Ctx) {
  const v: Version | undefined = detail.versions.find(
    (v: Version) => v.revision === p.revision,
  );
  const [accepted, setAccepted] = useState<string[]>([]);
  return (
    <>
      <section className="card">
        <h2>Целевой experience</h2>
        <div className="grid two">
          <label>
            Universe ID
            <input
              defaultValue={p.universeId}
              onBlur={(e) =>
                void run(() => mutate({ universeId: e.target.value }))
              }
            />
          </label>
          <label>
            Place ID
            <input
              defaultValue={p.placeId}
              onBlur={(e) =>
                void run(() => mutate({ placeId: e.target.value }))
              }
            />
          </label>
        </div>
      </section>
      <div className="grid two">
        <section className="card">
          <h2>Проверка на реальном телефоне</h2>
          <ol className="phone-steps">
            <li>
              Запустите именно сборку v{p.revision} в настроенном тестовом
              experience.
            </li>
            <li>Пройдите обучение и основной цикл, проверьте управление.</li>
            <li>Откройте магазин и инвентарь, проверьте читаемость.</li>
            <li>Переподключитесь и проверьте прогресс. Запишите замечания.</li>
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  action("phone", {
                    device: f.get("device"),
                    passed: f.get("passed") === "on",
                    notes: f.get("notes"),
                  }),
                "Результат проверки телефона сохранён",
              );
            }}
          >
            <label>
              Модель телефона
              <input
                name="device"
                required
                minLength={3}
                placeholder="Устройство и версия ОС"
              />
            </label>
            <label>
              Результат и замечания
              <textarea name="notes" rows={3} required />
            </label>
            <label className="checkbox">
              <input type="checkbox" name="passed" />
              Сценарий пройден на реальном устройстве
            </label>
            <button disabled={!v}>
              Сохранить проверку
              <Smartphone size={15} />
            </button>
          </form>
          {v?.phone && (
            <p className="muted">
              {v.phone.device} · {date(v.phone.at)} ·{" "}
              {v.phone.passed ? "пройдена" : "не пройдена"}
            </p>
          )}
        </section>
        <section className="card">
          <h2>Карточка релиза {v ? `v${v.revision}` : ""}</h2>
          {detail.blockers.length ? (
            <div className="blockers">
              <strong>До выпуска осталось</strong>
              {detail.blockers.map((b: string) => (
                <p key={b}>
                  <AlertCircle size={15} />
                  {b}
                </p>
              ))}
            </div>
          ) : (
            <div className="soft-note">
              <Check size={18} />
              Обязательные проверки пройдены
            </div>
          )}
          {v?.findings
            .filter((f) => f.severity === "minor")
            .map((f) => (
              <label className="checkbox" key={f.message}>
                <input
                  type="checkbox"
                  checked={accepted.includes(f.message)}
                  onChange={(e) =>
                    setAccepted(
                      e.target.checked
                        ? [...accepted, f.message]
                        : accepted.filter((v) => v !== f.message),
                    )
                  }
                />
                Принимаю недочёт: {f.message}
              </label>
            ))}
          <button
            className="primary"
            disabled={detail.blockers.length > 0}
            onClick={() =>
              void run(
                () =>
                  action("releases/approve", { acceptedMinorIssues: accepted }),
                "Конкретная версия подтверждена к публикации",
              )
            }
          >
            Подтвердить эту версию
            <ShieldCheck size={16} />
          </button>
          <p className="muted">
            Подтверждение закрепляет сборку и experience. Изменение любого из
            них потребует нового решения.
          </p>
        </section>
      </div>
      <section className="card">
        <h2>История выпусков</h2>
        {detail.releases.map((r: any) => (
          <div className="version-row" key={r.id}>
            <span className="version-tag">v{r.revision}</span>
            <div>
              <strong>{r.status}</strong>
              <small>
                {r.hash.slice(0, 12)} · {date(r.createdAt)}
              </small>
            </div>
            {r.status === "approved" && (
              <button
                className="primary"
                onClick={() =>
                  void run(
                    () => api("/releases/" + r.id + "/publish", {}),
                    "Версия опубликована",
                  )
                }
              >
                Опубликовать в Roblox
                <Send size={15} />
              </button>
            )}
            {r.result?.url && (
              <a href={r.result.url} target="_blank" rel="noreferrer">
                Открыть игру
                <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        ))}
        {!detail.releases.length && <Blank text="Выпусков пока нет." />}
      </section>
    </>
  );
}
function Analytics({ p, detail, run, action }: Ctx) {
  const names: Record<string, string> = {
    active_players: "Активные игроки",
    d1: "Удержание D1",
    d7: "Удержание D7",
    session_minutes: "Средняя сессия",
    revenue: "Выручка",
  };
  return (
    <>
      <div className="grid stats">
        {Object.entries(names).map(([key, title]) => {
          const rows = detail.metrics
            .filter((m: any) => m.metric === key)
            .sort((a: any, b: any) => a.date.localeCompare(b.date));
          const m = rows.at(-1);
          return (
            <Stat
              key={key}
              title={title}
              value={m?.value == null ? "Нет данных" : String(m.value)}
              caption={
                m ? `${m.date} · ${m.unit}` : "Неизвестное не заменяется нулём"
              }
              icon={ChartNoAxesCombined}
            />
          );
        })}
      </div>
      <div className="grid two">
        <section className="card">
          <h2>Получение метрик</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  action("metrics/sync", {
                    start: new Date(String(f.get("start"))).toISOString(),
                    end: new Date(String(f.get("end"))).toISOString(),
                    releaseId: f.get("releaseId") || null,
                  }),
                "Синхронизация завершена",
              );
            }}
          >
            <div className="grid two">
              <label>
                С даты
                <input name="start" type="date" required />
              </label>
              <label>
                По дату
                <input name="end" type="date" required />
              </label>
            </div>
            <label>
              Связать с релизом
              <select name="releaseId">
                <option value="">Не связывать</option>
                {detail.releases.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    v{r.revision}
                  </option>
                ))}
              </select>
            </label>
            <button>
              <RefreshCw size={15} />
              Roblox Analytics Query API
            </button>
          </form>
          <details>
            <summary>Резервный импорт CSV</summary>
            <p>
              Столбцы: date,metric,value,unit. metric: active_players, d1, d7,
              session_minutes, revenue. Пустое value означает неизвестное.
            </p>
            <input
              aria-label="Выберите CSV"
              type="file"
              accept=".csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void run(
                    async () => action("metrics/csv", { csv: await f.text() }),
                    "CSV импортирован с отметкой источника",
                  );
              }}
            />
          </details>
        </section>
        <section className="card">
          <h2>Рекомендации по развитию</h2>
          {detail.recommendations.notes.map((n: string) => (
            <p key={n}>{n}</p>
          ))}
          <p className="muted">{detail.recommendations.action}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () => action("extension", { scope: f.get("scope") }),
                "План расширения запрошен",
              );
            }}
          >
            <label>
              Идея расширения
              <textarea
                name="scope"
                minLength={10}
                required
                rows={3}
                placeholder="Какой контент добавить? Что сохранить?"
              />
            </label>
            <button>
              Подготовить объём и оценку
              <ArrowRight size={15} />
            </button>
          </form>
        </section>
      </div>
      <section className="card">
        <h2>Источники и история</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Показатель</th>
                <th>Значение</th>
                <th>Источник</th>
                <th>Получено</th>
              </tr>
            </thead>
            <tbody>
              {detail.metrics.slice(-60).map((m: any) => (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td>{names[m.metric]}</td>
                  <td>{m.value ?? "Неизвестно"}</td>
                  <td>{m.source}</td>
                  <td>{date(m.fetchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Finance({ p, detail, state, run, action }: Ctx) {
  const c = state.codex;
  const claude = c.backend === "claude";
  const [login, setLogin] = useState<any>(null);
  return (
    <>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>
              {claude ? "Claude через Claude Code" : "ChatGPT через Codex"}
            </h2>
            <p>
              {c.account?.account?.email ||
                c.account?.account?.type ||
                "Аккаунт не подключён"}{" "}
              · {c.connected ? "Соединение установлено" : "Нет соединения"}
            </p>
          </div>
          <span className="badge">
            {agentName(c)} {c.version || "не найден"}
          </span>
        </div>
        {c.error && <p className="error-text">{c.error}</p>}
        <div className="button-row">
          <button
            className="primary"
            onClick={() =>
              void run(
                async () => {
                  const r = await api("/account/login", {});
                  setLogin(r);
                  if (r.authUrl)
                    window.open(r.authUrl, "_blank", "noopener,noreferrer");
                  return r;
                },
                `Откройте официальный вход ${agentName(c)}`,
              )
            }
          >
            <Link size={15} />
            {claude ? "Подключить Claude" : "Подключить ChatGPT"}
          </button>
          {!claude && (
            <button
              onClick={() =>
                void run(async () => {
                  const r = await api("/account/login", { method: "device" });
                  setLogin(r);
                  return r;
                }, "Введите код на странице входа")
              }
            >
              <Link size={15} />
              Войти по коду
            </button>
          )}
          <button
            onClick={() =>
              void run(
                () => api("/account/refresh", {}),
                "Данные аккаунта обновлены",
              )
            }
          >
            <RefreshCw size={15} />
            Обновить
          </button>
          <button
            className="subtle"
            onClick={() =>
              void run(
                () => api("/account/logout", {}),
                "Задачи остановлены, аккаунт отключён",
              )
            }
          >
            Отключить аккаунт
          </button>
        </div>
        {login?.userCode && (
          <p>
            Код входа: <b>{login.userCode}</b> ·{" "}
            <a href={login.verificationUrl} target="_blank" rel="noreferrer">
              {login.verificationUrl}
              <ArrowUpRight size={15} />
            </a>
          </p>
        )}
        {login?.authUrl && (
          <a href={login.authUrl} target="_blank" rel="noreferrer">
            Продолжить официальный вход
            <ArrowUpRight size={15} />
          </a>
        )}
      </section>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>
              {claude ? "Лимиты подписки Claude" : "Квоты ChatGPT и Codex"}
            </h2>
            <p>
              Общие для аккаунта · обновлено {date(c.quotaAt)} · Asia/Bangkok
            </p>
          </div>
          <span className={"badge " + (c.stale ? "warn" : "good")}>
            {c.stale ? "Данные устарели" : "Данные источника"}
          </span>
        </div>
        {c.quota.length ? (
          <div className="grid two">
            {c.quota.map((q: any) => (
              <div className="quota" key={q.id}>
                <div>
                  <strong>{q.name}</strong>
                  <b>
                    {q.remaining === null
                      ? "Неизвестно"
                      : Math.round(q.remaining) + "%"}
                  </b>
                </div>
                <div className="meter">
                  <i style={{ width: (q.remaining || 0) + "%" }} />
                </div>
                <small>
                  Окно: {q.minutes === null ? "неизвестно" : q.minutes + " мин"}{" "}
                  · сброс {date(q.resetsAt)}
                </small>
                <small>
                  {q.resetsAt ? <Countdown at={q.resetsAt} /> : null}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <Blank text="Источник не сообщил квоту. Количество оставшихся сообщений не рассчитывается." />
        )}
        <details>
          <summary>Дополнительные сведения источника, включая кредиты</summary>
          <pre>{JSON.stringify(c.rawQuota, null, 2)}</pre>
        </details>
      </section>
      <div className="grid two">
        <section className="card">
          <h2>Баланс OpenAI API</h2>
          <span className="badge warn">Автоматический баланс недоступен</span>
          <p>
            Costs API показывает расходы, а не остаток кредитов. Для баланса
            предусмотрено вручную подтверждённое значение с датой.
          </p>
          <a href={state.finance.billingUrl} target="_blank" rel="noreferrer">
            Открыть Billing
            <ArrowUpRight size={15} />
          </a>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api("/finance/manual", {
                    organization: f.get("organization"),
                    amount: Number(f.get("amount")),
                    currency: "USD",
                    confirmedAt: new Date().toISOString(),
                  }),
                "Сохранено ручное значение с датой",
              );
            }}
          >
            <label>
              Организация
              <input name="organization" required />
            </label>
            <label>
              Подтверждённый баланс, USD
              <input name="amount" type="number" step="0.01" min="0" required />
            </label>
            <button>Сохранить вручную</button>
          </form>
          {state.finance.balances.map((b: any) => (
            <p key={b.id}>
              {b.organization}: <strong>{money(b.amount * 1e6)}</strong>
              <small>Вручную · {date(b.confirmedAt)}</small>
            </p>
          ))}
        </section>
        <section className="card">
          <h2>Доступы к дополнительным API</h2>
          <p>
            Ключи хранятся через Windows DPAPI отдельно от игры и инструкций
            агентов.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () => api("/secrets", Object.fromEntries(f)),
                "Ключ сохранён в защищённом хранилище",
              );
              e.currentTarget.reset();
            }}
          >
            <label>
              Назначение
              <select name="key">
                {state.finance.secrets.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                    {s.configured ? " · подключён" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ключ
              <input
                name="value"
                type="password"
                autoComplete="off"
                required
                minLength={10}
              />
            </label>
            <button>
              Подключить доступ
              <ShieldCheck size={15} />
            </button>
          </form>
          <p className="muted">
            Ключ генерации и административный ключ финансов разделены. Переход с
            подписки на API по умолчанию выключен.
          </p>
        </section>
      </div>
      <section className="card">
        <h2>Организационные расходы API</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                api("/finance/costs", {
                  organization: f.get("organization"),
                  project: f.get("project"),
                  start: Math.floor(Date.parse(String(f.get("start"))) / 1000),
                  end: Math.floor(Date.parse(String(f.get("end"))) / 1000),
                }),
              "Расходы синхронизированы",
            );
          }}
        >
          <div className="grid four">
            <label>
              Организация
              <input name="organization" />
            </label>
            <label>
              API проект
              <input name="project" />
            </label>
            <label>
              С даты
              <input name="start" type="date" required />
            </label>
            <label>
              По дату
              <input name="end" type="date" required />
            </label>
          </div>
          <button>
            <RefreshCw size={15} />
            Синхронизировать Costs API
          </button>
        </form>
        {state.finance.costs.map((r: any) => (
          <details key={r.id}>
            <summary>
              {r.organization} · {date(r.fetchedAt)} · данные Costs API
            </summary>
            <pre>{JSON.stringify(r.buckets, null, 2)}</pre>
          </details>
        ))}
      </section>
      <GrantPanel state={state} run={run} />
      <ProviderPanel state={state} p={p} run={run} action={action} />
      {p && (
        <section className="card">
          <h2>Бюджет текущей игры</h2>
          <div className="grid four">
            <Stat
              title="Лимит"
              value={money(detail.budget.limitMicros)}
              caption="Устанавливаете вы"
              icon={ShieldCheck}
            />
            <Stat
              title="Потрачено"
              value={money(detail.budget.spentMicros)}
              caption="Локальный учёт"
              icon={Wallet}
            />
            <Stat
              title="Зарезервировано"
              value={money(detail.budget.reservedMicros)}
              caption="Для принятых задач"
              icon={Clock}
            />
            <Stat
              title="Доступно"
              value={money(detail.budget.availableMicros)}
              caption="Для новых задач"
              icon={Plus}
            />
          </div>
        </section>
      )}
    </>
  );
}
function Countdown({ at }: { at: string }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const seconds = Math.ceil((Date.parse(at) - t) / 1000);
  return (
    <>
      {seconds > 0
        ? `До сброса: ${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин ${seconds % 60} с`
        : "Время сброса наступило; ожидаем свежие данные источника"}
    </>
  );
}
function Skills({ state, run, p, action }: Ctx) {
  return (
    <>
      <div className="soft-note">
        <BookOpen size={19} />
        <span>
          Roblox-навыки подключаются к новым проектам автоматически. Агент
          получает инструкции своей роли и закреплённую версию: интерфейс, Luau,
          сохранения или ресурсы. Перед выполнением проверяются необходимые
          инструменты. Обновление библиотеки сохраняет закреплённые версии
          проектов.
        </span>
      </div>
      <section className="card">
        <h2>Реестр навыков</h2>
        <SkillImport run={run} />
        {state.skills.map((s: any) => (
          <article className="skill-row" key={s.id}>
            <div className="skill-icon">
              <BookOpen size={20} />
            </div>
            <div className="task-body">
              <h3>{s.name}</h3>
              <small>
                {s.version} · {s.roles.map((r: string) => labels[r]).join(", ")}{" "}
                · {s.license}
              </small>
              <small>{s.source}</small>
              <details>
                <summary>Инструкция и контрольная сумма</summary>
                <p className="pre-wrap">
                  {s.instructions ||
                    "Пакет ещё не прочитан. Не загружается агентам."}
                </p>
                <small>{s.hash || "Нет закреплённой контрольной суммы"}</small>
                <small>
                  Требуются: {s.capabilities.join(", ") || "не проверено"}
                </small>
              </details>
            </div>
            <div className="stack">
              <span className="badge">{skillStatus[s.status] || s.status}</span>
              {p?.skillPins[s.id] && (
                <span className="badge">Используется в проекте</span>
              )}
              {p &&
                s.status === "connected" &&
                p.skillPins[s.id] !== s.hash && (
                  <button
                    onClick={() =>
                      void run(
                        () => action("skills/pin", { skillId: s.id }),
                        "Версия навыка закреплена для проекта",
                      )
                    }
                  >
                    Закрепить
                  </button>
                )}
              <button
                onClick={() =>
                  void run(
                    () => api("/skills/" + s.id + "/verify", {}),
                    "Совместимость проверена",
                  )
                }
              >
                Проверить
              </button>
              <button
                className="subtle"
                onClick={() =>
                  void run(
                    () =>
                      api("/skills/" + s.id + "/toggle", {
                        enabled: s.status === "disabled",
                      }),
                    "Состояние навыка обновлено",
                  )
                }
              >
                {s.status === "disabled" ? "Включить" : "Отключить"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
function Blank({ text }: { text: string }) {
  return (
    <div className="blank">
      <Layers size={24} />
      <p>{text}</p>
    </div>
  );
}
function eventLabel(type: string) {
  return (
    (
      {
        "project.created": "Проект создан",
        "project.updated": "Проект обновлён",
        "project.names.generated": "ИИ предложил названия проекта",
        "production.repair.started": "Исправления по замечаниям запущены",
        "task.started": "Рабочая сессия запущена",
        "task.result": "Получен результат агента",
        "task.failed": "Задача требует внимания",
        "phase.started": "Этап запущен",
        "studio.queued": "Команда поставлена в очередь Studio",
        "studio.result": "Получен результат Studio",
        "studio.bound": "Studio связана с проектом",
        "studio.unbound": "Studio отвязана от проекта",
        "studio.resumed": "Соединение со Studio восстановлено",
        "style.presets.prepared": "Готовые стили подключены к проекту",
        "style.preset.selected": "Пакет оформления выбран",
        "skill.autoAssigned": "Навыки назначены автоматически",
        "skill.pinned": "Версия навыка закреплена",
        "requirements.english-ui": "Английский интерфейс включён в требования",
        "feedback.created": "Сохранено замечание",
        "release.approved": "Версия подтверждена",
        "release.published": "Версия опубликована",
        "phone.result": "Проверка телефона сохранена",
      } as any
    )[type] ||
    (type.startsWith("approval.")
      ? "Решение пользователя сохранено"
      : type.startsWith("execution.")
        ? "Состояние работы изменено"
        : type)
  );
}
createRoot(document.getElementById("root")!).render(<App />);

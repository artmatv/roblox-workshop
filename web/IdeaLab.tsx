import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Dices,
  ExternalLink,
  Lock,
  LockOpen,
  RefreshCw,
  Sparkles,
  Star,
} from "lucide-react";
import {
  IDEA_STEPS,
  ideaBrief,
  ideaGenre,
  ideaTitle,
  spinIdeaWords,
  type Idea,
  type IdeaGame,
  type IdeaGroup,
  type IdeaReel,
  type IdeaWords,
} from "../shared/idea-lab";

type Api = (path: string, body?: unknown, method?: string) => Promise<any>;
const REELS: Array<[IdeaReel, string]> = [
  ["verb", "Глагол"],
  ["article", "Артикль"],
  ["noun", "Существительное"],
];
const reduceMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const players = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
const verdict = (score: number) =>
  score >= 70
    ? "Сильная идея"
    : score >= 50
      ? "Есть шанс"
      : score >= 30
        ? "Рискованно"
        : "Слабый спрос";
const tone = (score: number) =>
  score >= 60 ? "good" : score >= 40 ? "mid" : "low";

export function IdeaLab({
  api,
  run,
  onCreated,
}: {
  api: Api;
  run: (fn: () => Promise<any>, success?: string) => Promise<any>;
  onCreated: (projectId: string) => void;
}) {
  const [words, setWords] = useState<IdeaWords>(() => spinIdeaWords(null));
  const [locked, setLocked] = useState<Partial<Record<IdeaReel, boolean>>>({});
  const [spinning, setSpinning] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [current, setCurrent] = useState<Idea | null>(null);
  const [developing, setDeveloping] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const planRef = useRef<HTMLElement>(null);
  const recent = useRef<string[]>([]);
  useEffect(() => {
    api("/ideas")
      .then((list: Idea[]) => {
        setIdeas(list);
        if (list[0]) open(list[0]);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  function open(idea: Idea) {
    setCurrent(idea);
    setWords(idea.words);
    setStep(0);
    setError("");
  }
  function remember(idea: Idea) {
    setCurrent(idea);
    setIdeas((list) => [idea, ...list.filter((i) => i.id !== idea.id)]);
  }
  // The landing words skip the last 30 verbs and nouns the slot has shown;
  // the flicker before them is decoration.
  function spin() {
    if (spinning) return;
    setError("");
    const target = spinIdeaWords(words, locked, Math.random, recent.current);
    recent.current = [...recent.current, target.verb, target.noun].slice(-60);
    if (reduceMotion()) return setWords(target);
    setSpinning(true);
    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks < 12) return setWords((w) => spinIdeaWords(w, locked));
      clearInterval(timer);
      setWords(target);
      setSpinning(false);
    }, 70);
  }
  async function develop() {
    setDeveloping(true);
    setError("");
    try {
      const idea: Idea = await api("/ideas", { words });
      remember(idea);
      setStep(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeveloping(false);
    }
  }
  async function recheck() {
    if (!current) return;
    setChecking(true);
    try {
      remember(await api(`/ideas/${current.id}/check`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  async function toggle(group: IdeaGroup, optionId: string) {
    if (!current) return;
    const had = current.picks[group.id] || [];
    const next =
      group.mode === "one"
        ? [optionId]
        : had.includes(optionId)
          ? had.filter((id) => id !== optionId)
          : [...had, optionId];
    const picks = { ...current.picks, [group.id]: next };
    // The screen keeps its own picks: a slow earlier reply must not undo a
    // later click.
    setCurrent({ ...current, picks });
    setIdeas((list) =>
      list.map((i) => (i.id === current.id ? { ...i, picks } : i)),
    );
    setSaved("saving");
    try {
      await api(`/ideas/${current.id}`, { picks }, "PATCH");
      setSaved("saved");
    } catch {
      setSaved("error");
    }
  }
  const title = ideaTitle(words);
  const developed = current && current.title === title;
  const picked = (g: IdeaGroup) => (current?.picks[g.id] || []).length > 0;
  const groupCount = IDEA_STEPS.flatMap((s) => s.groups).length;
  const pickedCount = IDEA_STEPS.flatMap((s) => s.groups).filter(picked).length;
  const s = IDEA_STEPS[step];
  return (
    <div className="idea-lab">
      <section className="card idea-slot">
        <div className="section-title">
          <div>
            <h2>Три слова — одна игра</h2>
            <p>
              Крутите барабаны, пока название не зацепит. Нажмите на слово,
              чтобы закрепить его, и крутите остальные.
            </p>
          </div>
        </div>
        <div className="reels" aria-live="polite">
          {REELS.map(([reel, label]) => (
            <div key={reel} className="reel">
              <span className="reel-label">{label}</span>
              <button
                type="button"
                className={"reel-word" + (locked[reel] ? " held" : "")}
                aria-pressed={!!locked[reel]}
                title={locked[reel] ? "Открепить слово" : "Закрепить слово"}
                onClick={() => setLocked((l) => ({ ...l, [reel]: !l[reel] }))}
              >
                <span>
                  {reel === "article" ? title.split(" ")[1] : words[reel]}
                </span>
                {locked[reel] ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="spin-button"
          disabled={spinning || developing}
          onClick={spin}
        >
          <Dices size={20} />
          {spinning ? "Крутим…" : "Крутить"}
        </button>
        <div className="idea-title">
          <span className="eyebrow">ВАША ИГРА</span>
          <strong>{spinning ? "…" : title}</strong>
        </div>
        <button
          type="button"
          className="primary develop-button"
          disabled={spinning || developing || !!developed}
          onClick={() => void develop()}
        >
          {developing ? (
            <RefreshCw size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {developing
            ? "ИИ раскручивает идею…"
            : developed
              ? "Идея раскручена — смотрите ниже"
              : "Раскрутить идею"}
        </button>
        {developing && (
          <p className="muted idea-note">
            ИИ продумывает игру по 10 шагам, затем мастерская ищет похожие игры
            в Roblox. Обычно до минуты.
          </p>
        )}
        {error && (
          <p className="idea-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {current && (
        <>
          <section className="card idea-pitch">
            <div className="section-title">
              <div>
                <div className="eyebrow">ИДЕЯ</div>
                <h2>{current.title}</h2>
              </div>
              <span className="badge">
                {current.model} · {current.effort}
              </span>
            </div>
            <dl>
              <div>
                <dt>Суть</dt>
                <dd>{current.plan.pitch}</dd>
              </div>
              <div>
                <dt>Изюминка</dt>
                <dd>{current.plan.twist}</dd>
              </div>
              <div>
                <dt>Чем зацепит ребёнка</dt>
                <dd>{current.plan.hook}</dd>
              </div>
            </dl>
          </section>

          <div className="idea-columns">
            <section className="card idea-plan" ref={planRef}>
              <div className="section-title">
                <div>
                  <h2>План игры</h2>
                  <p>
                    {pickedCount} из {groupCount} выбрано ·{" "}
                    {saved === "saving"
                      ? "сохраняем…"
                      : saved === "error"
                        ? "не сохранилось, выберите ещё раз"
                        : "сохранено"}
                  </p>
                </div>
                <span className="badge">
                  <Star size={12} /> Рекомендации ИИ отмечены
                </span>
              </div>
              <div
                className="idea-steps"
                role="tablist"
                aria-label="Шаги плана"
              >
                {IDEA_STEPS.map((st, i) => (
                  <button
                    key={st.id}
                    role="tab"
                    aria-selected={i === step}
                    className={i === step ? "active" : ""}
                    onClick={() => setStep(i)}
                  >
                    {st.groups.every(picked) ? (
                      <Check size={13} />
                    ) : (
                      <span>{i + 1}</span>
                    )}
                    {st.title}
                  </button>
                ))}
              </div>
              <div className="idea-step" role="tabpanel">
                <div className="eyebrow">
                  ШАГ {step + 1} ИЗ {IDEA_STEPS.length}
                </div>
                <h3>{s.title}</h3>
                <p className="muted">{s.hint}</p>
                {s.groups.map((g) => {
                  const rec = current.plan.recommendations[g.id];
                  const label = (id: string) =>
                    g.options.find((o) => o.id === id)?.label || id;
                  return (
                    <div key={g.id} className="idea-group">
                      <h4>
                        {g.label}{" "}
                        <small>
                          {g.mode === "one"
                            ? "выберите один"
                            : "можно несколько"}
                        </small>
                      </h4>
                      <p className="idea-reason">
                        <Star size={13} />
                        <span>
                          <strong>
                            Рекомендуем: {rec.picks.map(label).join(", ")}.
                          </strong>{" "}
                          {rec.reason}
                        </span>
                      </p>
                      <div className="idea-options">
                        {[
                          ...g.options.filter((o) => rec.picks.includes(o.id)),
                          ...g.options.filter((o) => !rec.picks.includes(o.id)),
                        ].map((o) => {
                          const on = (current.picks[g.id] || []).includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              aria-pressed={on}
                              className={"idea-option" + (on ? " on" : "")}
                              onClick={() => void toggle(g, o.id)}
                            >
                              {rec.picks.includes(o.id) && <Star size={12} />}
                              {o.label}
                              {on && <Check size={13} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="idea-step-nav">
                  <button
                    className="subtle"
                    disabled={step === 0}
                    onClick={() => setStep(step - 1)}
                  >
                    <ArrowLeft size={15} /> Назад
                  </button>
                  {step < IDEA_STEPS.length - 1 && (
                    <button
                      className="subtle"
                      onClick={() => setStep(step + 1)}
                    >
                      Далее: {IDEA_STEPS[step + 1].title}{" "}
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </div>
            </section>

            <IdeaCheckCard
              idea={current}
              checking={checking}
              onRecheck={() => void recheck()}
            />
          </div>

          <section className="card idea-summary">
            <div className="section-title">
              <div>
                <h2>Ваша игра</h2>
                <p>
                  Этот план станет идеей нового проекта. Дальше мастерская
                  проведёт его через исследование, концепцию и спецификацию.
                </p>
              </div>
            </div>
            <ol>
              {IDEA_STEPS.map((st, i) => (
                <li key={st.id}>
                  <div>
                    <strong>{st.title}</strong>
                    <span>
                      {st.groups
                        .map((g) =>
                          (current.picks[g.id] || [])
                            .map(
                              (id) =>
                                g.options.find((o) => o.id === id)?.label || id,
                            )
                            .join(", "),
                        )
                        .filter(Boolean)
                        .join(" · ") || "не выбрано"}
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setStep(i);
                      planRef.current?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Изменить
                  </button>
                </li>
              ))}
            </ol>
            <button
              className="primary"
              disabled={creating}
              onClick={() => {
                setCreating(true);
                void run(async () => {
                  const r = await api("/projects", {
                    name: current.title,
                    genre: ideaGenre(current),
                    goal: ideaBrief(current),
                  });
                  onCreated(r.id);
                  return r;
                }, "Проект создан из идеи").finally(() => setCreating(false));
              }}
            >
              Создать проект «{current.title}» <ArrowRight size={16} />
            </button>
          </section>
        </>
      )}

      {ideas.length > 1 && (
        <section className="card idea-history">
          <div className="section-title">
            <div>
              <h2>Недавние идеи</h2>
              <p>Последние раскрученные идеи сохраняются на этом компьютере.</p>
            </div>
          </div>
          <ul>
            {ideas.map((i) => (
              <li key={i.id}>
                <button
                  className={i.id === current?.id ? "active" : ""}
                  onClick={() => open(i)}
                >
                  <strong>{i.title}</strong>
                  <span
                    className={
                      "idea-score-chip " +
                      (i.check?.score != null ? tone(i.check.score) : "")
                    }
                  >
                    {i.check?.score ?? "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GameTile({ game }: { game: IdeaGame }) {
  return (
    <a
      className="idea-game"
      href={
        game.placeId
          ? `https://www.roblox.com/games/${game.placeId}`
          : undefined
      }
      target="_blank"
      rel="noreferrer"
    >
      {game.icon ? (
        <img
          src={"/api/files?" + new URLSearchParams({ path: game.icon })}
          alt=""
        />
      ) : (
        <span className="idea-game-blank" />
      )}
      <strong>{game.name}</strong>
      <span>{players(game.playing)} играют</span>
    </a>
  );
}

function IdeaCheckCard({
  idea,
  checking,
  onRecheck,
}: {
  idea: Idea;
  checking: boolean;
  onRecheck: () => void;
}) {
  const c = idea.check;
  const recheck = (
    <button className="subtle" disabled={checking} onClick={onRecheck}>
      <RefreshCw size={14} className={checking ? "spin" : ""} />
      Проверить снова
    </button>
  );
  return (
    <section className="card idea-check">
      <div className="section-title">
        <div>
          <h2>Проверка идеи</h2>
          <p>По живым похожим играм из поиска Roblox.</p>
        </div>
      </div>
      {!c ? (
        <>
          <p className="idea-error">
            {idea.checkError || "Проверка ещё не выполнялась."}
          </p>
          {recheck}
        </>
      ) : (
        <>
          {c.score == null ? (
            <p>
              Похожих игр в поиске Roblox не нашлось. Это может быть свободная
              ниша — или тема, которую никто не ищет. Оценить спрос не по чему.
            </p>
          ) : (
            <div className={"idea-score " + tone(c.score)}>
              <div>
                <strong>{c.score}</strong>
                <span>/ 100</span>
              </div>
              <em>{verdict(c.score)}</em>
              <i style={{ "--fill": c.score + "%" } as React.CSSProperties} />
            </div>
          )}
          {c.score != null && (
            <ul className="idea-factors">
              <li>
                <span>
                  Спрос <b>{c.demand}</b>
                </span>
                <i
                  style={{ "--fill": c.demand + "%" } as React.CSSProperties}
                />
                <small>
                  В 10 самых популярных похожих играх сейчас{" "}
                  {players(c.totalPlaying)} игроков.
                </small>
              </li>
              <li>
                <span>
                  Теснота <b>{c.crowding}</b>
                </span>
                <i
                  className="inverse"
                  style={{ "--fill": c.crowding + "%" } as React.CSSProperties}
                />
                <small>
                  Столько процентов игроков у самой большой игры. Чем меньше,
                  тем проще войти новичку.
                </small>
              </li>
              <li>
                <span>
                  Новички <b>{c.newcomers}</b>
                </span>
                <i
                  style={{ "--fill": c.newcomers + "%" } as React.CSSProperties}
                />
                <small>
                  {c.newcomer
                    ? `«${c.newcomer.name}» вышла меньше года назад и собирает ${players(c.newcomer.playing)} игроков.`
                    : "За последний год новых заметных игр на эту тему нет."}
                </small>
              </li>
            </ul>
          )}
          {c.games.length > 0 && (
            <>
              <h3 className="idea-subhead">Похожие игры</h3>
              <div className="idea-games">
                {c.games.map((g) => (
                  <GameTile key={g.universeId} game={g} />
                ))}
              </div>
            </>
          )}
          <p className="muted idea-note">
            Найдено похожих: {c.found} по запросам{" "}
            {c.queries.map((q) => `«${q}»`).join(", ")},{" "}
            {new Date(c.checkedAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Оценка — ориентир по похожим играм, не гарантия успеха.
          </p>
          {idea.checkError && <p className="idea-error">{idea.checkError}</p>}
          {recheck}
        </>
      )}
    </section>
  );
}

import React, { useState } from "react";
import type { Project } from "../shared/domain";
type SessionView = {
  status: string;
  summary?: string;
  activity?: string;
  captures?: Array<{ file: string; label: string }>;
};
const captions: Record<string, string> = {
  "world-desktop": "Уровень — компьютер",
  "hud-desktop": "Игровой интерфейс — компьютер",
  "shop-desktop": "Магазин",
  "collection-desktop": "Коллекция",
  "hud-mobile": "Игровой интерфейс — телефон",
  "assets/coins.png": "Иконка монет",
  "assets/bag.png": "Иконка сумки",
  "assets/upgrades.png": "Иконка улучшений",
  "assets/collection.png": "Иконка коллекции",
  "assets/shop.png": "Иконка магазина",
};
const caption = (label: string) => captions[label] || "Игровой кадр";
export function NativeDevelopment({
  project,
  session,
  onDevelop,
}: {
  project: Pick<Project, "id" | "approvals">;
  session?: SessionView;
  onDevelop: (text?: string) => Promise<any>;
}) {
  const [text, setText] = useState("");
  const busy =
    session && ["queued", "working", "checkpoint"].includes(session.status);
  return (
    <section className="card native-development">
      <div className="card-title">
        <h2>Ведущий разработчик</h2>
        <span>
          {busy
            ? "Работает над игрой"
            : session?.status === "review"
              ? "Нужна ваша оценка оформления"
              : "Единая работа над игрой"}
        </span>
      </div>
      <p>
        Ведущий ведёт мир, интерфейс и ассеты в общей рабочей папке, принимает
        работу помощников. Рисует иконки, создаёт модели, запускает игру и
        исправляет результат по настоящим снимкам Studio.
      </p>
      {session?.activity && busy && <p role="status">{session.activity}</p>}
      {session?.summary && <p>{session.summary}</p>}
      {!!session?.captures?.length && (
        <div className="native-captures">
          {session.captures.map((c) => (
            <figure key={c.file}>
              <a
                href={"/api/files?" + new URLSearchParams({ path: c.file })}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={"/api/files?" + new URLSearchParams({ path: c.file })}
                  alt={caption(c.label)}
                  loading="lazy"
                />
              </a>
              <figcaption>{caption(c.label)}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <label>
        Что улучшить
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: выразительный вход в парк, нарисованные иконки и удобный HUD на телефоне"
          rows={3}
        />
      </label>
      <button
        className="primary"
        disabled={
          (busy && !text.trim()) ||
          !project.approvals?.specification ||
          !project.approvals?.budget
        }
        onClick={() =>
          onDevelop(text.trim() || undefined).then((result) => {
            if (result) setText("");
          })
        }
      >
        {busy
          ? "Передать замечание разработчику"
          : "Улучшить игру с ведущим агентом"}
      </button>
      {session?.status === "review" && (
        <p className="hint">
          Это результат для вашей визуальной оценки. Успешные тесты сами по себе
          не подтверждают качество оформления.
        </p>
      )}
    </section>
  );
}

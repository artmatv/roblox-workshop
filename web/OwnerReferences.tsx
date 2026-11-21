import React, { useEffect, useState } from "react";
import { Camera, ImagePlus, Play, Sparkles, Square, X } from "lucide-react";
import { AssetPreview } from "./AssetPreview";

type Image = { name: string; file: string; source: "upload" | "capture" };
type OwnerReferenceView = {
  prompt: string;
  status: "idle" | "running" | "failed";
  error?: string | null;
  brief: null | {
    summary: string;
    palette: Array<{ hex: string; role: string }>;
    shapes: string;
    typography: string;
    hud: string;
    world: string;
    icons: string;
    avoid: string;
    picks: Array<{ file: string; why: string }>;
  };
  images: Image[];
  capture: { active: boolean; frames: number };
};
// A Roblox game link or a bare place id.
export function placeIdFrom(text: string) {
  const match = text.trim().match(/(?:games\/|placeId=)?(\d{3,})/);
  return match ? match[1] : null;
}
function toBase64(bytes: Uint8Array) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

export function OwnerReferences({
  projectId,
  reference,
  run,
  api,
}: {
  projectId: string;
  reference?: OwnerReferenceView;
  run: (fn: () => Promise<any>, success?: string) => Promise<any>;
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
}) {
  const [prompt, setPrompt] = useState(reference?.prompt || "");
  const [game, setGame] = useState("");
  useEffect(() => setPrompt(reference?.prompt || ""), [reference?.prompt]);
  if (!reference) return null;
  const base = `/projects/${projectId}/owner-references`;
  const placeId = placeIdFrom(game);
  const brief = reference.brief;
  return (
    <section className="card owner-references">
      <div className="section-title">
        <div>
          <h2>Свой стиль: референсы и пожелания</h2>
          <p>
            Покажите, как должна выглядеть игра. Агент соберёт из ваших картинок
            и кадров бриф стиля и будет опираться на него в работе.
          </p>
        </div>
        <span className={"badge " + (brief ? "good" : "")}>
          {brief ? "Бриф готов" : `${reference.images.length} референсов`}
        </span>
      </div>
      <ol className="owner-steps">
        <li>
          <h3>Свои картинки</h3>
          <p>Скриншоты, арты, фото экрана — PNG или JPEG до 5 МБ.</p>
          <label className="button-like">
            <ImagePlus size={15} />
            Загрузить
            <input
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="file-input"
              onChange={(e) => {
                const files = [...(e.target.files || [])];
                e.target.value = "";
                if (files.length)
                  void run(async () => {
                    for (const f of files)
                      await api(base + "/images", {
                        dataBase64: toBase64(
                          new Uint8Array(await f.arrayBuffer()),
                        ),
                        mime: f.type,
                      });
                  }, `Загружено: ${files.length}`);
              }}
            />
          </label>
        </li>
        <li>
          <h3>Кадры из Roblox</h3>
          <p>
            Откройте игру, включите захват и играйте: кадр снимается каждые 4
            секунды, пока окно Roblox на переднем плане.
          </p>
          <div className="button-row">
            <input
              aria-label="Ссылка или ID игры Roblox"
              placeholder="Ссылка или ID игры"
              value={game}
              onChange={(e) => setGame(e.target.value)}
            />
            <button
              disabled={!placeId}
              onClick={() => {
                window.location.href = `roblox://experiences/start?placeId=${placeId}`;
              }}
            >
              <Play size={15} />
              Открыть в Roblox
            </button>
            {reference.capture.active ? (
              <button
                className="primary"
                onClick={() =>
                  void run(
                    () => api(base + "/capture", { action: "stop" }),
                    "Захват остановлен",
                  )
                }
              >
                <Square size={15} />
                Остановить · {reference.capture.frames} кадров
              </button>
            ) : (
              <button
                onClick={() =>
                  void run(
                    () => api(base + "/capture", { action: "start" }),
                    "Захват включён: переключитесь в Roblox",
                  )
                }
              >
                <Camera size={15} />
                Начать захват
              </button>
            )}
          </div>
        </li>
        <li>
          <h3>Что вам нравится</h3>
          <textarea
            aria-label="Пожелания к стилю"
            rows={3}
            maxLength={4000}
            placeholder="Например: яркие объёмные кнопки как в первой картинке, спокойный мир, крупные иконки"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() =>
              prompt !== reference.prompt &&
              void run(
                () => api(base, { prompt }, "PATCH"),
                "Пожелания сохранены",
              )
            }
          />
          <button
            className="primary"
            disabled={
              reference.status === "running" ||
              (!reference.images.length && !prompt.trim())
            }
            onClick={() =>
              void run(async () => {
                if (prompt !== reference.prompt)
                  await api(base, { prompt }, "PATCH");
                return api(base + "/brief", {});
              }, "Бриф стиля собран")
            }
          >
            <Sparkles size={15} />
            {reference.status === "running"
              ? "Собираем бриф…"
              : brief
                ? "Собрать заново"
                : "Собрать стиль"}
          </button>
          {reference.status === "failed" && reference.error && (
            <p className="error-text">{reference.error}</p>
          )}
        </li>
      </ol>
      {reference.images.length > 0 && (
        <div className="owner-gallery">
          {reference.images.map((image) => (
            <figure
              key={image.name}
              className={
                brief?.picks.some((p) => p.file === image.name) ? "picked" : ""
              }
            >
              <AssetPreview
                path={image.file}
                label={
                  image.source === "capture"
                    ? "Кадр из Roblox"
                    : "Ваша картинка"
                }
              />
              <figcaption>
                {image.source === "capture" ? "Roblox" : "Загружено"}
                <button
                  className="subtle"
                  aria-label="Удалить референс"
                  onClick={() =>
                    void run(
                      () =>
                        api(
                          `${base}/images/${encodeURIComponent(image.name)}`,
                          undefined,
                          "DELETE",
                        ),
                      "Референс удалён",
                    )
                  }
                >
                  <X size={14} />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {brief && (
        <div className="owner-brief">
          <p>{brief.summary}</p>
          <div className="owner-palette">
            {brief.palette.map((c) => (
              <span key={c.hex + c.role} title={c.role}>
                <i style={{ background: c.hex }} />
                {c.role}
              </span>
            ))}
          </div>
          <dl>
            <dt>Формы</dt>
            <dd>{brief.shapes}</dd>
            <dt>Интерфейс</dt>
            <dd>{brief.hud}</dd>
            <dt>Мир</dt>
            <dd>{brief.world}</dd>
            <dt>Иконки</dt>
            <dd>{brief.icons}</dd>
            <dt>Шрифт</dt>
            <dd>{brief.typography}</dd>
            <dt>Избегать</dt>
            <dd>{brief.avoid}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}

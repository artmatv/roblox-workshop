import { BookOpen, Check, Download, Globe2 } from "lucide-react";
import type { DevelopmentStatus } from "../shared/development";

const outcomes = {
  not_built: "Ожидает первой сборки",
  needs_update: "Требуется обновление сборки",
  not_run: "Ожидает запуска в Studio",
  blocked: "Проверка недоступна",
  failed: "Нужны исправления",
  passed: "Проверка в Studio пройдена",
};

export function DevelopmentPolicy({
  value,
  openSkills,
  openChecks,
  download,
}: {
  value: DevelopmentStatus;
  openSkills: () => void;
  openChecks: () => void;
  download: (path: string) => void;
}) {
  const ready = value.skills.filter((skill) => skill.status === "ready").length;
  const locale = value.localization;
  return (
    <section
      className="card development-policy"
      aria-label="Правила разработки"
    >
      <div className="section-title">
        <div>
          <h2>Правила разработки</h2>
          <p>Применяются автоматически к новым задачам и доработкам</p>
        </div>
        <span className="badge">Для всех игр</span>
      </div>
      <div className="policy-grid">
        <div>
          <BookOpen size={20} aria-hidden="true" />
          <h3>Навыки Roblox</h3>
          <strong>
            {ready} из {value.skills.length} назначены
          </strong>
          <p>
            Инструкции для интерфейса, Luau, сохранений и ресурсов назначаются
            по роли. Версии закреплены за проектом.
          </p>
          <button className="text-button" onClick={openSkills}>
            Посмотреть навыки
          </button>
        </div>
        <div>
          <Globe2 size={20} aria-hidden="true" />
          <h3>Язык интерфейса</h3>
          <strong>English · en-us</strong>
          <p>
            Меню, HUD, магазин, инвентарь и сообщения создаются на английском.
            Перевод — через Roblox по языку игрока.
          </p>
          <span className="policy-detail">
            Каталог и подключение перевода входят в сборку. Языки experience
            включаются в Creator Hub.
          </span>
        </div>
        <div>
          <Check size={20} aria-hidden="true" />
          <h3>Проверка локализации</h3>
          <strong>{outcomes[locale.status]}</strong>
          <p>
            {locale.revision === null
              ? "Английские подписи и динамические сообщения проверяются в Studio перед приёмкой сборки."
              : `Версия ${locale.revision} · ${locale.entries} строк в английском каталоге`}
          </p>
          <div className="button-row">
            <button className="text-button" onClick={openChecks}>
              Результаты проверок
            </button>
            {locale.csv && (
              <button onClick={() => download(locale.csv!)}>
                <Download size={14} />
                Каталог перевода
              </button>
            )}
            {locale.setup && (
              <button onClick={() => download(locale.setup!)}>
                Настройка в Roblox
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

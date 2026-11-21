import type { StylePackage } from "../shared/domain";
import { presentStyle } from "../shared/style-display";

export function StyleDetails({ style }: { style: StylePackage }) {
  const description = presentStyle(style.familyId),
    rules = style.rules;
  return (
    <>
      <p>
        {description.world} {description.ui}
      </p>
      <div className="style-swatches" aria-label="Цвета оформления">
        {Object.entries((rules.palette || {}) as Record<string, string>).map(
          ([name, color]) => (
            <span
              key={name}
              style={{ backgroundColor: color }}
              title={name + ": " + color}
            />
          ),
        )}
      </div>
      <details className="style-details">
        <summary>Мир, персонаж и интерфейс</summary>
        {(
          [
            ["Материалы", "materials"],
            ["Свет", "lighting"],
            ["Персонаж", "avatar"],
            ["Шрифты", "typography"],
            ["Игровой экран", "hud"],
            ["Магазин", "shop"],
            ["Инвентарь", "inventory"],
            ["Телефон", "mobile"],
          ] as const
        ).map(([label, key]) => (
          <div key={key}>
            <strong>{label}</strong>
            <p>
              {Array.isArray(rules[key])
                ? (rules[key] as string[]).join(", ")
                : String(rules[key] || "Будет уточнено")}
            </p>
          </div>
        ))}
      </details>
      <details className="style-details">
        <summary>Источники и степень проверки</summary>
        {style.references.map((r, i) => (
          <div key={i}>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.game}
            </a>
            <p>
              {r.author} · {new Date(r.checkedAt).toLocaleDateString("ru-RU")}
            </p>
            <p>{r.observations}</p>
            <p className="source-confidence">
              {r.screen} · {r.device}. {r.confidence}
            </p>
          </div>
        ))}
      </details>
    </>
  );
}

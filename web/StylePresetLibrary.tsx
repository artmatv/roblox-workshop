import { useState } from "react";
import { Check, Monitor, Smartphone } from "lucide-react";
import type {
  UiStyleLibrary,
  PresetScreen,
  UiStylePreset,
} from "../shared/ui-style-presets";
import { AssetPreview } from "./AssetPreview";

export function StylePresetLibrary({
  library,
  selectedId,
  onSelect,
}: {
  library: UiStyleLibrary;
  selectedId?: string;
  onSelect: (id: string) => Promise<unknown>;
}) {
  const [screen, setScreen] = useState<PresetScreen>("hud"),
    [device, setDevice] = useState<"desktop" | "mobile">("desktop"),
    [saving, setSaving] = useState("");
  return (
    <section className="card preset-library" aria-label="Готовые стили">
      <div className="section-title">
        <div>
          <h2>Выберите готовый стиль</h2>
          <p>
            Три разные раскладки, рисованные иконки и оформление мира. Выбор не
            требует запуска Studio.
          </p>
        </div>
        <div className="button-row">
          <select
            aria-label="Экран предпросмотра"
            value={screen}
            onChange={(e) => setScreen(e.target.value as PresetScreen)}
          >
            <option value="hud">Сцена и HUD</option>
            <option value="shop">Магазин</option>
            <option value="inventory">Инвентарь</option>
            <option value="menu">Главное меню</option>
          </select>
          <button
            aria-pressed={device === "mobile"}
            onClick={() =>
              setDevice(device === "desktop" ? "mobile" : "desktop")
            }
          >
            {device === "desktop" ? (
              <Monitor size={17} />
            ) : (
              <Smartphone size={17} />
            )}
            {device === "desktop" ? "Компьютер" : "Телефон"}
          </button>
        </div>
      </div>
      {!library.items.length ? (
        <p className="soft-note">
          {library.error || "Пакеты оформления ещё не подключены"}
        </p>
      ) : (
        <div className="preset-grid">
          {library.items.map((preset) => (
            <article
              className={`preset-card ${selectedId === preset.id ? "selected" : ""}`}
              key={preset.definitionHash}
              aria-label={`Стиль ${preset.name}`}
            >
              <div className="preset-heading">
                <AssetPreview
                  path={preset.icon}
                  label={`Иконка пакета «${preset.name}»`}
                  mode="icon"
                />
                <div>
                  <span className="eyebrow">
                    ГОТОВЫЙ ПАКЕТ · {preset.version}
                  </span>
                  <h3>{preset.name}</h3>
                  <small>{preset.signature}</small>
                </div>
              </div>
              <AssetPreview
                path={
                  preset.previews.find(
                    (p) => p.screen === screen && p.device === device,
                  )?.file
                }
                device={device}
                label={`${preset.name}: ${screenNames[screen]}, ${device === "desktop" ? "компьютер" : "телефон"}`}
              />
              <p className="preset-caption">
                Пример оформления · не скриншот вашей игры
              </p>
              <p className="preset-description">{preset.description}</p>
              <div className="preset-components">
                {preset.components.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <button
                className={
                  selectedId === preset.id
                    ? "preset-selected-button"
                    : "primary"
                }
                aria-pressed={selectedId === preset.id}
                aria-label={`Выбрать стиль «${preset.name}»`}
                disabled={!!saving}
                onClick={async () => {
                  if (selectedId === preset.id) return;
                  setSaving(preset.id);
                  try {
                    await onSelect(preset.id);
                  } finally {
                    setSaving("");
                  }
                }}
              >
                {selectedId === preset.id && <Check size={16} />}
                {saving === preset.id
                  ? "Применяем…"
                  : selectedId === preset.id
                    ? "Выбран"
                    : "Выбрать стиль"}
              </button>
              <PresetResources preset={preset} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
const screenNames: Record<PresetScreen, string> = {
  hud: "сцена и HUD",
  shop: "магазин",
  inventory: "инвентарь",
  menu: "главное меню",
};
function PresetResources({ preset }: { preset: UiStylePreset }) {
  const [open, setOpen] = useState(false),
    [reference, setReference] = useState(false);
  return (
    <div className="preset-resources">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Иконки и состав пакета</summary>
        {open && (
          <>
            <AssetPreview
              path={preset.iconSheet}
              label={`Набор иконок: ${preset.name}`}
              mode="sheet"
            />
            <dl>
              <dt>Состав</dt>
              <dd>
                Игровой экран, главное меню, магазин и инвентарь на компьютере и
                телефоне.
              </dd>
              <dt>Композиция</dt>
              <dd>{preset.signature}</dd>
              <dt>Иконки</dt>
              <dd>
                Навигация, ресурсы, предметы и состояния выбора. Подписи
                остаются отдельными от иллюстраций для перевода.
              </dd>
            </dl>
          </>
        )}
      </details>
      <details onToggle={(e) => setReference(e.currentTarget.open)}>
        <summary>Ваш визуальный пример</summary>
        {reference && (
          <>
            <p>
              Использован как референс композиции и подачи интерфейса.
              Иллюстрации пакета нарисованы отдельно.
            </p>
            <AssetPreview
              endpoint={`/api/style-presets/${preset.id}/reference?pin=${preset.skillHash}`}
              label={`Ваш пример: ${preset.name}`}
            />
          </>
        )}
      </details>
    </div>
  );
}

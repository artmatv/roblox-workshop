import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Project, Skill, StylePackage, Role } from "../shared/domain.js";
import type {
  UiStyleDefinition,
  UiStylePreset,
} from "../shared/ui-style-presets.js";
import { Store, hash } from "./store.js";
import { ownerReferenceImages } from "./owner-references.js";

export const UI_STYLE_SKILL = "roblox-ui-styles";
const marker = z.object({
  id: z.string(),
  version: z.string(),
  definitionHash: z.string(),
  skillHash: z.string(),
});
const catalogues = new WeakMap<Store, Map<string, UiStylePreset[]>>();
export function uiStyleSkill(store: Store, pin?: string) {
  const current = store.get<Skill>("skill", UI_STYLE_SKILL);
  if (current?.status === "disabled")
    throw new Error("Навык roblox-ui-styles отключён в реестре");
  const skill =
    !pin || current?.hash === pin
      ? current
      : store.get<Skill>("skillArchive", `${UI_STYLE_SKILL}:${pin}`);
  if (
    !skill?.instructions ||
    !skill.checkedAt ||
    hash(skill.instructions) !== skill.hash
  )
    throw new Error("Сначала подключите проверенный roblox-ui-styles");
  return skill;
}
export function getStylePresets(store: Store, pin?: string): UiStylePreset[] {
  const skill = uiStyleSkill(store, pin),
    root = skill.path.replace(/\/SKILL\.md$/, ""),
    cache = catalogues.get(store) || new Map<string, UiStylePreset[]>();
  catalogues.set(store, cache);
  const saved = cache.get(skill.hash);
  if (saved) return saved;
  const source = JSON.parse(store.read(root + "/assets/presets.json")) as {
    version: string;
    sourceLocaleId: string;
    presets: UiStyleDefinition[];
  };
  if (source.sourceLocaleId !== "en-us" || source.version !== skill.version)
    throw new Error("Повреждён языковой контракт или версия пакета оформления");
  const values = source.presets.map((definition) => {
    if (!/^[a-z0-9-]+$/.test(definition.id))
      throw new Error("Неизвестная заготовка оформления");
    const previews: UiStylePreset["previews"] = [];
    for (const screen of ["hud", "menu", "shop", "inventory"] as const)
      for (const device of ["desktop", "mobile"] as const) {
        const file = `${root}/assets/${definition.id}-${screen}-${device}.svg`;
        store.read(file);
        previews.push({ screen, device, file, kind: "preset" });
      }
    return {
      ...definition,
      version: source.version,
      skillHash: skill.hash,
      definitionHash: hash({ skill: skill.hash, definition }),
      previews,
      icon: `${root}/assets/cover-${definition.id}.svg`,
      iconSheet: `${root}/assets/icons-${definition.id}.svg`,
    };
  });
  cache.set(skill.hash, values);
  return values;
}
export function presetRules(preset: UiStylePreset, skillHash: string) {
  const {
    previews,
    icon,
    iconSheet,
    version,
    definitionHash,
    skillHash: _packageHash,
    ...definition
  } = preset;
  return {
    preset: { id: preset.id, version, definitionHash, skillHash },
    uiKit: definition,
    geometry: preset.id === "tactical-tycoon" ? "arena" : "blocks",
    uiLayout:
      preset.id === "tactical-tycoon"
        ? "tactical"
        : preset.id === "neon-clicker"
          ? "playful"
          : "arcade",
    palette: preset.palette,
    materials: preset.materials,
    lighting: preset.lighting,
    avatar: preset.avatar,
    typography: preset.typography,
    world: preset.world,
    hud: preset.hud,
    menu: preset.menu,
    shop: preset.shop,
    inventory: preset.inventory,
    mobile: preset.mobile,
    rationale: preset.description,
    uiComposition: preset.signature,
    differentiation: preset.signature,
    previewRenderer: `roblox-ui-styles@${version}`,
  };
}
export function assertPresetStyle(
  store: Store,
  project: Project,
  style: StylePackage,
) {
  const selected = marker.parse(style.rules.preset);
  if (project.skillPins[UI_STYLE_SKILL] !== selected.skillHash)
    throw new Error(
      "Версия roblox-ui-styles в проекте изменилась; выберите заготовку заново",
    );
  const preset = getStylePresets(store, selected.skillHash).find(
    (p) => p.id === selected.id,
  );
  if (
    !preset ||
    preset.definitionHash !== selected.definitionHash ||
    preset.version !== selected.version ||
    hash(style.rules) !== hash(presetRules(preset, selected.skillHash))
  )
    throw new Error("Пакет оформления отличается от закреплённой заготовки");
  return preset;
}
export function presetAgentContext(store: Store, project: Project, role: Role) {
  if (!["art", "ui", "assets", "qa", "designer"].includes(role)) return null;
  const style = project.selectedStyle
    ? store.get<StylePackage>("style", project.selectedStyle)
    : undefined;
  if (!style?.rules.preset) {
    if (
      !project.skillPins[UI_STYLE_SKILL] ||
      store.get<Skill>("skill", UI_STYLE_SKILL)?.status === "disabled"
    )
      return null;
    const skill = uiStyleSkill(store, project.skillPins[UI_STYLE_SKILL]);
    return {
      skill: { id: skill.id, version: skill.version, hash: skill.hash },
      mode: style ? "preserve-existing-custom-style" : "choose-preset",
      presets: getStylePresets(store, skill.hash),
      icons: JSON.parse(
        store.read(skill.path.replace(/\/SKILL\.md$/, "/assets/icons.json")),
      ),
      previewEvidence:
        "Reusable style presets; no prototype or screenshot required for selection",
    };
  }
  const preset = assertPresetStyle(store, project, style),
    skill = uiStyleSkill(store, project.skillPins[UI_STYLE_SKILL]);
  const root = skill.path.replace(/\/SKILL\.md$/, "");
  return {
    skill: { id: skill.id, version: skill.version, hash: skill.hash },
    preset,
    icons: JSON.parse(store.read(root + "/assets/icons.json")),
    previewEvidence:
      "Reusable style preset, not a game screenshot or runtime test",
  };
}
export function presetReferenceImages(
  store: Store,
  project: Project,
  role: Role,
) {
  if (!["art", "ui", "assets", "qa"].includes(role)) return [];
  const owner = ownerReferenceImages(store, project.id);
  const style = project.selectedStyle
    ? store.get<StylePackage>("style", project.selectedStyle)
    : undefined;
  if (!style?.rules.preset) return owner;
  const preset = assertPresetStyle(store, project, style);
  const path = presetReferencePath(
    store,
    preset.id,
    project.skillPins[UI_STYLE_SKILL],
  );
  return [...(path ? [{ type: "localImage", path }] : []), ...owner];
}
export function presetReferencePath(
  store: Store,
  presetId: string,
  pin?: string,
) {
  const skill = uiStyleSkill(store, pin),
    preset = getStylePresets(store, pin).find((p) => p.id === presetId);
  if (!preset) return null;
  const metadata = JSON.parse(
    store.read(
      skill.path.replace(/\/SKILL\.md$/, "/references/user-images.json"),
    ),
  );
  const reference = metadata.images.find(
    (item: any) => item.file === preset.referenceImage,
  );
  if (!reference || !/^[a-z0-9-]+\.png$/.test(reference.file)) return null;
  const path = resolve(
    import.meta.dirname,
    "../.agents/skills/roblox-ui-styles/references/images",
    reference.file,
  );
  if (!existsSync(path)) return null;
  if (
    createHash("sha256").update(readFileSync(path)).digest("hex") !==
    reference.sha256
  )
    return null;
  return path;
}
export function stylePresetLibrary(store: Store, pin?: string) {
  try {
    return { items: getStylePresets(store, pin), error: null };
  } catch (error) {
    return { items: [], error: (error as Error).message };
  }
}

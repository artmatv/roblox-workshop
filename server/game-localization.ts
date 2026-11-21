import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Manifest } from "../shared/domain.js";
import { hash } from "./store.js";

export const GAME_LANGUAGE_POLICY = Object.freeze({
  version: 1,
  sourceLocaleId: "en-us",
  provider: "roblox",
  automaticTranslation: true,
});
export const GAME_LANGUAGE_INSTRUCTIONS = `Обязательное требование ко ВСЕМ играм: исходный язык всего видимого игроку интерфейса — английский (en-us), включая HUD, кнопки, меню, магазин, инвентарь, ошибки, подсказки, сообщения, world-space GUI и PlaceholderText. Названия проектов и документация сервиса могут быть по-русски. Используй Roblox LocalizationService и AutoLocalize; не пиши собственный сетевой переводчик и не фиксируй язык игрока. Не встраивай текст в картинки.
Статические Text/PlaceholderText задавай английскими строками в декларативных properties, AutoLocalize=true у GUI и его предков. Сервис автоматически создаёт английскую LocalizationTable, исходный CSV, ModuleScript ReplicatedStorage/AutomationI18n и клиентскую инициализацию; эти зарезервированные объекты самостоятельно не создавай.
Динамические сообщения оформляй целыми строками с ключами и именованными параметрами: data.localization={sourceLocaleId:'en-us',entries:[{key:'hud.coins',source:'Coins: {count:int}',context:'HUD balance',example:'Coins: 12'}]}. В клиентском коде: local I18n=require(game:GetService('ReplicatedStorage'):WaitForChild('AutomationI18n',10)); I18n.set(label,'hud.coins',{count=coins}). Повторный set обновляет параметры; язык меняется автоматически. Для PlaceholderText передай четвёртым аргументом 'PlaceholderText'. Не склеивай переведённые фрагменты, не вставляй числа в шаблон до перевода. I18n.bind(label,key,function() return {...} end) возвращает handle с :refresh() и :disconnect(). Пользовательский ввод и имена игроков не переводятся. Оставляй место для более длинных переводов, проверяй narrow/wide компоновку без обрезанных подписей.
Тест localization должен проверять реальную английскую исходную таблицу, все 4 экрана, AutoLocalize, форматирование динамических параметров и отсутствие неанглийских авторских UI строк. Облачный перевод нельзя объявлять включённым/проверенным до настройки опубликованного experience в Creator Hub; в неопубликованной Studio проверяй локальный английский fallback. Платные языки или переводческие услуги не включай.`;

const entrySchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/),
  source: z.string().min(1).max(4000),
  context: z.string().max(1000).default(""),
  example: z.string().max(4000).default(""),
});
export type LocaleEntry = z.infer<typeof entrySchema>;
export const LOCALIZATION_QA_INSTRUCTIONS = `Для каждой демонстрации верни отдельный исполняемый check id='localization' на desktop и mobile. В клиентском измерении каждого из четырёх экранов вызови I18n.audit(PlayerGui) и I18n.audit(workspace), передай реальные результаты через существующий QA RemoteEvent. Сервер выставляет localization passed только при получении успешного аудита всех четырёх экранов, не по наличию исходника. Не проверяй облачный перевод в неопубликованном Place. Если задача исправляет previousPreview, сохрани его мир, стиль, камеру и композицию; меняй только нужные UI тексты, динамические привязки и дефекты компоновки. Все английские статические подписи храни в properties, а не присваивай всю раскладку при старте Lua. У зарегистрированных I18n.set/bind и I18n.literal объектов AutoLocalize=false специально, чтобы не переводить дважды. Это корректно: не добавляй отдельную проверку всех AutoLocalize=true; используй I18n.audit, который отличает эти привязки. Аудит workspace с guiCount=0 допустим, если там нет world-space UI. PlayerGui обязан содержать настоящие четыре экрана. Авторинг исполняется без непосредственных инструментов Studio: ты получаешь полный предыдущий manifest в JSON; применяет и запускает тесты сервис. Не отказывайся от подготовки кода только из-за отсутствия у тебя непосредственного запуска Studio. Исполнитель Studio запускает run(args) отдельно на desktop и отдельно на mobile, затем объединяет результаты. В одном запуске возвращай проверки только текущего args.device, не добавляй not_run другого устройства. AutomationEnglishSource создаётся на КЛИЕНТЕ: сервер не видит клиентскую таблицу в LocalizationService. Читай клиентский I18n.audit через RemoteEvent, а английский каталог для серверной проверки — require(ReplicatedStorage.AutomationLocaleCatalog). При необходимости сервер сам создаёт временную LocalizationTable из catalog.entries для FormatByKey и удаляет её после проверки; не жди клиентскую таблицу на сервере.`;
const localeSchema = z.object({
  sourceLocaleId: z.literal("en-us").default("en-us"),
  entries: z.array(entrySchema).max(2000).default([]),
});
const textClasses = new Set(["TextLabel", "TextButton", "TextBox"]);
const guiClasses = new Set([
  ...textClasses,
  "ScreenGui",
  "SurfaceGui",
  "BillboardGui",
  "Frame",
  "ScrollingFrame",
  "ImageLabel",
  "ImageButton",
  "CanvasGroup",
  "ViewportFrame",
]);
const foreignLetters =
  /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Thai}]/u;
function english(text: string, where: string) {
  if (foreignLetters.test(text))
    throw new Error(
      `Исходный игровой UI должен быть английским: ${where}: ${text.slice(0, 100)}`,
    );
}
function placeholders(source: string) {
  const values = [...source.matchAll(/\{([^{}]+)\}/g)];
  for (const match of values)
    if (
      !/^[A-Za-z][A-Za-z0-9_]*(?::(?:int|fixed|num|translate))?$/.test(match[1])
    )
      throw new Error("Используйте именованные параметры Roblox: " + match[0]);
  if (/[{}]/.test(source.replace(/\{[^{}]+\}/g, "")))
    throw new Error("Незавершённый параметр локализации");
}
const luaString = (s: string) =>
  '"' +
  s.replace(/[\\"\x00-\x1f\x7f]/g, (c) =>
    c === "\\"
      ? "\\\\"
      : c === '"'
        ? '\\"'
        : "\\" + c.charCodeAt(0).toString().padStart(3, "0"),
  ) +
  '"';
export const gameLocalizationLuaString = luaString;
const csvCell = (s: string) => '"' + s.replaceAll('"', '""') + '"';
export function validateAuthoredGameText(manifest: Manifest) {
  const locale = localeSchema.parse(manifest.data.localization || {});
  for (const e of locale.entries) {
    english(e.source, e.key);
    placeholders(e.source);
  }
  for (const i of manifest.instances) {
    if (!textClasses.has(i.className)) continue;
    for (const prop of i.className === "TextBox"
      ? ["PlaceholderText"]
      : ["Text"]) {
      const text = i.properties[prop];
      if (typeof text === "string") english(text, i.path + "." + prop);
    }
  }
}
export function mergeLocaleEntries(manifests: Manifest[], prior?: Manifest) {
  const entries = new Map<string, LocaleEntry>();
  for (const m of manifests) {
    const locale = localeSchema.parse(m.data.localization || {});
    for (const entry of locale.entries) {
      const prior = entries.get(entry.key);
      if (prior && hash(prior) !== hash(entry))
        throw new Error("Конфликт ключей локализации " + entry.key);
      entries.set(entry.key, entry);
    }
  }
  if (prior)
    for (const entry of localeSchema.parse(prior.data.localization || {})
      .entries)
      if (!entries.has(entry.key)) entries.set(entry.key, entry);
  return { sourceLocaleId: "en-us", entries: [...entries.values()] };
}
export function assertGameLocalizationReady(manifest: Manifest) {
  const prepared = structuredClone(manifest);
  prepareGameLocalization(prepared);
  if (hash(manifest) !== hash(prepared))
    throw new Error(
      "Сборка требует английский каталог, AutoLocalize и актуальную интеграцию Roblox Localization",
    );
}
export function prepareGameLocalization(manifest: Manifest) {
  validateAuthoredGameText(manifest);
  const before = hash(manifest),
    locale = localeSchema.parse(manifest.data.localization || {}),
    entries = new Map<string, LocaleEntry>();
  for (const e of locale.entries) {
    english(e.source, e.key);
    placeholders(e.source);
    if (entries.has(e.key))
      throw new Error("Повторный ключ локализации " + e.key);
    entries.set(e.key, e);
  }
  // Roblox matches AutoLocalize text by Source+Context; an authored entry
  // (e.g. from prepare_localization) already covers that label.
  const authored = new Set(
    locale.entries.map((e) => JSON.stringify([e.source, e.context])),
  );
  for (const i of manifest.instances) {
    if (guiClasses.has(i.className)) {
      if (i.properties.AutoLocalize === false)
        throw new Error(
          "Отключать AutoLocalize можно только для динамических привязок I18n в runtime: " +
            i.path,
        );
      i.properties.AutoLocalize = true;
    }
    if (!textClasses.has(i.className)) continue;
    // TextBox.Text is user input. Its placeholder is authored UI.
    for (const prop of i.className === "TextBox"
      ? ["PlaceholderText"]
      : ["Text"]) {
      const text = i.properties[prop];
      if (typeof text !== "string" || !text.trim()) continue;
      english(text, i.path + "." + prop);
      const key = "ui." + hash(i.path + "." + prop).slice(0, 20),
        entry = {
          key,
          source: text,
          context: i.path.replaceAll("/", "."),
          example: "",
        };
      if (authored.has(JSON.stringify([entry.source, entry.context]))) continue;
      const existing = entries.get(key);
      if (
        existing &&
        existing.context !== entry.context &&
        existing.context !== i.path + "." + prop
      )
        throw new Error("Конфликт автоматического ключа " + key);
      entries.set(key, entry);
    }
  }
  const sorted = [...entries.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const sourceContexts = new Map<string, string>();
  for (const entry of sorted) {
    const identity = JSON.stringify([entry.source, entry.context]);
    const previous = sourceContexts.get(identity);
    if (previous)
      throw new Error(
        "Для импорта Roblox Source+Context должны быть уникальны: " +
          previous +
          ", " +
          entry.key,
      );
    sourceContexts.set(identity, entry.key);
  }
  if (
    !sorted.length &&
    manifest.instances.some((i) => textClasses.has(i.className))
  )
    throw new Error(
      "Для игрового UI нужен непустой английский каталог: статические подписи в properties или data.localization.entries",
    );
  const catalog =
    'return {sourceLocaleId="en-us",entries={\n' +
    sorted
      .map(
        (e) =>
          "{Key=" +
          luaString(e.key) +
          ",Source=" +
          luaString(e.source) +
          ",Context=" +
          luaString(e.context) +
          ",Example=" +
          luaString(e.example) +
          ",Values={}},",
      )
      .join("\n") +
    "\n}}\n";
  const owned = [
    "ReplicatedStorage/AutomationLocaleCatalog",
    "ReplicatedStorage/AutomationI18n",
    "StarterPlayer/StarterPlayerScripts/AutomationLocalization",
  ];
  const firstOwned = manifest.instances.findIndex((i) =>
    owned.includes(i.path),
  );
  manifest.instances = manifest.instances.filter(
    (i) => !owned.includes(i.path),
  );
  if (
    !manifest.instances.some(
      (i) => i.path === "StarterPlayer/StarterPlayerScripts",
    )
  )
    manifest.instances.push({
      path: "StarterPlayer/StarterPlayerScripts",
      className: "StarterPlayerScripts",
      properties: {},
    });
  manifest.instances.splice(
    firstOwned < 0 ? manifest.instances.length : firstOwned,
    0,
    {
      path: owned[0],
      className: "ModuleScript",
      properties: {},
      source: catalog,
    },
    {
      path: owned[1],
      className: "ModuleScript",
      properties: {},
      source: readFileSync(
        new URL("./game-i18n.luau", import.meta.url),
        "utf8",
      ),
    },
    {
      path: owned[2],
      className: "LocalScript",
      properties: {},
      source:
        'local module=game:GetService("ReplicatedStorage"):WaitForChild("AutomationI18n",10)\nif not module then warn("English localization module missing") return end\nlocal I18n=require(module)\nI18n.configure(game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui"))\nI18n.configure(workspace)\nscript.Destroying:Connect(I18n.destroy)\n',
    },
  );
  manifest.data.localization = {
    ...GAME_LANGUAGE_POLICY,
    entries: sorted,
    cloudStatus: "requires-experience-configuration",
  };
  const path = "localization/en-us.csv";
  const csvIndex = manifest.files.findIndex((f) => f.path === path);
  manifest.files = manifest.files.filter((f) => f.path !== path);
  manifest.files.splice(csvIndex < 0 ? manifest.files.length : csvIndex, 0, {
    path,
    content:
      "Key,Source,Context,Example\r\n" +
      sorted
        .map((e) =>
          [e.key, e.source, e.context, e.example].map(csvCell).join(","),
        )
        .join("\r\n") +
      "\r\n",
  });
  const setupPath = "localization/ROBLOX_SETUP.md";
  const setupIndex = manifest.files.findIndex((f) => f.path === setupPath);
  manifest.files = manifest.files.filter((f) => f.path !== setupPath);
  manifest.files.splice(
    setupIndex < 0 ? manifest.files.length : setupIndex,
    0,
    {
      path: setupPath,
      content:
        "# Roblox localization setup\n\nThe authored source language is English (en-us). Native AutoLocalize and keyed dynamic messages are included. Cloud translation is not automatically enabled by this exported place.\n\n1. In the published experience's Creator Hub Localization settings, set the source language to English. Enable text capture and use of translated content.\n2. Select target languages for experience strings/products and confirm the Roblox translation quota. Do not enable paid capacity without the owner's approval.\n3. Import en-us.csv from this folder. Preserve keys and named placeholders. Review translations of static and dynamic text.\n4. Test each enabled language on desktop and mobile, including longer strings, parameter formatting, player names, locale changes and translator failure. Record the experience and build tested.\n\nLocalizationService.RobloxLocaleId is not the experience source-language setting. An unpublished Studio place verifies English fallback, not automatic cloud translation.\n\nDocumentation: https://create.roblox.com/docs/production/localization/automatic-translations\n",
    },
  );
  return before !== hash(manifest);
}

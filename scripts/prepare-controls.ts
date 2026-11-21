import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, "..");
const s = new Store(resolve(root, "data"));
const token = await new Vault(s).get("dashboard-token");
s.close();
const request = async (path: string, body?: unknown, method?: string) => {
  const r = await fetch("http://127.0.0.1:4317/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(path + ": " + d.error);
  return d;
};
const source = readFileSync(
  resolve(root, "examples/CONTROL_PROJECTS.md"),
  "utf8",
).replace(/\r\n/g, "\n");
const definitions = [
  { name: "Лунные почтальоны", genre: "Obby", key: "moon" },
  {
    name: "Кристальный питомник",
    genre: "Симулятор с прогрессией",
    key: "crystal",
  },
  {
    name: "Световые маяки",
    genre: "Многопользовательские раунды",
    key: "beacons",
  },
];
const stamp = new Date().toISOString();
const sources = [
  {
    game: "Pet Simulator 99 / Classic Index",
    author: "BIG Games",
    url: "https://www.biggames.io/post/pet-simulator-99-update-99",
    checkedAt: stamp,
    device: "Не указан; изображение 828×484",
    screen: "Коллекция",
    observations:
      "Светлое окно, контурные карточки, сетка и цветовые выделения.",
    confidence:
      "Визуально проверено официальное изображение от 24.10.2026; устройство неизвестно.",
  },
  {
    game: "Pet Simulator 99 / PSX Classic",
    author: "BIG Games",
    url: "https://www.biggames.io/post/pet-simulator-99-update-99",
    checkedAt: stamp,
    device: "Не указан; изображение 828×466",
    screen: "3D-магазин, не экран покупки",
    observations:
      "Светлые объёмы, крупная вывеска и цветовые группы предметов.",
    confidence:
      "Визуально проверен мир на официальном изображении от 24.10.2026; окно покупки не подтверждено.",
  },
  {
    game: "Pet Simulator 99 / Season Pass",
    author: "BIG Games",
    url: "https://www.biggames.io/post/pet-simulator-99-update-100",
    checkedAt: stamp,
    device: "Не указан; изображение 828×432",
    screen: "Награды и прогресс",
    observations: "Карточки наград, крупное закрытие и полоса прогресса.",
    confidence:
      "Визуально проверено официальное изображение от 31.10.2026; не мобильный аудит.",
  },
  {
    game: "Grow a Garden",
    author: "The Garden Game",
    url: "https://www.roblox.com/games/126884695634066/Grow-a-Garden",
    checkedAt: stamp,
    device: "Не установлен",
    screen: "Страница игры",
    observations:
      "Подтверждены автор и цикл выращивания; экран HUD здесь не изучен.",
    confidence:
      "Точка входа и идентичность проверены 01.11.2026. Свежий HUD не подтверждён.",
  },
  {
    game: "Fisch",
    author: "Fisching",
    url: "https://www.roblox.com/games/16732694052/Fisch",
    checkedAt: stamp,
    device: "Не установлен",
    screen: "Страница игры",
    observations:
      "Описаны исследование и прогрессия; внешний вид HUD страницей не подтверждён.",
    confidence:
      "Идентичность проверена 01.11.2026. Атмосферное семейство — аналитическое направление, UI адаптации собственный.",
  },
  {
    game: "RIVALS",
    author: "Nosniy Games",
    url: "https://www.roblox.com/games/17625359962/RIVALS",
    checkedAt: stamp,
    device: "Страница перечисляет ПК и телефоны",
    screen: "Страница игры",
    observations:
      "Подтверждён соревновательный цикл; точный HUD по этой странице не установлен.",
    confidence:
      "Идентичность и описание проверены 01.11.2026. UI варианта — собственная концепция.",
  },
];
const images: string[] = [];
for (const name of ["ps99-index.png", "ps99-season.png"]) {
  const r = await request("/attachments", {
    mime: "image/png",
    dataBase64: readFileSync(
      resolve(root, "docs/style-references", name),
    ).toString("base64"),
  });
  images.push(r.file);
}
const state = await request("/state");
const projects = [];
for (const d of definitions) {
  const section = source
    .split("## " + d.name + "\n")[1]
    ?.split("\n## ")[0]
    ?.trim();
  if (!section) throw new Error("Нет утверждённой концепции " + d.name);
  const concept = section.split("\n\nПредложение приёмки:")[0].trim();
  let p = state.projects.find((p: any) => p.name === d.name);
  if (!p)
    p = await request("/projects", {
      name: d.name,
      genre: d.genre,
      goal: "Контрольный проект по ТЗ: законченный цикл, три доработки и последующее расширение. Концепция утверждена пользователем 01.11.2026. Публикация и платные услуги требуют отдельных решений.",
    });
  const current = await request("/projects/" + p.id);
  if (current.project.concept !== concept)
    await request("/projects/" + p.id, { concept }, "PATCH");
  if (!current.project.approvals.concept || current.project.concept !== concept)
    await request("/projects/" + p.id + "/approve", { name: "concept" });
  if (
    !current.research.some(
      (r: any) =>
        r.summary ===
        "Проверенные точки входа и визуальные материалы для оформления",
    )
  )
    await request("/projects/" + p.id + "/references", { sources, images });
  if (
    !current.styles.length &&
    !current.tasks.some(
      (t: any) =>
        t.kind === "styles" &&
        ["running", "queued", "verifying", "dependencies"].includes(t.status),
    )
  )
    await request("/projects/" + p.id + "/phase", { phase: "concept" });
  projects.push({ ...d, id: p.id, conceptApproved: true });
}
mkdirSync(resolve(root, "docs/control-projects"), { recursive: true });
writeFileSync(
  resolve(root, "docs/control-projects/projects.json"),
  JSON.stringify(
    {
      approvedAt: stamp,
      approvalSource: "User chat: Утверждаю три предложенные концепции",
      projects,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    projects.map((p) => ({ name: p.name, id: p.id })),
    null,
    2,
  ),
);

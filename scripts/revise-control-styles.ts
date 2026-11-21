import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root = resolve(import.meta.dirname, ".."),
  store = new Store(resolve(root, "data")),
  token = await new Vault(store).get("dashboard-token");
store.close();
const controls = JSON.parse(
  readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
);
const common =
  "Пользователь отклонил первую подборку: «ну стили почти не отличаются, нужно работать по скиллу для роблокса». Переработка NATIVE_STYLE_REVIEW_2. Используй закреплённые roblox-ui, game-ui-ux и create-game-assets. Прежняя одна диорама и смена цветов не подходят. Три пакета должны иметь заметно разные архитектуру/силуэт мира, героя крупного масштаба, формы и компоновки 4 экранов. Это будут настоящие сцены Roblox, а не параметризованные SVG. Одинаковые механики/товары/состояния, без изменения утверждённой концепции. Требуется возможность узнать направление в чёрно-белом силуэте. Дай подробные world, uiComposition и differentiation, реально воспроизводимые стандартными Roblox Instance. Не называй проект утверждённым стилем до пользовательского выбора.";
const briefs: Record<string, string> = {
  moon: "Ровно 3 направления: (1) roblox-classic blocks/arcade — блочная экспресс-почта, ступенчатые яркие станции со studs, полосы и флажки маршрута, блочный курьер с сумкой, HUD как почтовая маршрутная карточка, квадратная сетка инвентаря/марок. (2) toy-cartoon rounded/playful — игрушечная орбита, округлые космические капсулы, пухлые купола, пастельные мостики, курьер с большим сферическим шлемом и миниатюрным рюкзаком, интерфейс с крупными посылками-пиктограммами и отдельной лентой пути, магазин большие карточки и увеличенный осмотр. (3) atmospheric-lowpoly faceted/quiet — лунная экспедиция, широкая природная скальная поверхность и медные почтовые модули, направляющие огни, выразительный исследователь в скафандре, минимальный HUD и полевой журнал с вертикальным списком предметов. Различай объём/фон/архитектуру, не просто серый цвет тех же платформ. Не вводи рейтинг, оружие или команды вместо obby.",
  crystal:
    "Ровно 3 направления: (1) roblox-classic blocks/arcade — солнечный блочный сад с грядками, видимая ступенчатая архитектура трёх зон, блочный садовник с инструментом, чёткие счётчики и сетка. (2) toy-cartoon rounded/playful — фантастическая оранжерея с округлыми стеклянными куполами и крупными выращенными кристаллами, игрушечный садовник с крупной лейкой, HUD пузырьки роста и крупные карточки посадок, меню как витрина сада. (3) atmospheric-lowpoly faceted/quiet — минеральный сад в природной пещере/каньоне, слоистые стены, мягкий свет и вода, спокойный исследователь, HUD контекст ухода и инвентарь полевой каталог. Сохраняются 3 ресурса, 3 зоны и улучшения инструмента; не вводи раунд/боёвку. Игровые значения одинаковы во всех пакетах.",
  beacons:
    "Ровно 3 направления: (1) roblox-classic blocks/arcade — яркая блочная станция с крупными башнями маяков и проводниками энергии, выразительные номера участников и квадратный счёт раунда. (2) competitive-clean arena/tactical — современный чистый научный комплекс, другие силуэты сооружений и тёмные стеклянные панели, плоский тактический HUD с центральным таймером и схемой маяков, подробный боковой осмотр предмета. (3) atmospheric-lowpoly faceted/quiet — природная долина с гранёными скалами/лесом и древними маяками, глубокий мягкий свет, походные персонажи, компактные командные статусы и журнал экспедиции. По-разному формируй окружение и предметы, а не одну плоскую арену. Тот же совместный цикл 2–4 игроков, три маяка/раунда, никакого PvP.",
};
const report = [];
for (const p of controls.projects) {
  const r = await fetch(
    "http://127.0.0.1:4317/api/projects/" + p.id + "/styles/revise",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: common + " " + briefs[p.key] }),
    },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  report.push({
    projectId: p.id,
    name: p.name,
    feedbackId: d.id,
    taskIds: d.taskIds,
  });
}
writeFileSync(
  resolve(root, "docs/control-projects/native-style-revision.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      source: "User rejected similar styles and requested Roblox skill",
      projects: report,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(report, null, 2));

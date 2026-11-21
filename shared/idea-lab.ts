import { z } from "zod";
import { directionGroups } from "./vocabulary.js";

// Idea lab: three random words make a game title, the agent develops it into
// a plan of picks, and similar live Roblox games check the idea.
export const IDEA_POLICY_VERSION = "idea-lab-v1";

const list = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
// Reel words: kid-friendly, generic (no game or brand names); a single word
// stays within 10 letters so it fits a reel.
export const IDEA_VERBS = list(`
  Run, Build, Grow, Tame, Dodge, Escape, Feed, Hatch, Collect, Rescue,
  Defend, Race, Steal, Fix, Cook, Paint, Launch, Climb, Shrink, Guard,
  Explore, Train, Clean, Bake, Catch, Drive, Fly, Dig, Ride, Sell, Mine,
  Find, Survive, Protect, Upgrade, Merge, Stack, Bounce, Haunt, Decorate,
  Adopt, Balance, Blast, Brew, Carry, Chase, Craft, Crush, Deliver, Design,
  Dive, Draw, Dress, Evolve, Fill, Fish, Flip, Freeze, Glide, Grab, Heal,
  Hide, Hop, Hunt, Inflate, Invent, Juggle, Jump, Kick, Lift, Light, Melt,
  Mix, Mow, Open, Pack, Pet, Pilot, Plant, Polish, Pop, Pull, Push, Raise,
  Rebuild, Recycle, Repair, Roll, Save, Scare, Sculpt, Serve, Shake, Shovel,
  Skate, Slide, Smash, Sneak, Splash, Spin, Squish, Stomp, Surf, Swap,
  Swing, Teleport, Throw, Tickle, Toss, Trade, Trap, Unlock, Wash, Water,
  Wrap, Zap, Breed, Bowl, Chop, Count, Drop, Float, Hammer, Knock, Paddle,
  Rewind, Sail, Shine, Sort, Spray, Steer, Stretch, Tow, Track, Visit, Wake,
  Wobble
`);
const SINGULAR_NOUNS = list(`
  Zoo, Toy Store, Volcano, Candy Factory, Pizza Shop, Dragon, Haunted Hotel,
  Space Station, Pet Shelter, Ice Castle, Pirate Ship, Jungle Temple,
  Lemonade Stand, Giant Slime, Sky Island, Bakery, Train Station,
  Magic School, Lava Floor, Treasure Map, Bubble Factory, Monster Truck,
  Garden, Farm, Aquarium, Rocket, Snowman, Castle, Mall, Museum, Circus,
  Lighthouse, Treehouse, Water Park, Meteor, Tornado, Rainbow Bridge,
  Secret Lab, Burger Truck, Arcade, Hamster Wheel, Ice Cream Truck, Robot,
  Egg, Airport, Amusement Park, Ant Farm, Apple Tree, Art Studio, Avalanche,
  Backyard, Balloon, Bamboo Forest, Bank Vault, Barber Shop, Beach House,
  Beehive, Bicycle, Black Hole, Blimp, Boat, Bookstore, Bounce House,
  Bowling Alley, Bridge, Bubble Bath, Bulldozer, Bus, Cactus, Cake,
  Campfire, Candy Cane, Canyon, Car Wash, Carnival, Carousel, Cat Cafe,
  Cave, Chicken Coop, Chocolate River, Cinema, Cloud, Clock Tower,
  Coffee Shop, Comet, Coral Reef, Cookie Jar, Cowboy Town, Crystal Mine,
  Cupcake Shop, Desert Island, Diamond, Diner, Dino Park, Dog Park,
  Donut Shop, Doghouse, Dollhouse, Dream, Dungeon, Elevator, Fairy Forest,
  Fire Station, Fireworks Show, Fish Tank, Flower Shop, Food Truck,
  Football Field, Fortress, Fountain, Fridge, Frozen Lake, Fruit Stand,
  Galaxy, Garage, Ghost Ship, Giant Cookie, Cookie House, Glacier,
  Gold Mine, Golf Course, Greenhouse, Gym, Hair Salon, Haunted Forest,
  Helicopter, Hospital, Hot Air Balloon, Hotel, Ice Rink, Igloo, Island,
  Jellyfish, Jetpack, Jungle Gym, Kingdom, Kitchen, Kite, Lava Lake,
  Library, Lifeboat, Llama Farm, Lunchbox, Magic Wand, Mansion, Marble Run,
  Maze, Mermaid Lagoon, Meteor Shower, Moon Base, Motel, Mountain, Mud Pit,
  Mushroom Forest, Music Box, Ninja Dojo, Noodle Shop, Star Tower, Ocean,
  Octopus, Orchard, Paint Factory, Palace, Pancake Stack, Paper Plane,
  Parade, Park, Pet Store, Piano, Pineapple, Pinball Machine, Pirate Cove,
  Planet, Playground, Police Station, Pond, Popcorn Machine, Post Office,
  Potion Shop, Pumpkin Patch, Puppy Hotel, Pyramid, Race Track, Radio Tower,
  Rain Cloud, Ranch, Rubber Duck, Roller Coaster, Sandcastle, Satellite,
  School Bus, Science Fair, Sea Monster, Shark Tank, Shopping Cart,
  Skate Park, Ski Resort, Skyscraper, Sled, Slime Factory, Snow Globe,
  Soccer Ball, Sock Drawer, Space Shuttle, Spaceship, Spa, Stadium,
  Submarine, Subway, Sunflower Field, Grocery Store, Swamp, Swimming Pool,
  Taco Truck, Teapot, Tent, Theater, Time Machine, Toaster, Tower, Toy Box,
  Tractor, Traffic Jam, Trampoline, Treasure Chest, Tropical Island,
  Tugboat, UFO, Underwater City, Unicorn, Vending Machine, Video Game,
  Village, Waffle Shop, Waterfall, Wedding Cake, Whale, Windmill,
  Wizard Tower, Raft, Yacht, Yeti, Zipline, Moon, Sun, Rainforest,
  Cloud Kingdom, Gumball Machine, Jelly Castle, Toy Train, Pillow Fort,
  Bathtub, Banana, Watermelon, Snail, Turtle, Penguin, Giraffe, Panda,
  Shark, Llama, Hamster, Puppy, Kitten, Bunny, Owl, Fox, Bear, Monkey,
  Frog, Parrot, Dolphin, Crab, Squid, Capybara, Raccoon, Duck, Goat, Pony,
  Cow, Pig, Chicken
`);
const PLURAL_NOUNS = list(`
  Rolling Barrels, Dinosaurs, Ghosts, Bees, Ninjas, Kittens, Aliens,
  Balloons, Bunnies, Cupcakes, Ducklings, Fireflies, Frogs, Gnomes,
  Hamsters, Lemons, Marbles, Meteors, Monsters, Mummies, Penguins, Pirates,
  Pizzas, Puppies, Raccoons, Robots, Slimes, Snowballs, Socks, Squirrels,
  Toys, Unicorns, Zombies, Wizards, Knights, Cowboys, Chickens, Cars,
  Trains, Rockets, Planets, Coins, Gems, Mushrooms, Pumpkins, Clouds,
  Bubbles, Crabs
`);
export const IDEA_NOUNS: Array<{ word: string; plural?: true }> = [
  ...SINGULAR_NOUNS.map((word) => ({ word })),
  ...PLURAL_NOUNS.map((word) => ({ word, plural: true as const })),
];
// Which noun number each article fits: "a Dinosaurs" never comes up.
const ARTICLE_FIT: Record<string, "any" | "singular" | "plural"> = {
  a: "singular",
  the: "any",
  my: "any",
  your: "any",
  our: "any",
  every: "singular",
  this: "singular",
  one: "singular",
  "all the": "plural",
  "100": "plural",
};
export const IDEA_ARTICLES = Object.keys(ARTICLE_FIT);
export type IdeaWords = { verb: string; article: string; noun: string };
export type IdeaReel = keyof IdeaWords;
const noun = (word: string) => IDEA_NOUNS.find((n) => n.word === word);
const fits = (article: string, word: string) =>
  ARTICLE_FIT[article] === "any" ||
  (ARTICLE_FIT[article] === "plural") === !!noun(word)?.plural;
export const articlesFor = (word: string) =>
  IDEA_ARTICLES.filter((a) => fits(a, word));
// "an Egg", but "a Unicorn" and "a UFO": those start with a "you" sound.
export const articleText = (article: string, word: string) =>
  article === "a" && /^[aeiou]/i.test(word) && !/^(uni|ufo|use)/i.test(word)
    ? "an"
    : article;
export function ideaTitle(w: IdeaWords) {
  const article = articleText(w.article, w.noun);
  const shown = ["a", "an", "the"].includes(article)
    ? article
    : article[0].toUpperCase() + article.slice(1);
  return `${w.verb} ${shown} ${w.noun}`;
}
export function validIdeaWords(w: IdeaWords) {
  return (
    IDEA_VERBS.includes(w.verb) &&
    !!noun(w.noun) &&
    articlesFor(w.noun).includes(w.article)
  );
}
// Locked reels keep their word. An unlocked reel never shows its current word
// again and skips the recently seen ones in `avoid`. With the article locked,
// only nouns that fit it come up; with the noun locked, only fitting articles.
export function spinIdeaWords(
  current: IdeaWords | null,
  locked: Partial<Record<IdeaReel, boolean>> = {},
  random = Math.random,
  avoid: readonly string[] = [],
): IdeaWords {
  const pick = (options: string[], now?: string) => {
    const fresh = options.filter((w) => w !== now && !avoid.includes(w));
    const from = fresh.length ? fresh : options;
    return from[Math.floor(random() * from.length)];
  };
  const keep = (reel: IdeaReel) =>
    current && locked[reel] ? current[reel] : null;
  const verb = keep("verb") || pick(IDEA_VERBS, current?.verb);
  const lockedArticle = keep("article");
  const nounWord =
    keep("noun") ||
    pick(
      IDEA_NOUNS.map((n) => n.word).filter(
        (w) => !lockedArticle || fits(lockedArticle, w),
      ),
      current?.noun,
    );
  const article =
    lockedArticle && fits(lockedArticle, nounWord)
      ? lockedArticle
      : pick(articlesFor(nounWord), current?.article);
  return { verb, article, noun: nounWord };
}

export type IdeaOption = { id: string; label: string };
export type IdeaGroup = {
  id: string;
  label: string;
  mode: "one" | "any";
  options: IdeaOption[];
};
export type IdeaStep = {
  id: string;
  title: string;
  hint: string;
  groups: IdeaGroup[];
};
const options = (list: Array<[string, string]>) =>
  list.map(([id, label]) => ({ id, label }));
export const IDEA_STEPS: IdeaStep[] = [
  {
    id: "game",
    title: "Игра",
    hint: "Какой это жанр Roblox. Можно выбрать несколько для смеси.",
    groups: [
      {
        id: "genre",
        label: "Жанр",
        mode: "any",
        options: directionGroups.flatMap((g) =>
          g.items.map(([name]) => ({ id: name, label: name })),
        ),
      },
    ],
  },
  {
    id: "loop",
    title: "Главное действие",
    hint: "Что игрок делает снова и снова.",
    groups: [
      {
        id: "loop",
        label: "Действие",
        mode: "one",
        options: options([
          ["build", "Строить"],
          ["collect", "Собирать"],
          ["steal", "Красть у других"],
          ["sneak", "Прокрадываться"],
          ["hatch", "Выводить питомцев"],
          ["harvest", "Выращивать и собирать урожай"],
          ["waves", "Отбивать волны"],
          ["last", "Остаться последним"],
          ["race", "Обгонять"],
          ["climb", "Прыгать и забираться"],
          ["explore", "Исследовать"],
          ["fight", "Сражаться"],
          ["care", "Ухаживать"],
          ["create", "Создавать образы"],
          ["serve", "Обслуживать посетителей"],
        ]),
      },
    ],
  },
  {
    id: "first",
    title: "Первая минута",
    hint: "Что увидит и сделает новичок сразу после входа.",
    groups: [
      {
        id: "firstMinute",
        label: "Начало",
        mode: "any",
        options: options([
          ["instant", "Сразу в основное действие"],
          ["reward30", "Награда в первые 30 секунд"],
          ["arrows", "Короткое обучение стрелками"],
          ["starter", "Выбор стартового питомца или героя"],
          ["intro", "Короткая сценка-вступление"],
        ]),
      },
    ],
  },
  {
    id: "progress",
    title: "Прогрессия",
    hint: "Что открывается по ходу игры и зачем возвращаться завтра.",
    groups: [
      {
        id: "unlocks",
        label: "Открывается",
        mode: "any",
        options: options([
          ["pets", "Питомцы"],
          ["base", "База побольше"],
          ["upgrades", "Улучшения"],
          ["rebirth", "Перерождение (Rebirth)"],
          ["rare", "Редкие предметы"],
          ["levels", "Уровни и навыки"],
          ["gear", "Снаряжение и инструменты"],
          ["vehicles", "Транспорт"],
          ["cosmetics", "Скины и косметика"],
          ["index", "Индекс коллекции"],
          ["ranks", "Ранги и титулы"],
          ["zones", "Новые зоны"],
        ]),
      },
      {
        id: "return",
        label: "Зачем вернуться",
        mode: "any",
        options: options([
          ["offline", "Офлайн-доход"],
          ["daily", "Ежедневные награды"],
          ["streak", "Серия входов"],
          ["quests", "Задания на день и неделю"],
          ["events", "Временные события"],
          ["updates", "Еженедельные обновления"],
          ["limited", "Лимитированные предметы"],
          ["season", "Сезонный сброс лидерборда"],
          ["codes", "Новые коды"],
        ]),
      },
    ],
  },
  {
    id: "together",
    title: "Вместе",
    hint: "Как в неё играют с друзьями.",
    groups: [
      {
        id: "together",
        label: "С кем",
        mode: "any",
        options: options([
          ["solo", "Соло"],
          ["coop", "Кооператив"],
          ["teams", "Команды"],
          ["pvp", "PvP"],
          ["trading", "Обмен"],
          ["leaderboard", "Лидерборд"],
        ]),
      },
    ],
  },
  {
    id: "world",
    title: "Мир",
    hint: "Где происходит игра и как устроена карта.",
    groups: [
      {
        id: "setting",
        label: "Место",
        mode: "one",
        options: options([
          ["forest", "Лес"],
          ["city", "Город"],
          ["space", "Космос"],
          ["ocean", "Океан"],
          ["desert", "Пустыня"],
          ["candy", "Конфетная страна"],
          ["neon", "Неоновый sci-fi"],
          ["snow", "Снега"],
          ["dungeon", "Подземелье"],
          ["mix", "Смесь миров"],
        ]),
      },
      {
        id: "map",
        label: "Карта",
        mode: "one",
        options: options([
          ["plots", "Свои участки"],
          ["open", "Открытая карта"],
          ["hub", "Хаб из 3 зон"],
          ["building", "Большое здание"],
          ["islands", "Острова"],
          ["arena", "Арена"],
          ["track", "Трасса от старта к финишу"],
        ]),
      },
    ],
  },
  {
    id: "look",
    title: "Вид и управление",
    hint: "Стиль картинки и камера.",
    groups: [
      {
        id: "style",
        label: "Стиль",
        mode: "one",
        options: options([
          ["studs", "Классический Roblox (studs)"],
          ["lowpoly", "Low-poly"],
          ["cartoon", "Мультяшный"],
          ["anime", "Аниме"],
          ["realistic", "Полуреализм"],
          ["neon", "Неон"],
        ]),
      },
      {
        id: "camera",
        label: "Камера",
        mode: "one",
        options: options([
          ["third", "От третьего лица"],
          ["top", "Сверху"],
          ["side", "Сбоку"],
          ["first", "От первого лица"],
        ]),
      },
    ],
  },
  {
    id: "screens",
    title: "Экраны",
    hint: "Меню и кнопки на экране.",
    groups: [
      {
        id: "screens",
        label: "Экраны",
        mode: "any",
        options: options([
          ["hud", "Деньги и уровень (HUD)"],
          ["shop", "Магазин"],
          ["upgrades", "Улучшения"],
          ["inventory", "Инвентарь"],
          ["daily", "Ежедневные награды"],
          ["quests", "Задания"],
          ["codes", "Коды"],
          ["leaderboard", "Лидерборд"],
          ["wheel", "Колесо удачи"],
          ["index", "Индекс коллекции"],
          ["crafting", "Крафт"],
          ["map", "Карта"],
          ["loading", "Экран загрузки"],
          ["settings", "Настройки"],
        ]),
      },
    ],
  },
  {
    id: "robux",
    title: "Robux",
    hint: "Как игра зарабатывает.",
    groups: [
      {
        id: "robux",
        label: "Покупки",
        mode: "any",
        options: options([
          ["passes", "Game passes"],
          ["boosts", "Бусты x2"],
          ["products", "Разовые покупки (Developer products)"],
          ["subscriptions", "Подписки"],
          ["crates", "Ящики и спины с показом шансов"],
          ["cosmetics", "Только косметика"],
          ["none", "Без покупок на старте"],
        ]),
      },
    ],
  },
  {
    id: "version",
    title: "Первая версия",
    hint: "Что войдёт в первую сборку.",
    groups: [
      {
        id: "firstVersion",
        label: "Объём",
        mode: "one",
        options: options([
          ["loop", "Только главное действие"],
          ["progress", "Действие и прогрессия"],
          ["everything", "Всё выбранное"],
        ]),
      },
    ],
  },
];
export const IDEA_GROUPS = IDEA_STEPS.flatMap((s) => s.groups);
export type IdeaPicks = Record<string, string[]>;
const maxPicks = (g: IdeaGroup) => (g.mode === "one" ? 1 : 4);

// The agent's plan: a recommendation with a short reason for every group.
export const ideaPlanSchema = z.object({
  pitch: z.string().trim().min(20).max(400),
  twist: z.string().trim().min(10).max(300),
  hook: z.string().trim().min(10).max(300),
  searchQueries: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(40)
        .regex(/^[A-Za-z0-9 '&-]+$/),
    )
    .min(1)
    .max(3),
  recommendations: z.object(
    Object.fromEntries(
      IDEA_GROUPS.map((g) => [
        g.id,
        z.object({
          picks: z
            .array(z.enum(g.options.map((o) => o.id) as [string, ...string[]]))
            .min(1)
            .max(maxPicks(g)),
          reason: z.string().trim().min(5).max(300),
        }),
      ]),
    ),
  ),
});
export type IdeaPlan = z.infer<typeof ideaPlanSchema>;
export const ideaPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pitch", "twist", "hook", "searchQueries", "recommendations"],
  properties: {
    pitch: { type: "string", minLength: 20, maxLength: 400 },
    twist: { type: "string", minLength: 10, maxLength: 300 },
    hook: { type: "string", minLength: 10, maxLength: 300 },
    searchQueries: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "string",
        minLength: 2,
        maxLength: 40,
        pattern: "^[A-Za-z0-9 '&-]+$",
      },
    },
    recommendations: {
      type: "object",
      additionalProperties: false,
      required: IDEA_GROUPS.map((g) => g.id),
      properties: Object.fromEntries(
        IDEA_GROUPS.map((g) => [
          g.id,
          {
            type: "object",
            additionalProperties: false,
            required: ["picks", "reason"],
            properties: {
              picks: {
                type: "array",
                minItems: 1,
                maxItems: maxPicks(g),
                items: { type: "string", enum: g.options.map((o) => o.id) },
              },
              reason: { type: "string", minLength: 5, maxLength: 300 },
            },
          },
        ]),
      ),
    },
  },
};
// Owner picks: only known groups and options; a "one" group keeps one pick.
export function validIdeaPicks(input: unknown): IdeaPicks {
  const raw = z.record(z.string(), z.array(z.string())).parse(input);
  const picks: IdeaPicks = {};
  for (const g of IDEA_GROUPS) {
    const ids = [...new Set(raw[g.id] || [])];
    if (ids.some((id) => !g.options.some((o) => o.id === id)))
      throw new Error(`Неизвестный вариант в группе «${g.label}»`);
    if (g.mode === "one" && ids.length > 1)
      throw new Error(`В группе «${g.label}» выберите один вариант`);
    picks[g.id] = ids;
  }
  return picks;
}

export interface IdeaGame {
  universeId: string;
  placeId: string;
  name: string;
  playing: number;
  created: string | null;
  icon: string | null;
}
export interface IdeaCheck {
  checkedAt: string;
  queries: string[];
  found: number;
  totalPlaying: number;
  demand: number;
  crowding: number;
  newcomers: number;
  score: number | null;
  games: IdeaGame[];
  newcomer: IdeaGame | null;
  source: string;
}
export interface Idea {
  id: string;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
  words: IdeaWords;
  title: string;
  plan: IdeaPlan;
  picks: IdeaPicks;
  model?: string;
  effort?: string;
  check: IdeaCheck | null;
  checkError: string | null;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "your",
  "of",
  "and",
  "to",
  "in",
  "on",
  "game",
  "roblox",
]);
// Genre words and verbs say how a game plays, not what it is about.
const GENERIC_WORDS = new Set([
  ...IDEA_VERBS.map((v) => v.toLowerCase()),
  "make",
  "get",
  "go",
  "become",
  "play",
  "tycoon",
  "simulator",
  "obby",
  "rp",
  "roleplay",
  "story",
  "survival",
  "battle",
  "defense",
  "td",
]);
// A search hit counts as similar only when its name carries the query's
// subject ("zoo" for "zoo tycoon"), not a shared verb or a popular unrelated
// game.
export function similarName(name: string, query: string) {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const subject = words.filter((w) => !GENERIC_WORDS.has(w));
  const lower = name.toLowerCase();
  return (subject.length ? subject : words).some((w) =>
    new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, "")}`).test(lower),
  );
}
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const NEWCOMER_DAYS = 365;
// Score from live similar games:
// demand — players in the top 10 similar games (100 → 0, 1 000 000 → 100);
// crowding — share of those players held by the single biggest game;
// newcomers — the best similar game created within a year (10 → 0, 10 000 → 100).
export function scoreIdea(games: Array<Omit<IdeaGame, "icon">>, at: string) {
  const top = [...games].sort((a, b) => b.playing - a.playing).slice(0, 10);
  const totalPlaying = top.reduce((sum, g) => sum + g.playing, 0);
  const demand = clamp(((Math.log10(totalPlaying + 1) - 2) / 4) * 100);
  const crowding = totalPlaying
    ? clamp((100 * top[0].playing) / totalPlaying)
    : 0;
  const recent = games
    .filter(
      (g) =>
        g.created &&
        Date.parse(at) - Date.parse(g.created) < NEWCOMER_DAYS * 86_400_000,
    )
    .sort((a, b) => b.playing - a.playing)[0];
  const newcomers = recent
    ? clamp(((Math.log10(recent.playing + 1) - 1) / 3) * 100)
    : 0;
  return {
    totalPlaying,
    demand,
    crowding,
    newcomers,
    newcomerId: recent?.universeId || null,
    score: games.length
      ? clamp(0.5 * demand + 0.2 * (100 - crowding) + 0.3 * newcomers)
      : null,
  };
}

const optionLabel = (g: IdeaGroup, id: string) =>
  g.options.find((o) => o.id === id)?.label || id;
export function ideaGenre(idea: Idea) {
  const genres = idea.picks.genre?.length
    ? idea.picks.genre
    : idea.plan.recommendations.genre.picks;
  return genres.join(" + ").slice(0, 100);
}
// The project goal made from the idea: what the lead developer starts from.
export function ideaBrief(idea: Idea) {
  const lines = [
    `Идея из лаборатории идей: «${idea.title}».`,
    idea.plan.pitch,
    `Отличие: ${idea.plan.twist}`,
    `Чем зацепит ребёнка: ${idea.plan.hook}`,
    "",
    ...IDEA_STEPS.map((s, i) => {
      const parts = s.groups
        .map((g) => {
          const ids = idea.picks[g.id] || [];
          return ids.length
            ? `${g.label}: ${ids.map((id) => optionLabel(g, id)).join(", ")}`
            : "";
        })
        .filter(Boolean);
      return `${i + 1}. ${s.title} — ${parts.join("; ") || "на усмотрение разработчика"}`;
    }),
  ];
  const c = idea.check;
  if (c?.games.length)
    lines.push(
      "",
      `Похожие игры Roblox (поиск ${c.checkedAt.slice(0, 10)}): ` +
        c.games
          .map((g) => `${g.name.trim()} — ${g.playing} играют`)
          .join("; ") +
        ". Изучить приёмы, не копировать.",
      `Оценка идеи: ${c.score}/100 (спрос ${c.demand}, теснота ${c.crowding}, новички ${c.newcomers}).`,
    );
  return lines.join("\n").slice(0, 5000);
}

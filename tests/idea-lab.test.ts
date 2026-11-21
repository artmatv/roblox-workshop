import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { Engine } from "../server/engine.js";
import { developIdea } from "../server/idea-lab.js";
import {
  IDEA_ARTICLES,
  IDEA_GROUPS,
  IDEA_NOUNS,
  IDEA_VERBS,
  ideaBrief,
  ideaGenre,
  ideaPlanSchema,
  ideaTitle,
  scoreIdea,
  similarName,
  spinIdeaWords,
  validIdeaPicks,
  validIdeaWords,
} from "../shared/idea-lab.js";
import { effortModels } from "./effort-fixture.js";
import { mockNamingAI } from "./project-naming-fixture.js";

const plan = {
  pitch: "Ты директор зоопарка: строишь вольеры и встречаешь посетителей.",
  twist: "Звери сбегают, и их надо ловить всей командой.",
  hook: "Сразу выбрать первого зверя и построить ему вольер.",
  searchQueries: ["zoo tycoon", "build a zoo"],
  recommendations: Object.fromEntries(
    IDEA_GROUPS.map((g) => [
      g.id,
      { picks: [g.options[0].id], reason: "Так делают похожие игры." },
    ]),
  ),
};

test("spins only grammatical titles and keeps locked words", () => {
  let seed = 0;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  let words = spinIdeaWords(null, {}, random);
  for (let i = 0; i < 500; i++) {
    words = spinIdeaWords(words, {}, random);
    assert.ok(validIdeaWords(words), JSON.stringify(words));
    if (IDEA_NOUNS.find((n) => n.word === words.noun)?.plural)
      assert.ok(!["a", "every", "this", "one"].includes(words.article));
    else assert.ok(!["all the", "100"].includes(words.article));
  }
  const pluralOnly = spinIdeaWords(
    { verb: "Feed", article: "all the", noun: "Dinosaurs" },
    { article: true },
    random,
  );
  assert.equal(pluralOnly.article, "all the");
  assert.ok(IDEA_NOUNS.find((n) => n.word === pluralOnly.noun)?.plural);
  const locked = spinIdeaWords(
    { verb: "Dodge", article: "the", noun: "Rolling Barrels" },
    { verb: true, noun: true },
    random,
  );
  assert.equal(locked.verb, "Dodge");
  assert.equal(locked.noun, "Rolling Barrels");
  assert.equal(
    ideaTitle({ verb: "Run", article: "a", noun: "Zoo" }),
    "Run a Zoo",
  );
  assert.equal(
    ideaTitle({ verb: "Hatch", article: "a", noun: "Egg" }),
    "Hatch an Egg",
  );
  assert.equal(
    ideaTitle({ verb: "Tame", article: "my", noun: "Toy Store" }),
    "Tame My Toy Store",
  );
  assert.equal(
    ideaTitle({ verb: "Find", article: "a", noun: "Unicorn" }),
    "Find a Unicorn",
  );
  assert.equal(
    ideaTitle({ verb: "Feed", article: "all the", noun: "Dinosaurs" }),
    "Feed All the Dinosaurs",
  );
  assert.ok(!validIdeaWords({ verb: "Run", article: "a", noun: "Ghosts" }));
  assert.ok(!validIdeaWords({ verb: "Run", article: "100", noun: "Zoo" }));
  assert.ok(!validIdeaWords({ verb: "Ignore", article: "the", noun: "Zoo" }));
});

test("reels hold many distinct short words and do not repeat recent ones", () => {
  const nouns = IDEA_NOUNS.map((n) => n.word);
  assert.ok(IDEA_VERBS.length >= 120 && nouns.length >= 300);
  assert.ok(IDEA_ARTICLES.length >= 8);
  assert.equal(new Set(IDEA_VERBS).size, IDEA_VERBS.length);
  assert.equal(new Set(nouns).size, nouns.length);
  for (const word of [...IDEA_VERBS, ...nouns])
    assert.match(word, /^[A-Z][A-Za-z]{0,9}( [A-Z][A-Za-z]{0,9}){0,2}$/);
  let words = spinIdeaWords(null);
  const recent: string[] = [];
  for (let i = 0; i < 40; i++) {
    const next = spinIdeaWords(words, {}, Math.random, recent);
    assert.notEqual(next.verb, words.verb);
    assert.notEqual(next.noun, words.noun);
    assert.ok(!recent.includes(next.verb) && !recent.includes(next.noun));
    recent.push(next.verb, next.noun);
    words = next;
  }
});

test("similar games carry the query subject, not just popularity", () => {
  assert.ok(similarName("[🐯] Zoo Builder Tycoon", "zoo tycoon"));
  assert.ok(!similarName("Steal An Egg", "zoo tycoon"));
  assert.ok(!similarName("Restaurant Tycoon 3", "zoo tycoon"));
  assert.ok(similarName("Mega Fun Obby", "obby"));
  assert.ok(!similarName("Bazooka Wars", "zoo"));
  assert.ok(!similarName("Build A Racetrack", "build a temple Roblox"));
  assert.ok(similarName("Temple Run Tycoon", "build a temple Roblox"));
});

test("score rewards demand and newcomers, penalises one dominant game", () => {
  const at = "2026-11-21T00:00:00.000Z";
  const old = "2018-01-01T00:00:00.000Z";
  const crowded = scoreIdea(
    [
      {
        universeId: "1",
        placeId: "1",
        name: "A",
        playing: 99_000,
        created: old,
      },
      {
        universeId: "2",
        placeId: "2",
        name: "B",
        playing: 1_000,
        created: old,
      },
    ],
    at,
  );
  const open = scoreIdea(
    [
      {
        universeId: "1",
        placeId: "1",
        name: "A",
        playing: 50_000,
        created: old,
      },
      {
        universeId: "2",
        placeId: "2",
        name: "B",
        playing: 50_000,
        created: "2026-06-01T00:00:00.000Z",
      },
    ],
    at,
  );
  assert.equal(crowded.demand, open.demand);
  assert.equal(crowded.crowding, 99);
  assert.equal(crowded.newcomers, 0);
  assert.equal(open.crowding, 50);
  assert.equal(open.newcomers, 100);
  assert.equal(open.newcomerId, "2");
  assert.ok(open.score! > crowded.score!);
  assert.equal(scoreIdea([], at).score, null);
});

test("owner picks accept only known options and one pick where required", () => {
  const picks = validIdeaPicks({ loop: ["build"], screens: ["shop", "hud"] });
  assert.deepEqual(picks.loop, ["build"]);
  assert.deepEqual(picks.genre, []);
  assert.throws(() => validIdeaPicks({ loop: ["build", "race"] }));
  assert.throws(() => validIdeaPicks({ screens: ["casino"] }));
  assert.ok(ideaPlanSchema.safeParse(plan).success);
  assert.ok(
    !ideaPlanSchema.safeParse({
      ...plan,
      recommendations: {
        ...plan.recommendations,
        loop: { picks: ["x"], reason: "нет такого" },
      },
    }).success,
  );
});

test("develops an idea with one read-only medium turn and checks it against Roblox search", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "idea-lab-"));
  const store = new Store(root),
    codex = new Codex();
  const calls = mockNamingAI(codex, { response: plan });
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://apis.roblox.com/search-api/omni-search"))
      return json({
        searchResults: [
          {
            contents: [
              {
                contentType: "Game",
                universeId: 10,
                rootPlaceId: 100,
                name: "Zoo Builder Tycoon",
                playerCount: 1800,
              },
            ],
          },
          {
            contents: [
              {
                contentType: "Game",
                universeId: 11,
                rootPlaceId: 110,
                name: "Zoo Tycoon",
                playerCount: 900,
              },
            ],
          },
          {
            contents: [
              {
                contentType: "Game",
                universeId: 12,
                rootPlaceId: 120,
                name: "Steal An Egg",
                playerCount: 1_000_000,
              },
            ],
          },
        ],
      });
    if (url.startsWith("https://games.roblox.com/v1/games"))
      return json({
        data: [
          { id: 10, playing: 1791, created: "2026-07-06T01:40:47.542Z" },
          { id: 11, playing: 926, created: "2017-10-24T14:27:50.770Z" },
        ],
      });
    if (url.startsWith("https://thumbnails.roblox.com/"))
      return json({
        data: [
          {
            targetId: 10,
            imageUrl: "https://tr.rbxcdn.com/icon10/150/150/Image/Png",
          },
          { targetId: 11, imageUrl: "https://evil.example/icon.png" },
        ],
      });
    if (url.startsWith("https://tr.rbxcdn.com/"))
      return new Response(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    throw new Error("Unexpected fetch " + url);
  }) as typeof fetch;
  try {
    const idea = await developIdea({
      store,
      agent: codex,
      models: effortModels,
      words: { verb: "Run", article: "a", noun: "Zoo" },
    });
    assert.equal(idea.title, "Run a Zoo");
    assert.deepEqual(idea.picks.loop, [
      IDEA_GROUPS.find((g) => g.id === "loop")!.options[0].id,
    ]);
    const thread = calls.find((c) => c.method === "thread/start")!.params;
    assert.equal(thread.sandbox, "read-only");
    assert.equal(thread.ephemeral, true);
    const turn = calls.find((c) => c.method === "turn/start")!.params;
    assert.equal(turn.effort, "medium");
    assert.ok(turn.outputSchema.properties.recommendations);
    assert.match(turn.input[0].text, /"title":"Run a Zoo"/);
    assert.equal(idea.checkError, null);
    assert.equal(idea.check!.found, 2);
    assert.deepEqual(
      idea.check!.games.map((g) => g.name),
      ["Zoo Builder Tycoon", "Zoo Tycoon"],
    );
    assert.equal(idea.check!.newcomer!.universeId, "10");
    assert.equal(idea.check!.games[0].icon, "ideas/icons/10.png");
    assert.equal(idea.check!.games[1].icon, null);
    assert.ok(existsSync(resolve(root, "ideas/icons/10.png")));
    assert.ok(!urls.some((u) => u.includes("evil.example")));
    assert.equal(typeof idea.check!.score, "number");
    assert.deepEqual(store.get("idea", idea.id), idea);
    const brief = ideaBrief(idea);
    assert.match(brief, /Run a Zoo/);
    assert.match(brief, /Zoo Builder Tycoon — 1791 играют/);
    assert.ok(brief.length <= 5000);
    assert.equal(ideaGenre(idea), IDEA_GROUPS[0].options[0].id);
  } finally {
    globalThis.fetch = realFetch;
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed Roblox search keeps the developed idea with a visible reason", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "idea-lab-"));
  const store = new Store(root),
    codex = new Codex();
  mockNamingAI(codex, { response: plan });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("busy", { status: 503 })) as typeof fetch;
  try {
    const idea = await developIdea({
      store,
      agent: codex,
      models: effortModels,
      words: { verb: "Run", article: "a", noun: "Zoo" },
    });
    assert.equal(idea.check, null);
    assert.match(idea.checkError!, /HTTP 503/);
    assert.ok(store.get("idea", idea.id));
  } finally {
    globalThis.fetch = realFetch;
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the engine runs one idea at a time and needs a connected account", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "idea-lab-"));
  const store = new Store(root),
    codex = new Codex(),
    engine = new Engine(store, codex);
  try {
    await assert.rejects(
      engine.developIdea({ verb: "Run", article: "a", noun: "Zoo" }),
      /подключите аккаунт/,
    );
    mockNamingAI(codex, { noResponse: true });
    engine.account = { account: { type: "chatgpt", id: "test" } };
    engine.models = effortModels;
    const first = engine.developIdea({
      verb: "Run",
      article: "a",
      noun: "Zoo",
    });
    await assert.rejects(
      engine.developIdea({ verb: "Fix", article: "the", noun: "Rocket" }),
      /уже раскручивает/,
    );
    engine.ideaRequest!.controller.abort();
    await assert.rejects(first, /остановлен/);
    assert.equal(engine.ideaRequest, null);
  } finally {
    await engine.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

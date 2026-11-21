import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { manifestSchema } from "../shared/domain.js";
import {
  prepareGameLocalization,
  assertGameLocalizationReady,
  mergeLocaleEntries,
} from "../server/game-localization.js";
import { preparePreviewEnvironment } from "../server/preview-environment.js";
import { Engine } from "../server/engine.js";
import { Store, hash } from "../server/store.js";
import { Codex } from "../server/codex.js";
import { exportPlace } from "../server/export.js";
const ui = () =>
  manifestSchema.parse({
    summary: "English game UI",
    instances: [
      { path: "StarterGui/Main", className: "ScreenGui", properties: {} },
      {
        path: "StarterGui/Main/Title",
        className: "TextLabel",
        properties: { Text: 'Lunar Couriers: "Express"' },
      },
      {
        path: "StarterGui/Main/Search",
        className: "TextBox",
        properties: { Text: "Имя игрока", PlaceholderText: "Search inventory" },
      },
    ],
    data: {
      localization: {
        entries: [
          {
            key: "hud.parcels",
            source: "Parcels: {count:int} / {total:int}",
            context: "Delivery progress",
            example: "Parcels: 1 / 3",
          },
        ],
      },
    },
  });

test("English source catalogue, Roblox runtime and CSV are injected once and exported with AutoLocalize", () => {
  const m = ui();
  prepareGameLocalization(m);
  preparePreviewEnvironment(m);
  assert.equal((m.data.localization as any).sourceLocaleId, "en-us");
  assert.equal((m.data.localization as any).entries.length, 3);
  assert.ok(
    m.instances.find((i) => i.path.endsWith("/Title"))!.properties.AutoLocalize,
  );
  const csv = m.files.find((f) => f.path.endsWith("en-us.csv"))!.content;
  assert.match(csv, /"Lunar Couriers: ""Express"""/);
  assert.doesNotMatch(csv, /Имя игрока/);
  assert.match(csv, /StarterGui\.Main\.Title/);
  assert.doesNotMatch(csv, /StarterGui\/Main\/Title\.Text/);
  assert.match(exportPlace(m), /<bool name="AutoLocalize">true<\/bool>/);
  assertGameLocalizationReady(m);
  const original = hash(m);
  assert.equal(prepareGameLocalization(m), false);
  assert.equal(hash(m), original);
  assert.equal(
    m.instances.filter((i) => i.path === "ReplicatedStorage/AutomationI18n")
      .length,
    1,
  );
});

test("non-English authored UI, source-locale overrides and invalid parameter keys fail before application", () => {
  const m = ui();
  m.instances[1].properties.Text = "Доставить посылку";
  assert.throws(() => prepareGameLocalization(m), /английским/);
  const wrongLocale = ui();
  (wrongLocale.data.localization as any).sourceLocaleId = "ru-ru";
  assert.throws(() => prepareGameLocalization(wrongLocale));
  const numeric = ui();
  (numeric.data.localization as any).entries[0].source = "Parcels: {1:int}";
  assert.throws(() => prepareGameLocalization(numeric), /именованные/);
  const disabled = ui();
  disabled.instances[0].properties.AutoLocalize = false;
  assert.throws(() => prepareGameLocalization(disabled), /AutoLocalize/);
  const duplicate = ui();
  (duplicate.data.localization as any).entries.push({
    ...(duplicate.data.localization as any).entries[0],
    key: "duplicate.key",
  });
  assert.throws(() => prepareGameLocalization(duplicate), /Source\+Context/);
});

test("an authored entry for a label's own Source+Context replaces the automatic key", () => {
  const m = ui();
  (m.data.localization as any).entries.push({
    key: "static.title",
    source: 'Lunar Couriers: "Express"',
    context: "StarterGui.Main.Title",
    example: "",
  });
  prepareGameLocalization(m);
  const keys = (m.data.localization as any).entries.map((e: any) => e.key);
  assert.ok(keys.includes("static.title"));
  assert.equal(keys.filter((k: string) => k.startsWith("ui.")).length, 1);
  assertGameLocalizationReady(m);
});

test("production merges role catalogues, detects conflicting keys and retains untouched prior strings", () => {
  const a = ui(),
    b = manifestSchema.parse({
      summary: "Gameplay messages",
      data: {
        localization: {
          entries: [{ key: "round.win", source: "All beacons are lit!" }],
        },
      },
    });
  const merged = mergeLocaleEntries([a, b]);
  assert.equal(merged.entries.length, 2);
  const c = ui();
  (c.data.localization as any).entries[0].source = "Delivered: {count:int}";
  assert.throws(() => mergeLocaleEntries([a, c]), /Конфликт/);
  assert.equal(mergeLocaleEntries([b], a).entries.length, 2);
});

test("all new and existing projects require localization; QA automatically receives the UI skills", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-languages-")),
    store = new Store(root),
    engine = new Engine(store, new Codex());
  try {
    const p = engine.createProject({
      name: "Language fixture",
      genre: "Obby",
      goal: "English by default",
    });
    assert.ok(p.requiredChecks.includes("localization"));
    p.requiredChecks = p.requiredChecks.filter((c) => c !== "localization");
    store.put("project", p);
    new Engine(store, new Codex());
    assert.ok(engine.project(p.id).requiredChecks.includes("localization"));
    p.studioId = "fixture";
    store.put("studio", {
      id: "fixture",
      capabilities: ["apply", "test", "capture"],
    });
    const qa = engine.task(p, {
      title: "Native QA",
      role: "qa",
      kind: "qa",
      instructions: "Check UI translations",
    });
    assert.match(engine.skillContext(p, qa), /SKILL roblox-ui@/);
    assert.match(engine.skillContext(p, qa), /SKILL game-ui-ux@/);
    assert.throws(
      () => assertGameLocalizationReady(ui()),
      /английский каталог/,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

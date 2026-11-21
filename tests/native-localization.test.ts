import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyNativeLocalizationUnderLease,
  assertNativeLocalizationUnchanged,
  generatedEmptyNativeCatalogSource,
  nativeLocalizationArtifactFromJournal,
  nativeLocalizationAccessAllowed,
  nativeLocalizationInstallerCode,
  prepareNativeLocalization,
  verifyNativeLocalizationSnapshot,
} from "../server/native-localization.js";

const input = {
  sourceLocaleId: "en-us",
  entries: [{ key: "hud.coins", source: "Coins: {count:int}", context: "HUD balance", example: "Coins: 12" }],
};

test("native catalog reuses the official generator and fixes installation to its three reserved objects", () => {
  const artifact = prepareNativeLocalization(input);
  assert.equal(artifact.data.sourceLocaleId, "en-us");
  assert.equal(artifact.entries[0]?.source, "Coins: {count:int}");
  assert.deepEqual(Object.keys(artifact.sources), [
    "ReplicatedStorage/AutomationLocaleCatalog",
    "ReplicatedStorage/AutomationI18n",
    "StarterPlayer/StarterPlayerScripts/AutomationLocalization",
  ]);
  assert.ok(artifact.files.some((file) => file.path === "localization/en-us.csv" && file.content.includes("hud.coins")));
  const code = nativeLocalizationInstallerCode(artifact);
  assert.match(code, /AutomationLocaleCatalog/);
  assert.match(code, /AutomationI18n/);
  assert.match(code, /AutomationLocalization/);
  assert.match(code, /unexpected class/);
  assert.match(code, /Duplicate reserved localization objects/);
  assert.match(code, /not an official generated catalog/);
  assert.ok(code.indexOf("local objects={}") < code.indexOf("for _,item in ipairs(objects) do"), "all exact targets are preflighted before the first write");
  assert.doesNotMatch(code, /existing\.Source~=target\.source/ , "a recognized older official catalog can be updated");
  assert.doesNotMatch(code, /loadstring|HttpService|RequestAsync/);
  assert.throws(() => prepareNativeLocalization({ ...input, entries: [{ key: "bad", source: "Coins {1:int}" }] }), /именованные параметры/);
  assert.throws(() => prepareNativeLocalization({ ...input, sourceLocaleId: "ru-ru" }));
});

test("host protocol marker prevents a fresh MCP from using a stale host and accepts canonical empty prior catalogs", () => {
  assert.equal(nativeLocalizationAccessAllowed(undefined, true), false);
  assert.equal(nativeLocalizationAccessAllowed("0", true), false);
  assert.equal(nativeLocalizationAccessAllowed("1", false), false);
  assert.equal(nativeLocalizationAccessAllowed("1", true), true);
  const emptyCatalog = generatedEmptyNativeCatalogSource();
  assert.equal(emptyCatalog, 'return {sourceLocaleId="en-us",entries={\n\n}}\n');
});

test("unlogged catalog changes block checkpoint while unchanged legacy snapshots remain valid", () => {
  const previous = [{ path: "ReplicatedStorage/AutomationLocaleCatalog", className: "ModuleScript", source: "old official catalog" }];
  assert.doesNotThrow(() => assertNativeLocalizationUnchanged(previous, previous));
  assert.doesNotThrow(() => assertNativeLocalizationUnchanged([], []));
  assert.throws(() => assertNativeLocalizationUnchanged(previous, []), /prepare_localization/);
  assert.throws(() => assertNativeLocalizationUnchanged(previous, [{ ...previous[0]!, source: "changed" }]), /prepare_localization/);
  assert.throws(() => assertNativeLocalizationUnchanged(previous, [previous[0]!, previous[0]!]), /повторные/);
});

test("native localization refuses stale ownership, another Studio, and Play before applying", async () => {
  const artifact = prepareNativeLocalization(input);
  for (const blocker of [
    { lease: () => { throw new Error("stale"); }, identity: async () => {}, mode: "Edit" },
    { lease: () => {}, identity: async () => { throw new Error("wrong Studio"); }, mode: "Edit" },
    { lease: () => {}, identity: async () => {}, mode: "Current Studio Mode: Play" },
  ]) {
    let writes = 0;
    await assert.rejects(applyNativeLocalizationUnderLease(artifact, {
      lease: blocker.lease,
      identity: blocker.identity,
      studioState: async () => blocker.mode,
      apply: async () => { writes++; },
    }));
    assert.equal(writes, 0);
  }
});

test("only a successful task and attempt journal artifact can be restored from the Studio snapshot", () => {
  const artifact = prepareNativeLocalization(input);
  const record = {
    tool: "prepare_localization", success: true, taskId: "task", attempt: 4,
    generatedLocalization: artifact.data, generatedFiles: artifact.files,
    generatedSourceHashes: artifact.sourceHashes, artifactHash: artifact.artifactHash,
  };
  assert.equal(nativeLocalizationArtifactFromJournal([{ ...record, attempt: 3 }], "task", 4), undefined);
  const restored = nativeLocalizationArtifactFromJournal([record], "task", 4)!;
  assert.deepEqual(verifyNativeLocalizationSnapshot(restored, Object.entries(artifact.sources).map(([path, value]) => ({ path, ...value }))).data, artifact.data);
  assert.throws(() => verifyNativeLocalizationSnapshot(restored, []), /Снимок Studio/);
});

test("missing reserved objects are created through the script tool before the installer runs", async () => {
  const artifact = prepareNativeLocalization(input);
  const created: string[] = [];
  let applied = "";
  await applyNativeLocalizationUnderLease(artifact, {
    lease: () => {},
    identity: async () => {},
    studioState: async () => "Edit",
    probe: async () => ({ missing: "ReplicatedStorage/AutomationI18n" }),
    create: async (path, className, source) => {
      assert.equal(className, artifact.sources[path]!.className);
      assert.equal(source, artifact.sources[path]!.source);
      created.push(path);
    },
    apply: async (code) => {
      applied = code;
    },
  });
  assert.deepEqual(created, ["ReplicatedStorage/AutomationI18n"]);
  assert.match(applied, /local fresh=\{\["ReplicatedStorage\/AutomationI18n"\]=true\}/);
  await assert.rejects(
    applyNativeLocalizationUnderLease(artifact, {
      lease: () => {},
      identity: async () => {},
      studioState: async () => "Edit",
      probe: async () => ({ missing: "Workspace/Evil" }),
      create: async () => {},
      apply: async () => {},
    }),
    /неожиданный путь/,
  );
});

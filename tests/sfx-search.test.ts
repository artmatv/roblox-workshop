import test from "node:test";
import assert from "node:assert/strict";
import { searchSfx } from "../server/sfx-search.js";
import { createHash } from "node:crypto";
import { authorizeSfxSkill } from "../server/sfx-search.js";

test("uses fixed Roblox URLs, limits candidates, and returns metadata only", async () => {
  const calls: Array<{ url: URL; init: any }> = [];
  const fetcher: typeof fetch = async (input: any, init: any) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/marketplace/3"))
      return Response.json({
        data: [
          { id: 12345, duration: 2 },
          { id: 67890, duration: 4 },
          { id: 22222, duration: 8 },
        ],
      });
    return Response.json({
      data: [
        {
          asset: {
            id: 12345,
            name: "Button click",
            typeId: 3,
            duration: 0,
            audioDetails: { audioType: "SoundEffect" },
          },
          creator: { name: "Creator A" },
          fiatProduct: { isFree: true },
        },
        {
          asset: {
            id: 67890,
            name: "Theme",
            typeId: 3,
            audioDetails: { audioType: "Music" },
          },
          creator: { name: "Creator B" },
          fiatProduct: { isFree: false },
        },
        {
          asset: {
            id: 22222,
            name: "Wind",
            typeId: 3,
            audioDetails: { audioType: "SoundEffect" },
          },
          creator: { name: "Creator C" },
        },
      ],
    });
  };
  const result = await searchSfx({ query: "button click", limit: 2 }, fetcher);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url.origin, "https://apis.roblox.com");
  assert.equal(calls[0]!.url.pathname, "/toolbox-service/v1/marketplace/3");
  assert.equal(calls[0]!.url.searchParams.get("keyword"), "button click");
  assert.equal(calls[0]!.url.searchParams.get("limit"), "2");
  assert.equal(calls[1]!.url.pathname, "/toolbox-service/v1/items/details");
  assert.equal(calls[1]!.url.searchParams.get("assetIds"), "12345,67890");
  assert.equal(calls[0]!.init.redirect, "error");
  assert.deepEqual(result.candidates, [
    {
      id: "12345",
      name: "Button click",
      creator: "Creator A",
      audioType: "SoundEffect",
      duration: null,
      listed_duration: 2,
      source: "https://create.roblox.com/store/asset/12345",
    },
  ]);
  assert.equal(JSON.stringify(result).includes("playable"), false);
});

test("rejects invalid inputs, status errors, redirects, wrong JSON, and times out", async () => {
  await assert.rejects(searchSfx({ query: "", limit: 2 }, fetch), /Too small/);
  await assert.rejects(
    searchSfx({ query: "wind", limit: 21 }, fetch),
    /Too big/,
  );
  await assert.rejects(
    searchSfx(
      { query: "wind", limit: 1 },
      async () => new Response("unavailable", { status: 503 }),
    ),
    /503/,
  );
  await assert.rejects(
    searchSfx(
      { query: "wind", limit: 1 },
      async () => new Response("not json"),
    ),
    /JSON/,
  );
  let redirectMode = "";
  await assert.rejects(
    searchSfx({ query: "wind", limit: 1 }, async (_url: any, init: any) => {
      redirectMode = init.redirect;
      throw new TypeError("redirect blocked");
    }),
    /redirect blocked/,
  );
  assert.equal(redirectMode, "error");
  const slow: typeof fetch = (_url: any, init: any) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      }),
    );
  await assert.rejects(
    searchSfx({ query: "wind", limit: 1 }, slow, 5),
    /Timeout|timed out/i,
  );
});

test("rejects untrusted IDs and malformed details without constructing external URLs", async () => {
  let callCount = 0;
  const result = await searchSfx({ query: "rain", limit: 3 }, async () => {
    callCount++;
    return Response.json({ data: [{ id: "https://evil.test/x" }, { id: 0 }] });
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(callCount, 1);
  let count = 0;
  await assert.rejects(
    searchSfx({ query: "rain", limit: 1 }, async () =>
      ++count === 1
        ? Response.json({ data: [{ id: 123 }] })
        : Response.json({ wrong: [] }),
    ),
    /unexpected response/,
  );
});

test("authorizes only the exact enabled, reviewed pinned SFX package", () => {
  const instructions = "verified adapted SFX instructions";
  const hash = createHash("sha256").update(instructions).digest("hex");
  const task = { skills: [{ id: "sypho-roblox-sfx", hash }] };
  const project = { skillPins: { "sypho-roblox-sfx": hash } };
  const current = {
    id: "sypho-roblox-sfx",
    hash,
    status: "reviewed",
    checkedAt: "2026-11-04",
    instructions,
  };
  const pkg = {
    skillId: "sypho-roblox-sfx",
    skillHash: hash,
    packageHash: "b".repeat(64),
    files: [{ path: "resources/scripts/search.py", hash: "a".repeat(64) }],
  };
  assert.equal(
    authorizeSfxSkill(task, project, current, null, pkg, hash),
    hash,
  );
  assert.throws(
    () =>
      authorizeSfxSkill(
        task,
        project,
        { ...current, status: "disabled" },
        current,
        pkg,
        hash,
      ),
    /отключён/,
  );
  assert.throws(
    () => authorizeSfxSkill(task, { skillPins: {} }, current, null, pkg, hash),
    /не закрепила/,
  );
  assert.throws(
    () => authorizeSfxSkill(task, project, current, null, null, hash),
    /пакета ресурсов/,
  );
});

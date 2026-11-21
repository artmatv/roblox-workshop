import test from "node:test";
import assert from "node:assert/strict";
import {
  createValidationStudio,
  validationStudioToolDefinitions,
} from "../server/validation-studio.js";

function mock(options: { state?: string; pause?: boolean } = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  let gate: (() => void) | undefined;
  let resolveGate: (() => void) | undefined;
  if (options.pause)
    gate = () =>
      new Promise<void>((r) => {
        resolveGate = r;
      });
  let leased = 0;
  const helper = createValidationStudio({
    studioId: "studio",
    taskId: "12345678-abcd",
    attempt: 2,
    lease: () => {
      leased++;
      if (options.pause && leased >= 3) throw new Error("paused");
    },
    identity: async () => ({ documentId: "doc" }),
    getCandidateIds: () => ["41", "42"],
    tool: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_studio_state")
        return {
          content: [
            {
              type: "text",
              text:
                options.state ??
                "Current Studio Mode: Edit\nAvailable DataModels: Edit",
            },
          ],
        };
      const code = args.code as string;
      if (code.includes("ComputeBufferHash"))
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                algorithm: "sha256",
                digest: "a".repeat(64),
                count: 1,
              }),
            },
          ],
        };
      if (code.includes("TimeLength"))
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                "1": { id: 41, loaded: true, length: 8 },
                "2": { id: 42, loaded: false, length: 0 },
              }),
            },
          ],
        };
      if (code.includes("remaining"))
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ removed: true, remaining: false }),
            },
          ],
        };
      if (code.includes("GetDeviceAsync"))
        return {
          content: [
            { type: "text", text: JSON.stringify({ device: "default" }) },
          ],
        };
      return { content: [{ type: "text", text: "created" }] };
    },
  });
  return { helper, calls, resolveGate };
}

test("exports strict fixed schemas only", () => {
  assert.deepEqual(
    validationStudioToolDefinitions.map((t) => t.name),
    ["probe_sfx", "validation_control"],
  );
  assert.equal(
    validationStudioToolDefinitions.every(
      (t) => t.inputSchema.additionalProperties === false,
    ),
    true,
  );
});

test("parses real Available DataModels line including Server and Client", async () => {
  const { helper, calls } = mock({
    state: "Current Studio Mode: Play\nAvailable DataModels: Server, Client",
  });
  await helper.probeSfx({ action: "create", ids: [41] });
  assert.equal(
    calls.find((c) => c.name === "execute_luau")?.args.datamodel_type,
    "Server",
  );
});

test("unknown candidate ID rejects without executing Studio code", async () => {
  const { helper, calls } = mock();
  await assert.rejects(
    helper.probeSfx({ action: "create", ids: [999] }),
    /Unknown candidate/,
  );
  assert.equal(calls.length, 0);
});

test("Play datamodel is required and fixed create/measure/play/owned cleanup work", async () => {
  const { helper, calls } = mock({
    state: "Current Studio Mode: Edit\nAvailable DataModels: Edit",
  });
  await assert.rejects(
    helper.probeSfx({ action: "create", ids: [41] }),
    /confirmed Play/,
  );
  assert.equal(
    calls.some((c) => c.name === "execute_luau"),
    false,
  );
  const good = mock({
    state: "Current Studio Mode: Play\nAvailable DataModels: Server, Client",
  });
  const made = await good.helper.probeSfx({ action: "create", ids: [41, 42] });
  assert.deepEqual(made.createdIds, [41, 42]);
  assert.match(
    good.calls.find((c) => c.name === "execute_luau")!.args.code,
    /SoundId="rbxassetid:\/\/41"/,
  );
  const measured = await good.helper.probeSfx({ action: "measure" });
  assert.deepEqual(measured.measurements, [
    { id: 41, loaded: true, length: 8 },
    { id: 42, loaded: false, length: 0 },
  ]);
  await good.helper.probeSfx({ action: "play" });
  const clean = await good.helper.probeSfx({ action: "cleanup" });
  assert.equal(clean.removed, true);
  assert.deepEqual(clean.remaining, []);
  assert.match(
    good.calls.filter((c) => c.name === "execute_luau").at(-1)!.args.code,
    /remaining=remain~=nil/,
  );
  assert.match(
    good.calls.filter((c) => c.name === "execute_luau").at(-1)!.args.code,
    /GetAttribute\("TaskId"\)/,
  );
});

test("cleanup requires explicit boolean absence, avoiding empty-table ambiguity", async () => {
  let bad = true;
  const helper = createValidationStudio({
    studioId: "s",
    taskId: "12345678",
    attempt: 1,
    lease() {},
    identity: async () => ({}),
    getCandidateIds: () => ["9"],
    tool: async (name, args) => {
      if (name === "get_studio_state")
        return {
          content: [
            {
              type: "text",
              text: "Current Studio Mode: Play\nAvailable DataModels: Server",
            },
          ],
        };
      if (args.code.includes("remaining=remain"))
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                bad
                  ? { removed: true, remaining: {} }
                  : { removed: true, remaining: false },
              ),
            },
          ],
        };
      return { content: [{ type: "text", text: "created" }] };
    },
  });
  await helper.probeSfx({ action: "create", ids: [9] });
  await assert.rejects(
    helper.probeSfx({ action: "cleanup" }),
    /invalid cleanup confirmation/,
  );
  bad = false;
  assert.deepEqual(
    (await helper.probeSfx({ action: "cleanup" })).remaining,
    [],
  );
});

test("rejects arbitrary code, source and path fields", async () => {
  const { helper, calls } = mock();
  await assert.rejects(
    helper.probeSfx({ action: "measure", code: "print(1)" }),
  );
  await assert.rejects(
    helper.validationControl({ action: "before", path: "Workspace" }),
  );
  await assert.rejects(
    helper.validationControl({ action: "after", source: "x" }),
  );
  assert.equal(calls.length, 0);
});

test("before/after use measured host fingerprint and detect mismatch", async () => {
  const { helper } = mock();
  const before = await helper.validationControl({ action: "before" });
  const after = await helper.validationControl({ action: "after" });
  assert.equal(before.fingerprint, after.fingerprint);
  assert.equal(after.scenePreserved, true);
  let changed = false;
  const mismatch = createValidationStudio({
    studioId: "s",
    taskId: "87654321",
    attempt: 1,
    lease() {},
    identity: async () => ({}),
    getCandidateIds: () => [],
    tool: async (name) =>
      name === "get_studio_state"
        ? {
            content: [
              {
                type: "text",
                text: "Current Studio Mode: Edit\nAvailable DataModels: Edit",
              },
            ],
          }
        : {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  algorithm: "sha256",
                  digest: changed ? "c".repeat(64) : "d".repeat(64),
                  count: 1,
                }),
              },
            ],
          },
  });
  await mismatch.validationControl({ action: "before" });
  changed = true;
  assert.equal(
    (await mismatch.validationControl({ action: "after" })).scenePreserved,
    false,
  );
});

test("default simulator control does not edit authored objects", async () => {
  const { helper, calls } = mock();
  const result = await helper.validationControl({ action: "default" });
  assert.equal(result.device, "default");
  const code = calls.find((c) => c.name === "execute_luau")!.args.code;
  assert.match(code, /StopSimulationAsync/);
  assert.doesNotMatch(code, /StarterGui|ScreenOrientation|\.Parent\s*=/);
});

test("fingerprint query uses valid Lua roots and excludes camera/runtime geometry", async () => {
  const { helper, calls } = mock();
  await helper.validationControl({ action: "before" });
  const code = calls.find((c) => c.name === "execute_luau")!.args.code;
  assert.match(code, /local roots=\{"Workspace","ReplicatedStorage"/);
  assert.match(code, /for _,n in ipairs\(roots\) do/);
  assert.doesNotMatch(code, /CurrentCamera|AbsolutePosition|AbsoluteSize/);
  assert.match(code, /if not v:IsA\("Camera"\) then/);
  assert.match(code, /table\.sort\(rows\)/);
  assert.match(code, /ComputeBufferHash/);
  assert.match(code, /table\.concat\(rows,string\.char\(10\)\)/);
  assert.match(
    code,
    /return \{algorithm="sha256",digest=table\.concat\(hex\),count=#rows\}/,
  );
});

test("fingerprint hashes sorted canonical rows in Studio and returns a compact digest", async () => {
  let flipped = false;
  const helper = createValidationStudio({
    studioId: "s",
    taskId: "12345678",
    attempt: 1,
    lease() {},
    identity: async () => ({}),
    getCandidateIds: () => [],
    tool: async (name) =>
      name === "get_studio_state"
        ? {
            content: [
              {
                type: "text",
                text: "Current Studio Mode: Edit\nAvailable DataModels: Edit",
              },
            ],
          }
        : {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  algorithm: "sha256",
                  digest: "b".repeat(64),
                  count: 20000,
                }),
              },
            ],
          },
  });
  const before = await helper.validationControl({ action: "before" });
  flipped = true;
  const after = await helper.validationControl({ action: "after" });
  assert.equal(after.fingerprint, before.fingerprint);
  assert.equal(after.scenePreserved, true);
  const code = await mock().helper.validationControl({ action: "before" });
  assert.equal(code.count, 1);
  assert.equal(code.fingerprint.length, 64);
});

test("mobile uses the traced simulator device APIs", async () => {
  const { helper, calls } = mock();
  await helper.validationControl({ action: "mobile" });
  const code = calls.find((c) => c.name === "execute_luau")!.args.code;
  assert.match(code, /SetDeviceAsync/);
  assert.match(
    code,
    /SetOrientationAsync\(Enum\.ScreenOrientation\.LandscapeLeft\)/,
  );
  assert.doesNotMatch(code, /StartSimulationAsync/);
});

test("revalidates lease after awaited Studio identity and discards paused attempt", async () => {
  let leases = 0;
  const calls: string[] = [];
  const helper = createValidationStudio({
    studioId: "s",
    taskId: "12345678",
    attempt: 1,
    lease: () => {
      if (++leases === 3) throw new Error("paused");
    },
    identity: async () => ({}),
    getCandidateIds: () => ["7"],
    tool: async (name) => {
      calls.push(name);
      return {
        content: [
          {
            type: "text",
            text: "Current Studio Mode: Play\nAvailable DataModels: Server",
          },
        ],
      };
    },
  });
  await assert.rejects(
    helper.probeSfx({ action: "create", ids: [7] }),
    /paused/,
  );
  assert.equal(calls.includes("execute_luau"), false);
});

test("cleanup requires host-owned probe ledger", async () => {
  const { helper, calls } = mock();
  await assert.rejects(helper.probeSfx({ action: "cleanup" }), /host-created/);
  assert.equal(calls.length, 0);
});

test("measurement normalization rejects gaps and nonnumeric keys", async () => {
  for (const malformed of [
    { "1": { id: 41, loaded: true, length: 8 }, "3": { id: 42, loaded: true, length: 8 } },
    { first: { id: 41, loaded: true, length: 8 } },
  ]) {
    const helper = createValidationStudio({
      studioId: "s", taskId: "12345678", attempt: 1,
      lease() {}, identity: async () => ({}), getCandidateIds: () => ["41", "42"],
      tool: async (name, args) => {
        if (name === "get_studio_state") return { content: [{ type: "text", text: "Current Studio Mode: Play\nAvailable DataModels: Server" }] };
        if (args.code.includes("TimeLength")) return { content: [{ type: "text", text: JSON.stringify(malformed) }] };
        return { content: [{ type: "text", text: "created" }] };
      },
    });
    await helper.probeSfx({ action: "create", ids: [41, 42] });
    await assert.rejects(helper.probeSfx({ action: "measure" }), /measurement/);
  }
});

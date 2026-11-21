import { Codex, normalizeLimits } from "../server/codex.js";
const client = new Codex();
try {
  const a = await client.account();
  const limits = await client.limits();
  const models = await client.models();
  console.log(
    JSON.stringify(
      {
        version: client.version,
        connected: client.ready,
        accountType: a.account?.type || null,
        needsAuth: a.requiresOpenaiAuth,
        quotaWindows: normalizeLimits(limits).length,
        models: models.data?.length || 0,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  client.close();
}

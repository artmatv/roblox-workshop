import { z } from "zod";
import { createHash } from "node:crypto";

export const searchSfxInput = z
  .object({
    query: z.string().trim().min(1).max(120),
    limit: z.number().int().min(1).max(20),
  })
  .strict();
const BASE = "https://apis.roblox.com/toolbox-service/v1";
type FetchLike = typeof fetch;

export function authorizeSfxSkill(
  task: any,
  project: any,
  current: any,
  archived: any,
  pkg: any,
  expectedHash: string,
) {
  if (
    !task?.skills?.some(
      (pin: any) => pin.id === "sypho-roblox-sfx" && pin.hash === expectedHash,
    ) ||
    project?.skillPins?.["sypho-roblox-sfx"] !== expectedHash
  )
    throw new Error("Задача не закрепила проверенный SFX навык");
  if (current?.status === "disabled")
    throw new Error("Закреплённый SFX навык отключён");
  const skill = current?.hash === expectedHash ? current : archived;
  if (
    !skill ||
    skill.hash !== expectedHash ||
    !["connected", "reviewed"].includes(skill.status) ||
    !skill.checkedAt ||
    createHash("sha256").update(skill.instructions).digest("hex") !==
      expectedHash
  )
    throw new Error("Закреплённый SFX навык недоступен или повреждён");
  if (
    !pkg ||
    pkg.skillId !== "sypho-roblox-sfx" ||
    pkg.skillHash !== expectedHash ||
    !/^[a-f0-9]{64}$/.test(pkg.packageHash || "") ||
    !Array.isArray(pkg.files) ||
    !pkg.files.length
  )
    throw new Error(
      "У закреплённого SFX навыка нет проверенного пакета ресурсов",
    );
  return expectedHash;
}

async function readLimited(response: Response) {
  if (response.redirected)
    throw new Error("Roblox SFX search returned a redirect");
  const length = Number(response.headers.get("content-length") || "0");
  if (length > 1_000_000)
    throw new Error("Roblox SFX search response is too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Roblox SFX search response has no body");
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_000_000) {
        await reader.cancel();
        throw new Error("Roblox SFX search response is too large");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

async function getJson(url: URL, fetcher: FetchLike, signal: AbortSignal) {
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 429)
    throw new Error("Roblox SFX search rate limited (429)");
  if (!response.ok)
    throw new Error(`Roblox SFX search failed (${response.status})`);
  return readLimited(response);
}

function arrayField(value: any): any[] {
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.results)) return value.results;
  throw new Error("Roblox SFX search returned an unexpected response");
}
function creatorName(value: any) {
  return typeof value === "string"
    ? value
    : typeof value?.name === "string"
      ? value.name
      : "Unknown";
}
export async function searchSfx(
  args: unknown,
  fetcher: FetchLike = fetch,
  timeoutMs = 15000,
) {
  const input = searchSfxInput.parse(args);
  const signal = AbortSignal.timeout(Math.min(15000, timeoutMs));
  const listingUrl = new URL(`${BASE}/marketplace/3`);
  listingUrl.searchParams.set("keyword", input.query);
  listingUrl.searchParams.set("category", "Audio");
  listingUrl.searchParams.set("limit", String(input.limit));
  const listing = await getJson(listingUrl, fetcher, signal);
  const candidates = arrayField(listing)
    .slice(0, input.limit)
    .map((item: any) => ({
      id: item?.id ?? item?.assetId,
      listed_duration: item?.duration ?? item?.durationSeconds ?? null,
    }));
  const ids = [
    ...new Set(
      candidates
        .map((x) => String(x.id))
        .filter((id) => /^[1-9]\d{0,19}$/.test(id)),
    ),
  ].slice(0, input.limit);
  if (!ids.length) return { candidates: [] };
  const detailsUrl = new URL(`${BASE}/items/details`);
  detailsUrl.searchParams.set("assetIds", ids.join(","));
  const details = arrayField(await getJson(detailsUrl, fetcher, signal));
  const byId = new Map<string, any>();
  for (const item of details) {
    const id = item?.id ?? item?.assetId ?? item?.asset?.id;
    if (
      (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
      (typeof id === "string" && /^\d{1,20}$/.test(id))
    )
      byId.set(String(id), item);
  }
  const listed = new Map(
    candidates.map((x) => [String(x.id), x.listed_duration]),
  );
  return {
    candidates: ids.flatMap((id) => {
      const item = byId.get(id);
      if (!item) return [];
      const asset = item.asset || item;
      const creator = item.creator || asset.creator;
      if (asset.typeId !== 3 || item.fiatProduct?.isFree === false) return [];
      const details = asset.audioDetails || {};
      const type =
        details.audioType ?? asset.audioType ?? item.audioType ?? null;
      return [
        {
          id,
          name:
            typeof asset.name === "string"
              ? asset.name.slice(0, 240)
              : "Unknown",
          creator: creatorName(creator),
          audioType: type,
          duration:
            details.durationSeconds ??
            details.duration ??
            asset.durationSeconds ??
            null,
          listed_duration: listed.get(id) ?? asset.duration ?? null,
          source: `https://create.roblox.com/store/asset/${id}`,
        },
      ];
    }),
  };
}

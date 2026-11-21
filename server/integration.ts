import { z } from "zod";
import { manifestSchema, type Manifest, type Task } from "../shared/domain.js";
import { hash } from "./store.js";
import { mergeLocaleEntries } from "./game-localization.js";
export interface IntegrationConflict {
  kind: "instance" | "file" | "localization";
  path: string;
  variants: Array<{ taskId: string; value: unknown }>;
}
export interface IntegrationBase {
  id: string;
  taskId: string;
  projectId: string;
  revision: number;
  hash: string;
  dependencyHashes: Array<{ id: string; hash: string }>;
  manifest: Manifest;
  conflicts: IntegrationConflict[];
}
export const INTEGRATION_PATCH_INSTRUCTIONS = `Для integration сервис уже собрал integrationBase из принятых частей. Нельзя переписывать всю игру или возвращать программу для будущего слияния.
Верни только изменённые полные instances (включая все properties/source изменённого объекта), изменённые files и явные deletions. Обязательно data.integrationPatch={baseId:integrationBaseIdentity.id,baseHash:integrationBaseIdentity.hash}. Не включай неизменённые объекты. Новые ключи локализации можно добавить через data.localization; остальные ключи, ресурсы, контракты, документы и тесты сохранит сервис.
Сервис материализует полный кандидат до структурной проверки и проверки оркестратором. Не создавай integration/merge.luau, build_manifest.py или другой будущий сборщик. Исправляй конкретные замечания в исполняемых source, сохраняя UI, стиль, мир, тесты и протокол. Все явные integrationConflicts должны быть разрешены заменой соответствующего объекта/файла/ключа.
При проверке сохранённого исправления материализуется тот же patch; готовая игра не считается проверенной до реального QA. Независимый серверный QA-стенд создаёт последующая задача qa.`;

export function assembleIntegration(
  sources: Array<Pick<Task, "id" | "kind" | "result">>,
  prior?: Manifest,
) {
  const nodes = new Map(
    (prior?.instances || []).map((n) => [n.path, structuredClone(n)]),
  );
  const files = new Map(
    (prior?.files || []).map((f) => [f.path, structuredClone(f)]),
  );
  const seenNodes = new Map<
    string,
    { taskId: string; value: Manifest["instances"][number] }
  >();
  const fileVersions = new Map<
    string,
    Array<{ taskId: string; value: Manifest["files"][number] }>
  >();
  const localeVersions = new Map<
    string,
    Array<{ taskId: string; value: any }>
  >();
  const conflicts: IntegrationConflict[] = [],
    deletions = new Set<string>();
  for (const t of sources) {
    if (!t.result)
      throw new Error("Нет принятого результата зависимости " + t.id);
    const m = t.result;
    for (const path of m.deletions) {
      deletions.add(path);
      for (const key of nodes.keys())
        if (key === path || key.startsWith(path + "/")) nodes.delete(key);
    }
    for (const n of m.instances) {
      const old = seenNodes.get(n.path);
      if (old && hash(old.value) !== hash(n)) {
        let conflict = conflicts.find(
          (c) => c.kind === "instance" && c.path === n.path,
        );
        if (!conflict) {
          conflict = { kind: "instance", path: n.path, variants: [old] };
          conflicts.push(conflict);
        }
        conflict.variants.push({ taskId: t.id, value: structuredClone(n) });
      } else if (!old) {
        seenNodes.set(n.path, { taskId: t.id, value: structuredClone(n) });
        nodes.set(n.path, structuredClone(n));
      }
    }
    for (const f of m.files) {
      const versions = fileVersions.get(f.path) || [];
      if (!versions.some((v) => v.value.content === f.content))
        versions.push({ taskId: t.id, value: structuredClone(f) });
      fileVersions.set(f.path, versions);
    }
    for (const entry of mergeLocaleEntries([m]).entries) {
      const versions = localeVersions.get(entry.key) || [];
      if (!versions.some((v) => hash(v.value) === hash(entry)))
        versions.push({ taskId: t.id, value: entry });
      localeVersions.set(entry.key, versions);
    }
  }
  for (const [path, versions] of fileVersions) {
    if (versions.length === 1) files.set(path, versions[0].value);
    else if (/^docs\/.+\.(md|txt)$/i.test(path))
      files.set(path, {
        path,
        content: versions
          .map((v) => `## Source: ${v.taskId}\n\n${v.value.content}`)
          .join("\n\n---\n\n"),
      });
    else {
      files.set(path, versions[0].value);
      conflicts.push({ kind: "file", path, variants: versions });
    }
  }
  const localeEntries = [...localeVersions.values()].map((v) => v[0].value);
  for (const [key, versions] of localeVersions)
    if (versions.length > 1)
      conflicts.push({ kind: "localization", path: key, variants: versions });
  const manifests = sources.map((s) => s.result!);
  const locale = mergeLocaleEntries(
    [
      manifestSchema.parse({
        summary: "Merged catalogue",
        data: {
          localization: { sourceLocaleId: "en-us", entries: localeEntries },
        },
      }),
    ],
    prior,
  );
  const checks = new Map<string, Manifest["checks"][number]>();
  for (const m of manifests)
    for (const check of m.checks)
      checks.set(check.id + ":" + (check.device || ""), structuredClone(check));
  const manifest = manifestSchema.parse({
    summary: manifests.map((m) => m.summary).join("\n"),
    instances: [...nodes.values()],
    files: [...files.values()],
    deletions: [...deletions],
    checks: [...checks.values()],
    findings: manifests.flatMap((m) => m.findings),
    data: {
      ...(prior?.data || {}),
      localization: locale,
      assets: manifests.flatMap((m) =>
        Array.isArray(m.data.assets) ? m.data.assets : [],
      ),
      components: sources.map((t) => ({
        taskId: t.id,
        kind: t.kind,
        metadata: Object.fromEntries(
          Object.entries(t.result!.data).filter(
            ([key]) => key !== "localization",
          ),
        ),
      })),
      integrationContracts: sources
        .filter((t) => t.result?.data.integrationContract)
        .map((t) => ({
          taskId: t.id,
          kind: t.kind,
          contract: t.result!.data.integrationContract,
        })),
    },
  });
  return { manifest, conflicts };
}

export function applyIntegrationPatch(
  base: IntegrationBase,
  input: Manifest,
): Manifest {
  const identity = z
    .object({ baseId: z.string(), baseHash: z.string() })
    .parse(input.data.integrationPatch);
  if (
    identity.baseId !== base.id ||
    identity.baseHash !== base.hash ||
    hash(base.manifest) !== base.hash
  )
    throw new Error(
      "Исправление интеграции относится к другой или изменённой основе",
    );
  if (
    !input.instances.length &&
    !input.files.length &&
    !input.deletions.length &&
    !input.data.localization
  )
    throw new Error("Нужны конкретные изменения интеграции, а не пустой patch");
  for (const conflict of base.conflicts) {
    const resolved =
      conflict.kind === "instance"
        ? input.instances.some((n) => n.path === conflict.path) ||
          input.deletions.some(
            (p) => conflict.path === p || conflict.path.startsWith(p + "/"),
          )
        : conflict.kind === "file"
          ? input.files.some((f) => f.path === conflict.path)
          : (input.data.localization as any)?.entries?.some(
              (e: any) => e.key === conflict.path,
            );
    if (!resolved)
      throw new Error("Не разрешён конфликт интеграции: " + conflict.path);
  }
  const result = structuredClone(base.manifest),
    nodes = new Map(result.instances.map((n) => [n.path, n])),
    files = new Map(result.files.map((f) => [f.path, f]));
  for (const path of input.deletions)
    for (const key of nodes.keys())
      if (key === path || key.startsWith(path + "/")) nodes.delete(key);
  for (const n of input.instances) nodes.set(n.path, structuredClone(n));
  for (const f of input.files) files.set(f.path, structuredClone(f));
  const data: Manifest["data"] = {
    ...result.data,
    ...structuredClone(input.data),
    localization: mergeLocaleEntries([input], result),
  };
  // Empty metadata in a patch must not erase accepted resources or role contracts.
  const assets = new Map<string, unknown>();
  for (const asset of [
    ...(Array.isArray(result.data.assets) ? result.data.assets : []),
    ...(Array.isArray(input.data.assets) ? input.data.assets : []),
  ])
    assets.set(
      asset && typeof asset === "object" && "id" in asset
        ? String(asset.id)
        : hash(asset),
      asset,
    );
  data.assets = [...assets.values()];
  if (result.data.components) data.components = result.data.components;
  if (result.data.integrationContracts)
    data.integrationContracts = result.data.integrationContracts;
  delete data.integrationPatch;
  data.integrationApplied = {
    baseId: base.id,
    baseHash: base.hash,
    changedInstances: input.instances.map((n) => n.path),
    changedFiles: input.files.map((f) => f.path),
  };
  const checks = new Map(
    result.checks.map((c) => [c.id + ":" + (c.device || ""), c]),
  );
  for (const c of input.checks) checks.set(c.id + ":" + (c.device || ""), c);
  return manifestSchema.parse({
    ...result,
    summary: input.summary,
    instances: [...nodes.values()],
    files: [...files.values()],
    deletions: [...new Set([...result.deletions, ...input.deletions])],
    checks: [...checks.values()],
    findings: [...result.findings, ...input.findings],
    data,
  });
}

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

// Reproducible, allowlist-only cache for SyphoDev's pinned source revision.
// Fetches text blobs only; downloaded files are never executed.
const repo = "SyphoDev-yt/roblox-ai-skills";
const sha = "5aad881d1e6553cc3671ad549fdf01b8191bdc37";
const root = resolve(import.meta.dirname, "../docs/skill-imports");
const raw = (path) => `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
const get = async (url, json = false) => {
  const response = await fetch(url, { headers: { "User-Agent": "Roblox-Workshop-Skill-Cache" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return json ? response.json() : response.text();
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const gitBlobHash = (value) => createHash("sha1").update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest("hex");
const tree = await get(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`, true);
if (tree.truncated) throw new Error("GitHub returned an incomplete tree");
const blobs = new Map(tree.tree.filter((x) => x.type === "blob").map((x) => [x.path, x.sha]));
const available = new Set(blobs.keys());
const getPinned = async (path) => {
  const text = await get(raw(path));
  if (gitBlobHash(text) !== blobs.get(path)) throw new Error(`Blob hash mismatch at ${path}`);
  return text;
};
const licensePath = "LICENSE.txt";
if (!available.has(licensePath)) throw new Error("Pinned revision has no LICENSE.txt");
const license = await getPinned(licensePath);
const common = `# Адаптация SyphoDev для мастерской

Выборочная адаптация исходного навыка для Roblox Automation. Точная неизменённая upstream-версия находится в UPSTREAM.md. Исходники в resources/ являются справочными; запускать их только в workspace активной native-задачи с отключённой сетью.

## Граница изменений

Изменять игру может только агент действительно запущенной задачи мастерской и только через её контролируемые инструменты. Соблюдать очередь, утверждённые стиль, механики и данные проекта. Не обходить очередь, не публиковать автоматически и не выполнять платежи. В одном проекте должен быть один Studio writer. Не использовать .claude/, Claude agents/orchestrators, LOCAL.md, model roster, sessions, отдельные очереди, установщики или внешние генераторы, Cloudflare, Kaggle, Pollinations и их ключи.

Офлайн Python запускать только внутри workspace активной native-задачи с отключённой сетью. Изменения сцены и проверки в Studio выполнять только через контролируемые workshop MCP вызовы этой задачи. Не запускать произвольные Studio команды из shell.
`;
const packages = [
  {
    id: "sypho-roblox-map", folder: "skills/roblox-map",
    roles: ["designer", "art", "assets", "qa"], capabilities: [], dependencies: [],
    files: ["SKILL.md", "profiles/default.json", "profiles/wallrun_example.json", "references/map-design.md", "references/movement-numbers.md", "scripts/checks_budget.py", "scripts/checks_design.py", "scripts/checks_terrain.py", "scripts/emit.py", "scripts/geom.py", "scripts/outline.py", "scripts/plan.py", "scripts/prove.py", "scripts/reach.py", "scripts/spec.py", "scripts/terrain.py", "scripts/theme.py", "scripts/verify_map.py", "specs/duel_arena.json", "specs/meadow_island.json", "specs/minimal.json", "specs/sky_citadel.json", "themes/sky_citadel.json"],
    adapted: common + `\n## Карты: офлайн-проверка и передача в Studio\n\nДля задачи design/spec без bound Studio или вне native workspace только зафиксировать требования и непроверенные допущения; пока не запускать скрипты. Использовать Python-ресурсы только в workspace активной native-задачи с network=false. Получить актуальные geometry и movement numbers из задачи и Studio; не подменять их демонстрационными профилями. Для Python нужны numpy, scipy и Pillow. Использовать обычные parts и встроенный stairs: custom kits требуют отсутствующий kit.py и не входят в эту адаптацию. Поток: spec -> prove/plan -> emit. PASS означает только прохождение статических/геометрических проверок модели; он не доказывает живую физику, достижимость в игре или визуальную красоту.\n\nСгенерированный результат передавать только через предусмотренную задачу мастерской. Любые проверки и изменения в Studio выполнять только её контролируемыми вызовами workshop MCP.\n\nСм. \`TOOLING.md\` для локальных offline entrypoints и \`resources/\` для сохранённых upstream-файлов.\n`,
    tooling: `# Offline entrypoints\n\nRun only in the active native workshop task workspace with network disabled; use the current task's spec and write outputs to its workspace.\n\n- python resources/scripts/prove.py <workspace-spec.json> --json <workspace-report.json>\n- python resources/scripts/plan.py <workspace-spec.json> --prove -o <workspace-plan.png>\n- python resources/scripts/emit.py <workspace-spec.json> --lua <workspace-build.lua> (small maps)\n- python resources/scripts/verify_map.py (offline self-test)\n\nNo emitted artifact may be inserted or executed except through the active workshop task's controlled Studio MCP calls. A PASS is not evidence of live physics, playability, or visual quality.\n`,
  },
  {
    id: "sypho-roblox-sfx", folder: "skills/roblox-sfx",
    roles: ["assets", "gameplay", "qa"], capabilities: [], dependencies: [],
    files: ["SKILL.md", "examples/spec.example.json", "scripts/emit_bank.py", "scripts/emit_probe.py", "scripts/pick.py"],
    adapted: common + `\n## Звуки\n\nВ задачах planning/spec без bound Studio только записать требования к звуку и непроверенные допущения. Поиск кандидатов выполнять только в active native task через контролируемый workshop.search_sfx(query, limit); он возвращает кандидатов. Для каждого выбранного Sound сделать отдельный контролируемый вызов workshop MCP execute_luau, проверить IsLoaded, дождаться загрузки, считать TimeLength и сохранить отчёт. Офлайн команды в workspace задачи: python resources/scripts/emit_probe.py <candidates.json> --out <workspace-probes>; после проверки кандидатов: python resources/scripts/pick.py <candidates.json> <report.json> --out <manifest.json>; затем python resources/scripts/emit_bank.py <manifest.json> --out <workspace-bank>. Прослушать результат отдельно в Studio. Не вызывать find_sfx.py и не искать по сети через shell. Все изменения игры — только через контролируемые вызовы workshop MCP текущей задачи.\n`,
    tooling: `# Tooling\n\n1. Call the controlled \`workshop.search_sfx(query, limit)\` tool for candidates.\n2. For each candidate, use a separate approved \`execute_luau\` call to measure \`IsLoaded\` and \`TimeLength\`.\n3. Run offline \`pick.py\` on the resulting evidence and \`emit_bank.py\` to emit the bank in the active task workspace.\n4. Listen to the result in a separate controlled Studio step.\n\nDo not use network shell search or the upstream networked \`find_sfx.py\`.\n`,
  },
  {
    id: "sypho-roblox-ui-tools", folder: "skills/roblox-ui",
    roles: ["ui", "qa"], capabilities: [], dependencies: ["roblox-ui"],
    files: ["SKILL.md", "examples/coin_hud.json", "references/UIController.client.lua", "references/icons.example.json", "references/theme.json", "references/ui-recipes.md", "scripts/gen_icon_bank.py", "scripts/patterns.py", "scripts/ui_build.py", "scripts/ui_kit.py", "scripts/verify_icon_wiring.py", "scripts/verify_labels.py", "scripts/verify_name_contract.py", "scripts/verify_ui.py"],
    adapted: common + `\n## UI-проверки и вспомогательные инструменты\n\nДля planning/spec вне native workspace только описать требования и вопросы к UI, не запускать локальные проверки. Основным навыком UI остаётся roblox-ui; этот пакет даёт дополнительные проверки макета и примеры. Используй verify_labels.py, verify_name_contract.py, verify_icon_wiring.py, затем при необходимости verify_ui.py и ui_build.py с patterns.py в offline workspace активной задачи. Соблюдай существующий стиль и дизайн-систему проекта. Проверки вспомогательны: не навязывать зелёные кнопки, единую тему или масштабирование всем играм. Шрифт не включён; ui_build.py имеет PIL default-font fallback для локального preview, это не гарантирует совпадения метрик со Studio. Если на fallback невозможно оценить текст, сообщить ограничение. Изменения в Studio выполнять только контролируемыми вызовами workshop MCP текущей задачи. См. TOOLING.md и resources/.\n`,
    tooling: `# Offline entrypoints\n\nRun only in the active native workshop task workspace with network disabled; use the current task's spec and write outputs to its workspace.\n\n- python resources/scripts/prove.py <workspace-spec.json> --json <workspace-report.json>\n- python resources/scripts/plan.py <workspace-spec.json> --prove -o <workspace-plan.png>\n- python resources/scripts/emit.py <workspace-spec.json> --lua <workspace-build.lua> (small maps)\n- python resources/scripts/verify_map.py (offline self-test)\n\nNo emitted artifact may be inserted or executed except through the active workshop task's controlled Studio MCP calls. A PASS is not evidence of live physics, playability, or visual quality.\n`,
  },
];
const toolingById = new Map([
  ["sypho-roblox-map", `# Offline entrypoints

Run only in the active native workshop task workspace with network disabled; use the current task's spec and write outputs to its workspace.

- python resources/scripts/prove.py <workspace-spec.json> --json <workspace-report.json>
- python resources/scripts/plan.py <workspace-spec.json> --prove -o <workspace-plan.png>
- python resources/scripts/emit.py <workspace-spec.json> --lua <workspace-build.lua> (small maps)
- python resources/scripts/verify_map.py (offline self-test)

No emitted artifact may be inserted or executed except through the active workshop task's controlled Studio MCP calls. A PASS is not evidence of live physics, playability, or visual quality.
`],
  ["sypho-roblox-ui-tools", `# Offline entrypoints

Run only in the active native workshop task workspace with network disabled. Existing task workspace owns input and output paths.

- python resources/scripts/verify_labels.py --ui <built-ui-directory> --client <client-source-directory>
- python resources/scripts/verify_name_contract.py --gui <built-ui-directory> --contract <name-contract.json>
- python resources/scripts/verify_icon_wiring.py --gui <built-ui-directory> --bank <icon-bank.luau>
- python resources/scripts/verify_ui.py <spec.json>
- python resources/scripts/ui_build.py <spec.json> --out <workspace-output> --png --model --luau (uses patterns.py and ui_kit.py)

The primary design workflow remains the installed roblox-ui skill. The added gates are advisory inputs to the task; they do not impose a theme, green buttons, or global scaling. The bundled upstream font files are omitted; ui_build falls back to PIL default font for previews, which does not guarantee Studio metric fidelity. When the host has Arial Bold, choose BuilderSans for preview text; Studio remains ground truth.
`],
]);
for (const pack of packages) if (toolingById.has(pack.id)) pack.tooling = toolingById.get(pack.id);
const sfxWorkflow = `## Sound workflow

For planning/spec tasks without bound Studio, record sound requirements and unverified assumptions only. In the active native task, search candidates through controlled workshop.search_sfx(query, limit); its compact results are the source of candidate IDs and metadata.

Before running offline helpers, normalize the tool result to the shape expected by emit_probe.py and pick.py: {name, roles:[{role, query, kind, min_len, max_len, volume, looped, candidates:[{id, name, creator, audioType, score, listed_duration}]}]}. Map each task role's query and constraints from the approved sound spec. Convert string IDs only when they are safe positive integers. If search_sfx supplies no score, set score to negative array rank solely to preserve stable order; do not present that as a relevance or quality score. Keep listed_duration as a listing claim, never as a measured duration.

Offline commands in the active task workspace: python resources/scripts/emit_probe.py <candidates.json> --out <workspace-probes>; use its generated Luau only as a starting point. It targets SoundService.SFXProbe and clears that folder, so do not execute it unchanged. Adapt a task-owned copy to use a unique __SyphoSkillProbe_<task-id> folder, create it only if absent, never clear or alter existing SFXProbe, and include only the bounded candidate IDs. Run each measurement in a separate controlled workshop MCP execute_luau call. Record one CSV row per result as role,id,loaded,length using actual IsLoaded and Sound.TimeLength: python resources/scripts/pick.py <candidates.json> <report.csv> --out <manifest.json>.

Then run python resources/scripts/emit_bank.py <manifest.json> --out <workspace-bank>. It may create install.lua as an output file; do not execute or submit that file unless a separate task explicitly authorizes installation. Listen to selected sounds in Studio in a separate controlled step. Never call upstream find_sfx.py or use network search from shell.
`;
for (const pack of packages) if (pack.id === "sypho-roblox-sfx") pack.adapted = common + "\n" + sfxWorkflow;
const sourceFiles = new Map();
for (const pack of packages) for (const rel of pack.files) {
  const source = `${pack.folder}/${rel}`;
  if (!available.has(source)) throw new Error(`Pinned source is missing ${source}`);
  sourceFiles.set(source, await getPinned(source));
}
const readme = await getPinned("README.md");
const youtubeUrls = [...readme.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]).filter((u) => /youtube|youtu\.be/i.test(u));
const allReports = [];
for (const pack of packages) {
  const outDir = resolve(root, pack.id);
  mkdirSync(outDir, { recursive: true });
  if (pack.id === "sypho-roblox-sfx" && existsSync(resolve(outDir, "TOOLING.md"))) unlinkSync(resolve(outDir, "TOOLING.md"));
  if (pack.id === "sypho-roblox-map") {
    const staleMapFiles = [
      "resources/scripts/blockout.py", "resources/scripts/build_map.py", "resources/scripts/capture_receiver.py",
      "resources/scripts/lighting.py", "resources/scripts/preview.py", "resources/scripts/serve_map.py",
      "resources/scripts/luau/ambient.lua.txt", "resources/scripts/luau/build.lua.txt",
      "resources/scripts/luau/build_terrain.lua.txt", "resources/scripts/luau/calibrate.lua.txt",
      "resources/scripts/luau/capture_views.lua.txt", "resources/scripts/luau/horizon_ocean.lua.txt",
      "resources/scripts/luau/install_dressing.lua.txt", "resources/scripts/luau/sample_view.lua.txt",
      "resources/scripts/luau/spawn_probe.server.lua.txt", "resources/scripts/luau/tide.lua.txt",
      "resources/scripts/luau/verify_build.lua.txt", "resources/scripts/luau/verify_ground.lua.txt",
      "resources/scripts/luau/verify_placement.lua.txt", "resources/scripts/luau/verify_terrain.lua.txt",
    ];
    for (const stale of staleMapFiles)
      if (existsSync(resolve(outDir, stale))) unlinkSync(resolve(outDir, stale));
  }
  if (pack.id === "sypho-roblox-ui-tools") {
    for (const stale of ["resources/scripts/glyphs.py", "resources/scripts/icon_cutout.py"])
      if (existsSync(resolve(outDir, stale))) unlinkSync(resolve(outDir, stale));
  }
  const titles = {"sypho-roblox-map":"Карты Roblox: планирование и офлайн-проверка","sypho-roblox-sfx":"Звуки Roblox: поиск, измерение и сборка банка","sypho-roblox-ui-tools":"Инструменты проверки Roblox UI"};
  const descriptions = {"sypho-roblox-map":"Offline prove, plan and emit Roblox map geometry using current project movement data.","sypho-roblox-sfx":"Find sound candidates through workshop, verify in Studio, then emit an offline sound bank.","sypho-roblox-ui-tools":"Supplemental offline checks and previews for Roblox UI; roblox-ui remains primary."};
  pack.adapted = `---
name: ${pack.id}
description: ${descriptions[pack.id]}
---

# ${titles[pack.id]}

${pack.adapted}`;
  const upstream = sourceFiles.get(`${pack.folder}/SKILL.md`);
  const files = [
    { path: "SKILL.md", content: pack.adapted },
    { path: "UPSTREAM.md", content: upstream },
    { path: "LICENSE.txt", content: license },
    { path: "TOOLING.md", content: pack.tooling },
  ];
  for (const rel of pack.files) {
    if (rel === "SKILL.md") continue;
    const source = `${pack.folder}/${rel}`;
    if (/\.(?:js|ps1|ttf)$/i.test(rel)) throw new Error(`Unsafe extension in allowlist: ${rel}`);
    const text = sourceFiles.get(source);
    const bundled = rel.replace(/\.luau?$/i, (ext) => `${ext}.txt`);
    files.push({ path: `resources/${bundled}`, content: text, originalPath: rel });
  }
  if (pack.id === "sypho-roblox-sfx") files.splice(files.findIndex((f) => f.path === "TOOLING.md"), 1);
  const resourceFiles = files.filter((f) => f.originalPath).map((f) => ({ originalPath: f.originalPath, path: f.path, hash: hash(f.content) }));
  resourceFiles.sort((a, b) => a.originalPath.localeCompare(b.originalPath));
  files.push({ path: "RESOURCE_MAP.json", content: JSON.stringify({ files: resourceFiles }, null, 2) + "\n" });
  files.sort((a,b) => a.path.localeCompare(b.path));
  const toolingText = files.find((f) => f.path === "TOOLING.md")?.content ?? "";
  const skillText = files.find((f) => f.path === "SKILL.md")?.content ?? "";
  if (pack.id === "sypho-roblox-map" && (!toolingText.includes("prove.py") || !toolingText.includes("plan.py") || toolingText.includes("verify_labels.py"))) throw new Error("Map TOOLING entrypoints mismatch");
  if (pack.id === "sypho-roblox-ui-tools" && (!toolingText.includes("verify_labels.py") || !toolingText.includes("verify_ui.py") || toolingText.includes("prove.py"))) throw new Error("UI TOOLING entrypoints mismatch");
  if (pack.id === "sypho-roblox-sfx" && (!skillText.includes("pick.py") || !skillText.includes("emit_bank.py"))) throw new Error("SFX entrypoints missing");
  if (pack.id === "sypho-roblox-sfx" && (!skillText.includes("__SyphoSkillProbe_<task-id>") || !skillText.includes("negative array rank"))) throw new Error("SFX safe adapter instructions missing");
  if (pack.id === "sypho-roblox-map" && files.some((f) => f.path.includes("/scripts/luau/") || /serve_map|capture_receiver|build_map/.test(f.path))) throw new Error("Network/Studio map transport included");
  const packageHash = hash(JSON.stringify(files.map(({path,content})=>({path,content})).sort((a,b)=>a.path.localeCompare(b.path))));
  const payload = {
    id: pack.id,
    source: `https://github.com/${repo}/tree/${sha}/${pack.folder}`,
    version: `${sha}-workshop.1`,
    license: "SyphoDev free licence",
    licensePath,
    roles: pack.roles,
    capabilities: pack.capabilities,
    dependencies: pack.dependencies,
    files: files.map(({path,content})=>({path,content})),
    packageHash,
    resourceFiles,
  };
  for (const f of files) {
    const target = resolve(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, "utf8");
  }
  writeFileSync(resolve(root, `${pack.id}.json`), JSON.stringify(payload,null,2)+"\n");
  allReports.push({
    id: pack.id, source: payload.source, commit: sha, version: payload.version,
    packageHash, license: "SyphoDev free licence", licensePath,
    youtubeLinksInReadme: youtubeUrls,
    included: files.map((f)=>({path:f.path, originalPath:f.originalPath||null, bytes:Buffer.byteLength(f.content), sha256:hash(f.content)})),
    excluded: tree.tree.filter((f) => f.type === "blob" && f.path.startsWith(pack.folder + "/") && !pack.files.includes(f.path.slice(pack.folder.length + 1))).map((f) => {
      const rel = f.path.slice(pack.folder.length + 1);
      let reason = "outside the selected offline workflow";
      if (rel === "LOCAL.template.md") reason = "machine-local setup and paths do not apply";
      else if (rel.startsWith("references/fonts/")) reason = "binary font omitted; preview uses PIL fallback and Studio remains truth";
      else if (rel === "scripts/find_sfx.py") reason = "network search replaced by controlled workshop.search_sfx";
      else if (["scripts/gen_icons_cf.py", "scripts/kaggle_icon_ab.py"].includes(rel)) reason = "external generator and credentials are prohibited";
      else if (rel === "scripts/upload_icons.py") reason = "external upload is not part of the offline task";
      else if (["scripts/glyphs.py", "scripts/icon_cutout.py"].includes(rel)) reason = "optional icon processing needs image dependencies and is not required by the requested UI checks/build";
      else if (pack.id === "sypho-roblox-map" && (rel.startsWith("scripts/luau/") || ["scripts/build_map.py", "scripts/capture_receiver.py", "scripts/serve_map.py"].includes(rel))) reason = "Studio/network transport is not needed for offline prove/plan/emit; scene interaction stays in workshop MCP";
      return { path: rel, reason };
    }),
  });
}
writeFileSync(resolve(root, "sypho-sources.json"), JSON.stringify({repo,commit:sha,licensePath,licenseSha256:hash(license),youtubeAttribution:{readmeMentionsChannel:true,linksFound:youtubeUrls},packages:allReports},null,2)+"\n");
console.log(JSON.stringify(allReports.map(p=>({id:p.id,files:p.included.length,packageHash:p.packageHash})),null,2));








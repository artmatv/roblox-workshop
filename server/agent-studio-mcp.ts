import { z } from "zod";
import { NativeSpecialist, specialistTool } from "./native-specialist.js";
import { createInterface } from "node:readline";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { readStudioDocumentIdentity, StudioMcp } from "./studio-mcp.js";
import { assertSafeSvg } from "./safe-svg.js";
import { inspectImage, verifyInspectedImage } from "./native-art.js";
import { authorizeSfxSkill, searchSfx } from "./sfx-search.js";
import {
  audioFile,
  fetchOpenSfx,
  findOpenSfx,
  listenAudio,
  openCloudResult,
  processAudio,
  sha256 as audioSha256,
} from "./native-audio.js";
import { NATIVE_KIND } from "../shared/native-harness.js";
import {
  applyNativeLocalizationUnderLease,
  nativeLocalizationAccessAllowed,
  nativeLocalizationInputSchema,
  prepareNativeLocalization,
} from "./native-localization.js";
import {
  createValidationStudio,
  validationStudioToolDefinitions,
} from "./validation-studio.js";
import {
  createMotionStudio,
  motionStudioToolDefinitions,
} from "./motion-studio.js";
export const STUDIO_TOOLS = [
  "list_roblox_studios",
  "list_skills",
  "skill",
  "http_get",
  "inspect_instance",
  "search_game_tree",
  "script_search",
  "script_read",
  "script_grep",
  "execute_luau",
  "multi_edit",
  "screen_capture",
  "get_studio_state",
  "get_console_output",
  "start_stop_play",
  "user_mouse_input",
  "user_keyboard_input",
  "character_navigation",
  "generate_mesh",
  "generate_texture",
  "generate_scene",
  "generate_procedural_model",
  "segment_mesh",
  "generate_avatar",
  "auto_setup_avatar",
  "wait_job_finished",
  "store_image",
  "upload_image",
];
const motionActionPhases: Record<string, string | null> = {
  create: "idle",
  pose_rest: "created",
  pose_action: "animation-rest-captured",
  mesh_sample: "animation-action-captured",
  vfx: "mesh-preview-captured",
  cleanup: null,
};
export function motionProbePhaseAllowed(action: string, phase: string) {
  return action === "cleanup" || (motionActionPhases[action] !== undefined && motionActionPhases[action] === phase);
}
const searchSfxTool = {
  name: "search_sfx",
  description:
    "Search Roblox's public Toolbox audio metadata for candidates. Results are metadata only; they are not checked for playability.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 120 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["query", "limit"],
    additionalProperties: false,
  },
};
// Every multiplayer test opens a server and one Studio window per client on
// the owner's desktop (six clients took about 13 GB). Up to three clients is
// enough for multiplayer rules; load under many players is measured by the
// owner on real devices.
export const MAX_TEST_CLIENTS = 3;
export function multiplayerTestProblem(code: string) {
  const calls = [...String(code).matchAll(/ExecuteMultiplayerTestAsync\s*\(\s*([^,)]*)/g)];
  return calls.some((m) => {
    const n = Number(m[1]!.trim());
    return !Number.isInteger(n) || n < 1 || n > MAX_TEST_CLIENTS;
  })
    ? `Мультиплеерный тест Studio допускается не больше чем на ${MAX_TEST_CLIENTS} клиента, числом прямо в вызове ExecuteMultiplayerTestAsync: каждый клиент — отдельное окно Studio на экране владельца. Нагрузку под многими игроками владелец измеряет на своих устройствах.`
    : null;
}
export function insideWorkspace(root: string, path: string) {
  const resolved = realpathSync(resolve(root, path)),
    rel = relative(realpathSync(root), resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Нужен файл внутри рабочей папки проекта");
  return resolved;
}
export function writeWorkspacePath(root: string, path: string) {
  const resolved = resolve(root, path),
    rel = relative(realpathSync(root), resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Путь вне рабочей папки проекта");
  if (existsSync(resolved)) return insideWorkspace(root, path);
  let parent = dirname(resolved);
  while (!existsSync(parent)) parent = dirname(parent);
  const checked = relative(realpathSync(root), realpathSync(parent));
  if (checked.startsWith("..") || isAbsolute(checked))
    throw new Error("Путь проходит через внешнюю ссылку");
  return resolved;
}
const objectTool = (name: string, description: string, properties: any, required: string[] = []) => ({
  name,
  description,
  inputSchema: { type: "object", additionalProperties: false, required, properties },
});
const audioPathSchema = { type: "string", minLength: 1, maxLength: 300 };
export const audioTools = [
  objectTool(
    "find_open_sfx",
    "Search Openverse for CC0 Freesound sound effects (metadata only, untrusted text). Then fetch_open_sfx the ones worth hearing.",
    {
      query: { type: "string", minLength: 1, maxLength: 120 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
      maxSeconds: { type: "number", minimum: 0.2, maximum: 30 },
    },
    ["query", "limit"],
  ),
  objectTool(
    "fetch_open_sfx",
    "Download one CC0 candidate returned by find_open_sfx in this attempt into assets/audio/src/. The workshop records its provenance.",
    { id: { type: "string", minLength: 36, maxLength: 36 } },
    ["id"],
  ),
  objectTool(
    "listen_audio",
    "Hear audio files with earshot (CPU, ~30 s): one file without description = describe; one file + description = match verdict; several files + description = rank. Advisory: still check in Play.",
    {
      paths: { type: "array", minItems: 1, maxItems: 8, items: audioPathSchema },
      description: { type: "string", minLength: 3, maxLength: 300 },
    },
    ["paths"],
  ),
  objectTool(
    "process_audio",
    "Edit a recorded sound with fixed ffmpeg operations into assets/audio/<output>.ogg (mono 48 kHz): trim, trimSilence, high/lowpass, pitchSemitones, speed, gainDb, loudnessLufs (EBU R128, true peak -1 dB), fadeInMs/fadeOutMs. Returns duration and measured loudness.",
    {
      input: audioPathSchema,
      output: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" },
      trimStart: { type: "number", minimum: 0, maximum: 30 },
      trimEnd: { type: "number", minimum: 0.05, maximum: 30 },
      trimSilence: { type: "boolean" },
      highpassHz: { type: "number", minimum: 20, maximum: 8000 },
      lowpassHz: { type: "number", minimum: 200, maximum: 20000 },
      pitchSemitones: { type: "number", minimum: -12, maximum: 12 },
      speed: { type: "number", minimum: 0.5, maximum: 2 },
      gainDb: { type: "number", minimum: -30, maximum: 20 },
      loudnessLufs: { type: "number", minimum: -30, maximum: -8 },
      fadeInMs: { type: "integer", minimum: 0, maximum: 5000 },
      fadeOutMs: { type: "integer", minimum: 0, maximum: 5000 },
    },
    ["input", "output"],
  ),
  objectTool(
    "upload_audio",
    "Upload a fetched or processed sound from assets/audio/ to Roblox as an Audio asset of the experience owner; returns rbxassetid. Repeating the call for the same file resumes a pending upload.",
    { path: audioPathSchema, displayName: { type: "string", minLength: 3, maxLength: 50 } },
    ["path", "displayName"],
  ),
  objectTool(
    "check_audio",
    "In Play, list every Sound in the running game with SoundId, IsLoaded, TimeLength and SoundGroup. Acceptance requires each delivered audio asset to load here.",
    {},
  ),
];
const drawTool = {
  name: "draw_icon",
  description:
    "Draw an original detailed game icon from SVG source and save its PNG in assets/. Inspect the exact PNG with inspect_image before upload_image; revise only for an actual defect or requested feedback, then inspect the changed file again.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", pattern: "^[a-z0-9-]+$" },
      svg: {
        type: "string",
        description:
          "Complete self-contained SVG illustration with paths, shading and original subject detail; no external resources or scripts.",
      },
      size: { type: "integer", minimum: 128, maximum: 1024 },
    },
    required: ["name", "svg"],
    additionalProperties: false,
  },
};
const inspectTool = {
  name: "inspect_image",
  description:
    "Render the exact workspace PNG in an offline visual context: light/dark and 32/48 px for icons, or a 2x2 repeat for textures. Inspect every PNG before upload_image; re-inspect after any edit. This is a preview, not an automated quality score.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      kind: { type: "string", enum: ["icon", "texture"] },
    },
    required: ["path", "kind"],
    additionalProperties: false,
  },
};
export async function drawIcon(workspace: string, args: any) {
  if (
    !/^[a-z0-9-]{1,80}$/.test(args.name) ||
    typeof args.svg !== "string" ||
    args.svg.length > 500000
  )
    throw new Error("Неверное имя или размер SVG");
  assertSafeSvg(args.svg);
  const size = args.size ?? 512;
  if (!Number.isInteger(size) || size < 128 || size > 1024)
    throw new Error("Размер иконки 128–1024");
  const file = writeWorkspacePath(workspace, `assets/${args.name}`);
  mkdirSync(dirname(file), { recursive: true });
  const svgFile = writeWorkspacePath(workspace, `assets/${args.name}.svg`);
  const pngFile = writeWorkspacePath(workspace, `assets/${args.name}.png`);
  writeFileSync(svgFile, args.svg);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: size, height: size },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${args.svg}</body></html>`,
    );
    await page.locator("svg").evaluate((s: any, px: number) => {
      s.setAttribute("width", String(px));
      s.setAttribute("height", String(px));
    }, size);
    await page.screenshot({ path: pngFile, omitBackground: true });
  } finally {
    await browser.close();
  }
  return {
    path: `assets/${args.name}.png`,
    svgPath: `assets/${args.name}.svg`,
    data: readFileSync(file + ".png").toString("base64"),
  };
}
async function serve() {
  const env = process.env,
    workspace = realpathSync(env.WORKSHOP_WORKSPACE!),
    studioId = env.WORKSHOP_STUDIO_ID!,
    documentId = env.WORKSHOP_DOCUMENT_ID!,
    taskId = env.WORKSHOP_TASK_ID!,
    attempt = Number(env.WORKSHOP_ATTEMPT),
    traceRoot = resolve(env.WORKSHOP_TRACE_ROOT!);
  mkdirSync(traceRoot, { recursive: true });
  const upstream = new StudioMcp(env.WORKSHOP_MCP_BINARY);
  await upstream.start();
  let sfxCandidateIds: string[] = [];
  const files = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const file = files.get(req.url || "");
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(file);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const ledger = (record: any) =>
    appendFileSync(
      resolve(traceRoot, "tools.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        taskId,
        attempt,
        studioId,
        ...record,
      }) + "\n",
    );
  const lease = () => {
    const db = new DatabaseSync(env.WORKSHOP_DATABASE!, { readOnly: true });
    try {
      const get = (kind: string, id: string) => {
        const row = db
          .prepare("SELECT body FROM records WHERE kind=? AND id=?")
          .get(kind, id);
        return row ? JSON.parse(row.body as string) : null;
      };
      const task = get("task", taskId),
        project = task && get("project", task.projectId);
      if (
        !task ||
        task.status !== "running" ||
        !Number.isSafeInteger(attempt) ||
        task.attempt !== attempt ||
        project?.execution !== "running" ||
        project.studioId !== env.WORKSHOP_BRIDGE_ID
      )
        throw new Error(
          "Работа остановлена или Studio больше не привязана к проекту",
        );
    } finally {
      db.close();
    }
  };
  const nativeDevelopmentTask = () => {
    const db = new DatabaseSync(env.WORKSHOP_DATABASE!, { readOnly: true });
    try {
      const row = db.prepare("SELECT body FROM records WHERE kind='task' AND id=?").get(taskId);
      const task = row ? JSON.parse(row.body as string) : null;
      return task?.kind === NATIVE_KIND && !task.validationProfile && task.attempt === attempt && task.status === "running";
    } finally { db.close(); }
  };
  const activeSfxSkill = () => {
    if (!/^[a-f0-9]{64}$/.test(env.WORKSHOP_SFX_SKILL_HASH || ""))
      throw new Error("search_sfx доступен только с закреплённым SFX навыком");
    const db = new DatabaseSync(env.WORKSHOP_DATABASE!, { readOnly: true });
    try {
      const get = (kind: string, id: string) => {
        const row = db
          .prepare("SELECT body FROM records WHERE kind=? AND id=?")
          .get(kind, id);
        return row ? JSON.parse(row.body as string) : null;
      };
      const task = get("task", taskId),
        project = task && get("project", task.projectId);
      const pin = task?.skills?.find(
        (item: any) =>
          item.id === "sypho-roblox-sfx" &&
          item.hash === env.WORKSHOP_SFX_SKILL_HASH,
      );
      const current = get("skill", "sypho-roblox-sfx");
      const archived = pin
        ? get("skillArchive", `${pin.id}:${pin.hash}`)
        : null;
      const pkg = pin ? get("skillPackage", `${pin.id}:${pin.hash}`) : null;
      return authorizeSfxSkill(
        task,
        project,
        current,
        archived,
        pkg,
        env.WORKSHOP_SFX_SKILL_HASH!,
      );
    } finally {
      db.close();
    }
  };
  const specialist =
    env.WORKSHOP_SPECIALISTS === "1"
      ? new NativeSpecialist(workspace, lease, (record) =>
          ledger({ tool: "ask_specialist", ...record }),
        )
      : null;
  let reviewAbort: AbortController | null = null;
  const externalReviewTool = {
    name: "ask_external_review",
    description:
      "Request independent text review from the external model selected by the owner. Requires configured key and approved project budget; never retry automatically.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["instruction", "files"],
      properties: {
        instruction: { type: "string", minLength: 3, maxLength: 20000 },
        files: { type: "array", maxItems: 8, items: { type: "string" } },
      },
    },
  };
  const checkDeliveryTool = {
    name: "check_delivery",
    description:
      "Run the workshop's own structural acceptance checks for the current attempt (delivery.json, required captures, created and uploaded art for this milestone) without any review. Returns the problems that would reject the attempt. Call before finishing the turn.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  };
  const previewVisualTool = {
    name: "preview_visual_review",
    description:
      "Rehearse the acceptance visual review on the current attempt's latest required and targeted captures and the milestone checklist. Advisory only (does not accept or reject); at most 3 calls per attempt. Use it to find missing angles and visible defects before finishing.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  };
  const identity = async () => {
    await readStudioDocumentIdentity(upstream, studioId, documentId);
  };
  const validationProfile = env.WORKSHOP_VALIDATION_PROFILE;
  const validation = validationProfile === "sypho-skills" || validationProfile === "sypho-motion";
  const validationStudio =
    validation
      ? createValidationStudio({
          tool: (name, args, timeout) => upstream.tool(name, args, timeout),
          studioId,
          taskId,
          attempt,
          profile: validationProfile,
          lease,
          identity,
          getCandidateIds: () => sfxCandidateIds,
        })
      : null;
  const motionStudio = validationProfile === "sypho-motion"
    ? createMotionStudio({
        tool: (name, args, timeout) => upstream.tool(name, args, timeout),
        studioId, taskId, attempt, lease, identity, workspace,
      })
    : null;
  let motionPhase = "idle";
  let motionBeforeChecked = false;
  let motionOwnedPlay = false;
  let motionCleanupVerified = false;
  const motionFrames = new Map<string, { cameraPosition: number[]; cameraTarget: number[] }>();
  const motionCaptures = new Set<string>();
  let motionVfxPreviewAt = 0;
  const requireValidationPlay = async () => {
    lease();
    await identity();
    lease();
    const state = await upstream.tool("get_studio_state", {
      studio_id: studioId,
    });
    lease();
    const text = (state.content || [])
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .join("\n");
    const mode = text
      .match(/Current Studio Mode\s*:\s*([^\r\n]+)/i)?.[1]
      ?.trim();
    if (!mode || !/^Play\b/i.test(mode))
      throw new Error("Ввод разрешён только в подтверждённом Play mode");
    if (validationProfile === "sypho-motion" && !/Available DataModels\s*:\s*[^\r\n]*\bClient\b/i.test(text))
      throw new Error("Motion preview input/capture requires the confirmed Play Client DataModel");
    await identity();
    lease();
  };
  const handle = async (method: string, params: any) => {
    if (method === "initialize")
      return {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "workshop", version: "2" },
      };
    if (method === "ping") return {};
    if (method === "tools/list") {
      const result = await upstream.call("tools/list", {});
      const validation = env.WORKSHOP_VALIDATION_PROFILE === "sypho-skills" || env.WORKSHOP_VALIDATION_PROFILE === "sypho-motion";
      const validationTools = new Set([
        "list_roblox_studios",
        "list_skills",
        "skill",
        "inspect_instance",
        "search_game_tree",
        "script_search",
        "script_read",
        "script_grep",
        "screen_capture",
        "get_studio_state",
        "start_stop_play",
        "user_mouse_input",
        "user_keyboard_input",
        "character_navigation",
      ]);
      return {
        tools: [
          ...(!validation && nativeLocalizationAccessAllowed(env.WORKSHOP_LOCALIZATION_PROTOCOL, nativeDevelopmentTask()) ? [{
            name: "prepare_localization",
            description: "Before localization QA, submit every English static UI source and dynamic message entry. The host validates the catalog with the official generator and installs only its three reserved objects in this task's bound Studio Edit session.",
            inputSchema: {
              type: "object", additionalProperties: false,
              required: ["sourceLocaleId", "entries"],
              properties: {
                sourceLocaleId: { type: "string", const: "en-us" },
                entries: { type: "array", minItems: 1, maxItems: 2000, items: {
                  type: "object", additionalProperties: false,
                  required: ["key", "source"],
                  properties: {
                    key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,119}$" },
                    source: { type: "string", minLength: 1, maxLength: 4000 },
                    context: { type: "string", maxLength: 1000 },
                    example: { type: "string", maxLength: 4000 },
                  },
                } },
              },
            },
          }] : []),
          ...(!validation ? [drawTool, inspectTool, ...audioTools] : []),
          ...(!validation && env.WORKSHOP_CHECK_URL ? [checkDeliveryTool] : []),
          ...(!validation && env.WORKSHOP_PREVIEW_URL ? [previewVisualTool] : []),
          ...(!validation && specialist ? [specialistTool] : []),
          ...(!validation && specialist && env.WORKSHOP_EXTERNAL_REVIEW === "1"
            ? [externalReviewTool]
            : []),
          ...(env.WORKSHOP_SFX_SKILL_HASH ? [searchSfxTool] : []),
          ...(validationStudio
            ? validationProfile === "sypho-skills"
              ? validationStudioToolDefinitions
              : validationStudioToolDefinitions.filter((tool) => tool.name === "validation_control")
            : []),
          ...(motionStudio ? motionStudioToolDefinitions : []),
          ...result.tools
            .filter(
              (t: any) =>
                STUDIO_TOOLS.includes(t.name) &&
                (!validation || validationTools.has(t.name)),
            )
            .map((t: any) => {
              const clone = structuredClone(t);
              if (clone.inputSchema?.properties)
                delete clone.inputSchema.properties.studio_id;
              if (clone.inputSchema?.required)
                clone.inputSchema.required = clone.inputSchema.required.filter(
                  (r: string) => r !== "studio_id",
                );
              return clone;
            }),
        ],
      };
    }
    if (method !== "tools/call") throw new Error("Метод MCP не поддержан");
    lease();
    const name = params.name,
      args = { ...(params.arguments || {}) };
    if (name === "prepare_localization") {
      let artifact: ReturnType<typeof prepareNativeLocalization>;
      try {
        if (!nativeLocalizationAccessAllowed(env.WORKSHOP_LOCALIZATION_PROTOCOL, nativeDevelopmentTask())) throw new Error("Локализация доступна только при поддержке текущего host-протокола и активной задаче native studio-development");
        artifact = prepareNativeLocalization(nativeLocalizationInputSchema.parse(args));
        ledger({ tool: name, status: "started", artifactHash: artifact.artifactHash, paths: Object.keys(artifact.sources) });
        await applyNativeLocalizationUnderLease(artifact, {
          lease,
          identity,
          studioState: async () => {
            const state = await upstream.tool("get_studio_state", { studio_id: studioId });
            if (state.isError) throw new Error("Studio недоступна для проверки Edit mode");
            return (state.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n");
          },
          apply: async (code) => {
            const result = await upstream.tool("execute_luau", { studio_id: studioId, datamodel_type: "Edit", code }, 20 * 60_000);
            if (result.isError) throw new Error((result.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n") || "Studio did not install the official localization objects");
          },
          probe: async (code) => {
            const result = await upstream.tool("execute_luau", { studio_id: studioId, datamodel_type: "Edit", code });
            const text = (result.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n");
            if (result.isError) throw new Error(text || "Studio did not report localization objects");
            return JSON.parse(text);
          },
          create: async (path, className, source) => {
            const result = await upstream.tool("multi_edit", {
              studio_id: studioId,
              datamodel_type: "Edit",
              className,
              file_path: "game." + path.split("/").join("."),
              edits: [{ old_string: "", new_string: source }],
            });
            if (result.isError) throw new Error((result.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n") || "Studio did not create " + path);
          },
        });
        ledger({
          tool: name, success: true, arguments: { sourceLocaleId: artifact.sourceLocaleId, entries: artifact.entries },
          generatedLocalization: artifact.data, generatedFiles: artifact.files,
          generatedSourceHashes: artifact.sourceHashes, artifactHash: artifact.artifactHash,
          paths: Object.keys(artifact.sources),
        });
        return { content: [{ type: "text", text: JSON.stringify({ sourceLocaleId: artifact.sourceLocaleId, entryCount: artifact.entries.length, artifactHash: artifact.artifactHash, paths: Object.keys(artifact.sources), sourceHashes: artifact.sourceHashes }) }] };
      } catch (error: any) {
        ledger({ tool: name, success: false, error: String(error?.message || error).slice(0, 1000) });
        throw error;
      }
    }
    if (
      validation &&
      !new Set([
        "list_roblox_studios",
        "list_skills",
        "skill",
        "inspect_instance",
        "search_game_tree",
        "script_search",
        "script_read",
        "script_grep",
        "screen_capture",
        "get_studio_state",
        "start_stop_play",
        "user_mouse_input",
        "user_keyboard_input",
        "character_navigation",
        "validation_control",
        ...(validationProfile === "sypho-skills" ? ["search_sfx", "probe_sfx"] : []),
        ...(validationProfile === "sypho-motion" ? ["motion_probe"] : []),
      ]).has(name)
    )
      throw new Error("Инструмент недоступен в профиле проверки навыков");
    if (name === "preview_visual_review") {
      z.object({}).strict().parse(args || {});
      if (
        !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/native\/visual-preview$/.test(
          env.WORKSHOP_PREVIEW_URL || "",
        )
      )
        throw new Error("Некорректный адрес предварительной проверки");
      const response = await fetch(env.WORKSHOP_PREVIEW_URL!, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + env.WORKSHOP_REVIEW_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ taskId }),
        signal: AbortSignal.timeout(600000),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error || "Предварительная проверка не выполнена");
      ledger({ tool: name, success: true, verdict: value.visualReview?.verdict });
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
    if (audioTools.some((tool) => tool.name === name)) {
      const records = () =>
        existsSync(resolve(traceRoot, "tools.jsonl"))
          ? readFileSync(resolve(traceRoot, "tools.jsonl"), "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [];
      // Provenance comes only from this task's host ledger, never from workspace files.
      const provenanceOf = (sha: string) =>
        records().find(
          (r) =>
            r.success &&
            ["fetch_open_sfx", "process_audio"].includes(r.tool) &&
            r.sha256 === sha,
        )?.provenance;
      const reply = (value: unknown) => ({
        content: [{ type: "text", text: JSON.stringify(value) }],
      });
      try {
        if (name === "find_open_sfx") {
          const result = await findOpenSfx(args);
          ledger({ tool: name, success: true, arguments: args, candidateIds: result.candidates.map((c) => c.id) });
          return reply(result);
        }
        if (name === "fetch_open_sfx") {
          const known = new Set<string>(
            records()
              .filter((r) => r.tool === "find_open_sfx" && r.success && r.attempt === attempt)
              .flatMap((r) => r.candidateIds || []),
          );
          const result = await fetchOpenSfx(args, workspace, known);
          ledger({ tool: name, success: true, ...result });
          return reply(result);
        }
        if (name === "process_audio") {
          const result = await processAudio(args, workspace, provenanceOf);
          ledger({ tool: name, success: true, ...result });
          return reply(result);
        }
        if (name === "listen_audio") {
          const result = await listenAudio(args, workspace);
          ledger({ tool: name, success: true, arguments: args });
          return reply(result);
        }
        if (name === "upload_audio") {
          const input = z
            .object({ path: z.string().min(1).max(300), displayName: z.string().trim().min(3).max(50) })
            .strict()
            .parse(args);
          const { file, rel } = audioFile(workspace, input.path);
          const sha = audioSha256(readFileSync(file));
          const provenance = provenanceOf(sha);
          if (!provenance)
            throw new Error("Загружать можно только звук, полученный через fetch_open_sfx или process_audio в этой задаче");
          lease();
          await identity();
          const cloud = async (method: string, endpoint: string, extra: any = {}) =>
            openCloudResult(
              await upstream.tool(
                "open_cloud_invoke",
                { studio_id: studioId, method, endpoint, ...extra },
                120000,
              ),
            );
          const done = records().find((r) => r.tool === name && r.success && r.sha256 === sha && r.assetId);
          if (done) return reply({ assetId: done.assetId, soundId: `rbxassetid://${done.assetId}` });
          let operationId = records().find(
            (r) => r.tool === name && r.status === "operation" && r.sha256 === sha,
          )?.operationId;
          if (!operationId) {
            const uploads = records().filter((r) => r.tool === name && r.status === "operation" && r.attempt === attempt);
            if (uploads.length >= 15) throw new Error("Лимит загрузок звука в попытке исчерпан (15)");
            const db = new DatabaseSync(env.WORKSHOP_DATABASE!, { readOnly: true });
            let universeId = "";
            try {
              const task = JSON.parse(String((db.prepare("SELECT body FROM records WHERE kind='task' AND id=?").get(taskId) as any)?.body || "null"));
              const project = task && JSON.parse(String((db.prepare("SELECT body FROM records WHERE kind='project' AND id=?").get(task.projectId) as any)?.body || "null"));
              universeId = String(project?.universeId || "");
            } finally {
              db.close();
            }
            if (!/^\d+$/.test(universeId)) throw new Error("Проект не привязан к опубликованному experience");
            const universe = await cloud("GET", `/cloud/v2/universes/${universeId}`, { scopes: ["universe:read"] });
            const owner = String(universe.json?.user || universe.json?.group || "");
            const creator = owner.startsWith("users/")
              ? { userId: owner.slice(6) }
              : owner.startsWith("groups/")
                ? { groupId: owner.slice(7) }
                : null;
            if (universe.status !== 200 || !creator) throw new Error("Не удалось определить владельца experience: " + universe.raw);
            const posted = await cloud("POST", "/assets/v1/assets", {
              body: JSON.stringify({
                request: {
                  assetType: "Audio",
                  displayName: input.displayName,
                  description: "Sound effect (" + provenance.license + ")",
                  creationContext: { creator },
                },
              }),
              files: [{ name: "fileContent", path: file }],
              scopes: ["asset:read", "asset:write"],
            });
            operationId = String(posted.json?.operationId || posted.json?.path || "").replace(/^operations\//, "");
            if (posted.status >= 300 || !operationId)
              throw new Error(
                "Загрузка звука отклонена: " +
                  posted.raw +
                  ". Владелец должен выдать Studio Assistant права asset:read/asset:write и разрешить папку рабочей области проекта в MCP Permissions.",
              );
            ledger({ tool: name, status: "operation", sha256: sha, path: rel, operationId });
          }
          for (let i = 0; i < 30; i++) {
            const op = await cloud("GET", `/assets/v1/operations/${operationId}`, { scopes: ["asset:read"] });
            if (op.json?.done) {
              const assetId = String(op.json?.response?.assetId || "");
              if (!/^\d+$/.test(assetId)) throw new Error("Загрузка звука завершилась ошибкой: " + op.raw);
              ledger({ tool: name, success: true, sha256: sha, path: rel, assetId, operationId, provenance });
              return reply({ assetId, soundId: `rbxassetid://${assetId}` });
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          return reply({ pending: true, operationId, note: "Загрузка ещё обрабатывается; повтори upload_audio для этого файла позже." });
        }
        if (name === "check_audio") {
          z.object({}).strict().parse(args || {});
          lease();
          await identity();
          const state = JSON.stringify(await upstream.tool("get_studio_state", { studio_id: studioId }));
          if (!state.includes("Client")) throw new Error("Запусти Play: check_audio проверяет звуки в работающей игре");
          const code = `local CP=game:GetService("ContentProvider") local P=game:GetService("Players").LocalPlayer local list={} local seen={}
local function scan(root) if not root then return end for _,d in ipairs(root:GetDescendants()) do if d:IsA("Sound") and d.SoundId~="" and not seen[d] and #list<300 then seen[d]=true table.insert(list,d) end end end
scan(workspace) scan(game:GetService("SoundService")) scan(game:GetService("ReplicatedStorage")) if P then scan(P) end
pcall(function() CP:PreloadAsync(list) end)
local deadline=os.clock()+10 for _,s in ipairs(list) do while not s.IsLoaded and os.clock()<deadline do task.wait(0.1) end end
local out={} for _,s in ipairs(list) do table.insert(out, s:GetFullName().."\\t"..s.SoundId.."\\t"..tostring(s.IsLoaded).."\\t"..string.format("%.2f", s.TimeLength).."\\t"..(s.SoundGroup and s.SoundGroup.Name or "")) end
return table.concat(out,"\\n")`;
          const result = await upstream.tool("execute_luau", { studio_id: studioId, datamodel_type: "Client", code }, 60000);
          const raw = (result.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
          if (result.isError) throw new Error(raw || "check_audio не выполнен");
          const sounds = raw
            .split("\n")
            .map((line: string) => line.split("\t"))
            .filter((p: string[]) => p.length >= 5)
            .map(([path, soundId, loaded, length, group]: string[]) => ({
              path: path!.slice(0, 200),
              soundId: soundId!.slice(0, 80),
              assetId: soundId!.match(/(\d{3,20})/)?.[1] || null,
              loaded: loaded === "true",
              timeLength: Number(length),
              soundGroup: group!.slice(0, 80),
            }));
          ledger({ tool: name, success: true, sounds });
          return reply({ count: sounds.length, sounds });
        }
      } catch (error: any) {
        ledger({ tool: name, success: false, error: String(error?.message || error).slice(0, 500) });
        throw error;
      }
    }
    if (name === "check_delivery") {
      z.object({}).strict().parse(args || {});
      if (
        !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/native\/check-delivery$/.test(
          env.WORKSHOP_CHECK_URL || "",
        )
      )
        throw new Error("Некорректный адрес самопроверки");
      const response = await fetch(env.WORKSHOP_CHECK_URL!, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + env.WORKSHOP_REVIEW_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ taskId }),
        signal: AbortSignal.timeout(30000),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error || "Самопроверка не выполнена");
      ledger({ tool: name, success: true, ok: value.ok });
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
    if (name === "ask_external_review") {
      if (!specialist || env.WORKSHOP_EXTERNAL_REVIEW !== "1")
        throw new Error("Внешний проверяющий не настроен");
      if (reviewAbort) throw new Error("Независимая проверка уже идёт");
      const input = z
        .object({
          instruction: z.string().min(3).max(20000),
          files: z.array(z.string()).max(8),
        })
        .strict()
        .parse(args);
      if (
        !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/native\/external-review$/.test(
          env.WORKSHOP_REVIEW_URL || "",
        )
      )
        throw new Error("Некорректный адрес локального проверяющего");
      reviewAbort = new AbortController();
      ledger({ tool: name, status: "started" });
      try {
        const response = await fetch(env.WORKSHOP_REVIEW_URL!, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + env.WORKSHOP_REVIEW_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...input, taskId }),
          signal: AbortSignal.any([
            reviewAbort.signal,
            AbortSignal.timeout(330000),
          ]),
        });
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error || "Независимая проверка не выполнена");
        lease();
        ledger({
          tool: name,
          success: true,
          model: value.model,
          usage: value.usage,
        });
        return { content: [{ type: "text", text: JSON.stringify(value) }] };
      } finally {
        reviewAbort = null;
      }
    }
    if (name === "ask_specialist") {
      if (!specialist) throw new Error("Политика специалистов не включена");
      return specialist.run(args);
    }
    if (name === "search_sfx") {
      let input: any;
      ledger({ tool: name, status: "started" });
      try {
        input = z
          .object({
            query: z.string().trim().min(1).max(120),
            limit: z.number().int().min(1).max(20),
          })
          .strict()
          .parse(args);
        ledger({ tool: name, status: "started", arguments: input });
        const skillHash = activeSfxSkill();
        const result = await searchSfx(input);
        lease();
        if (activeSfxSkill() !== skillHash)
          throw new Error("Закреплённый SFX навык изменился во время поиска");
        sfxCandidateIds = result.candidates.map((candidate: any) =>
          String(candidate.id),
        );
        ledger({
          tool: name,
          success: true,
          arguments: input,
          candidateCount: result.candidates.length,
          candidates: result.candidates,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error: any) {
        try {
          lease();
        } catch {}
        ledger({
          tool: name,
          success: false,
          arguments: input,
          error: String(error?.message || error).slice(0, 300),
        });
        throw error;
      }
    }
    if (name === "probe_sfx" || name === "validation_control" || name === "motion_probe") {
      if (!validationStudio)
        if (!motionStudio) throw new Error("Диагностический инструмент недоступен");
      lease();
      ledger({ tool: name, status: "started", arguments: args });
      try {
        if (name === "motion_probe") {
          if (!motionOwnedPlay) throw new Error("Motion probes require this task's verified Edit-to-Play transition");
          const action = args.action;
          if (!motionProbePhaseAllowed(action, motionPhase))
            throw new Error("Motion previews must run in the fixed capture-phase order");
        }
        const result = name === "motion_probe"
          ? await motionStudio!.motionProbe(args)
          : name === "probe_sfx"
            ? await validationStudio!.probeSfx(args)
            : await validationStudio!.validationControl(args);
        if (name === "motion_probe") {
          const action = args.action;
          motionPhase = action === "pose_rest" || action === "pose_action" || action === "mesh_sample" || action === "vfx"
            ? `${action === "pose_rest" ? "animation-rest" : action === "pose_action" ? "animation-action" : action === "mesh_sample" ? "mesh-preview" : "vfx-preview"}`
            : action === "create" ? "created" : "cleaned";
          const captureId = result?.phase;
          const lookAtPosition = result?.frame?.lookAtPosition ?? result?.frame?.cameraTarget;
          if (captureId && result?.frame?.cameraPosition && lookAtPosition)
            motionFrames.set(captureId, { cameraPosition: result.frame.cameraPosition, cameraTarget: lookAtPosition });
          if (action === "vfx") motionVfxPreviewAt = Date.now();
          if (action === "cleanup") motionCleanupVerified = result?.studioMode === "Play" && result?.removed === true && result?.verifiedAbsent === true;
        }
        if (name === "validation_control" && args.action === "before") motionBeforeChecked = true;
        lease();
        ledger({ tool: name, success: true, arguments: args, result });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error: any) {
        try {
          lease();
        } catch {}
        ledger({
          tool: name,
          success: false,
          arguments: args,
          error: String(error?.message || error).slice(0, 300),
        });
        throw error;
      }
    }
    if (
      validation &&
      [
        "user_mouse_input",
        "user_keyboard_input",
        "character_navigation",
      ].includes(name)
    )
      await requireValidationPlay();
    if (validationProfile === "sypho-motion" && name === "screen_capture") {
      await requireValidationPlay();
      const captureId = args.capture_id;
      const actionPhase: Record<string, string> = {
        "animation-rest": "animation-rest",
        "animation-action": "animation-action",
        "mesh-preview": "mesh-preview",
        "vfx-preview": "vfx-preview",
      };
      const expected = motionFrames.get(captureId);
      if (!actionPhase[captureId] || motionPhase !== actionPhase[captureId] || motionCaptures.has(captureId) || !expected ||
        JSON.stringify(args.camera_position) !== JSON.stringify(expected.cameraPosition) ||
        JSON.stringify(args.look_at_position) !== JSON.stringify(expected.cameraTarget))
        throw new Error("Motion capture must use its fixed live phase and host camera");
      if (captureId === "vfx-preview" && (!motionVfxPreviewAt || Date.now() - motionVfxPreviewAt > 15_000))
        throw new Error("The VFX live capture was outside the verified particle lifetime window");
    }
    if (name === "inspect_image") {
      try {
        const inspection = await inspectImage(
          workspace,
          traceRoot,
          args as any,
        );
        ledger({
          tool: name,
          success: true,
          asset: inspection.asset,
          sha256: inspection.sha256,
          kind: inspection.kind,
          preview: inspection.preview,
        });
        return { content: inspection.content };
      } catch (error: any) {
        ledger({
          tool: name,
          success: false,
          asset: args.path,
          error: error.message,
        });
        throw error;
      }
    }
    if (name === "draw_icon") {
      const icon = await drawIcon(workspace, args);
      const preview = randomBytes(12).toString("hex") + ".png";
      writeFileSync(
        resolve(traceRoot, preview),
        Buffer.from(icon.data, "base64"),
      );
      ledger({
        tool: name,
        preview,
        asset: icon.path,
        source: icon.svgPath,
        sha256: createHash("sha256")
          .update(Buffer.from(icon.data, "base64"))
          .digest("hex"),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ path: icon.path, source: icon.svgPath }),
          },
          { type: "image", data: icon.data, mimeType: "image/png" },
        ],
      };
    }
    if (!STUDIO_TOOLS.includes(name))
      throw new Error("Инструмент не разрешён для разработки игры");
    await identity();
    args.studio_id = studioId;
    if (name === "list_roblox_studios")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              studios: [{ id: studioId, name: env.WORKSHOP_STUDIO_NAME }],
            }),
          },
        ],
      };
    if (
      name === "http_get" &&
      !/^https:\/\/(create\.roblox\.com|developer\.roblox\.com)\//.test(
        args.url,
      )
    )
      throw new Error("Для документации разрешены официальные сайты Roblox");
    if (
      name === "execute_luau" &&
      /SavePlaceAsync|PublishPlace|SavePlaceToRoblox|HttpService[^\n]*RequestAsync/.test(
        args.code,
      )
    )
      throw new Error(
        "Публикация и внешняя передача данных не входят в разработку ассетов",
      );
    const multiplayer =
      name === "execute_luau" ? multiplayerTestProblem(args.code) : null;
    if (multiplayer) {
      ledger({ tool: name, success: false, error: multiplayer });
      throw new Error(multiplayer);
    }
    const original = structuredClone(args);
    const uploadedImages: Array<{
      path: string;
      sha256: string;
      inspectionSha256: string;
      inspectionKind: string;
    }> = [];
    if (name === "store_image")
      args.filePath = insideWorkspace(workspace, args.filePath);
    if (name === "upload_image") {
      if (!Array.isArray(args.imagePaths) || !args.imagePaths.length) {
        ledger({ tool: name, success: false, error: "No PNG paths supplied" });
        throw new Error(
          "Для загрузки укажите PNG; каждый файл нужно проверить через inspect_image",
        );
      }
      const records = existsSync(resolve(traceRoot, "tools.jsonl"))
        ? readFileSync(resolve(traceRoot, "tools.jsonl"), "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
      let checked: Array<{
        path: string;
        sha256: string;
        inspectionSha256: string;
        inspectionKind: string;
        data: Buffer;
      }>;
      try {
        checked = args.imagePaths.map((path: string) =>
          verifyInspectedImage(workspace, path, records),
        );
      } catch (error: any) {
        ledger({ tool: name, success: false, error: error.message });
        throw error;
      }
      const uploadUrls: string[] = [];
      for (const image of checked) {
        const data = readFileSync(insideWorkspace(workspace, image.path));
        if (createHash("sha256").update(data).digest("hex") !== image.sha256) {
          ledger({
            tool: name,
            success: false,
            error: `PNG changed during upload preparation: ${image.path}`,
          });
          throw new Error(
            `PNG changed during upload preparation; inspect_image again: ${image.path}`,
          );
        }
        uploadedImages.push({
          path: image.path,
          sha256: image.sha256,
          inspectionSha256: image.inspectionSha256,
          inspectionKind: image.inspectionKind,
        });
        const url = "/" + randomBytes(24).toString("hex") + ".png";
        files.set(url, data);
        uploadUrls.push(`http://127.0.0.1:${port}${url}`);
      }
      args.imagePaths = uploadUrls;
    }
    let viewport: any;
    if (name === "screen_capture" && validationProfile !== "sypho-motion") {
      const state = await upstream.tool("get_studio_state", {
        studio_id: studioId,
      });
      const dm = JSON.stringify(state).includes("Available DataModels: Edit")
        ? "Edit"
        : "Client";
      const captured = await upstream.tool("execute_luau", {
        studio_id: studioId,
        datamodel_type: dm,
        // A frame shot while textures and meshes still download shows grey
        // parts that are not defects: wait (bounded) for the content queue.
        code: "local s=game:GetService('StudioDeviceSimulatorService') local c=workspace.CurrentCamera local r={device=s:GetDeviceAsync(),width=c and c.ViewportSize.X,height=c and c.ViewportSize.Y} pcall(function() local cp=game:GetService('ContentProvider') local t=os.clock() while cp.RequestQueueSize>0 and os.clock()-t<5 do task.wait(0.1) end if cp.RequestQueueSize>0 then r.pendingAssets=cp.RequestQueueSize end end) return r",
      });
      if (!captured.isError) {
        try {
          viewport = JSON.parse(
            captured.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n"),
          );
        } catch {}
      }
    }
    let playModeBefore: "Edit" | "Play" | undefined;
    if (validationProfile === "sypho-motion" && name === "start_stop_play") {
      const before = await upstream.tool("get_studio_state", { studio_id: studioId });
      const text = (before.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n");
      playModeBefore = /Current Studio Mode\s*:\s*Edit\b/i.test(text) ? "Edit" : /Current Studio Mode\s*:\s*Play\b/i.test(text) ? "Play" : undefined;
      if (args.is_start === true && (!motionBeforeChecked || playModeBefore !== "Edit")) throw new Error("Motion validation may start only from the verified Edit session");
      if (args.is_start === false && (!motionOwnedPlay || !motionCleanupVerified || motionPhase !== "cleaned" || playModeBefore !== "Play")) throw new Error("Motion validation may stop only its cleaned owned Play session");
    }
    if (
      name.startsWith("generate_") ||
      name === "upload_image" ||
      name === "screen_capture"
    )
      ledger({ tool: name, status: "started" });
    const result = await upstream.tool(name, args, 20 * 60_000);
    if (name === "screen_capture" && viewport?.pendingAssets > 0 && !result.isError)
      result.content = [
        ...(result.content || []),
        {
          type: "text",
          text: `Внимание: ${viewport.pendingAssets} ассетов ещё загружались в момент кадра. Серые или пустые части на нём могут быть незагруженными текстурами: дождись загрузки и сними кадр заново под новым capture_id.`,
        },
      ];
    let playModeAfter: "Edit" | "Play" | undefined;
    if (validationProfile === "sypho-motion" && name === "start_stop_play") {
      await identity();
      const after = await upstream.tool("get_studio_state", { studio_id: studioId });
      const text = (after.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n");
      playModeAfter = /Current Studio Mode\s*:\s*Edit\b/i.test(text) ? "Edit" : /Current Studio Mode\s*:\s*Play\b/i.test(text) ? "Play" : undefined;
      if (result.isError || (args.is_start === true && playModeAfter !== "Play") || (args.is_start === false && playModeAfter !== "Edit")) throw new Error("Studio did not confirm the requested motion Play transition");
      if (args.is_start === true) motionOwnedPlay = playModeBefore === "Edit" && playModeAfter === "Play";
      else motionOwnedPlay = false;
    }
    if (
      validation &&
      [
        "user_mouse_input",
        "user_keyboard_input",
        "character_navigation",
      ].includes(name)
    ) {
      lease();
      await identity();
      lease();
    }
    const captures: string[] = [];
    for (const c of result.content || [])
      if (name === "screen_capture" && c.type === "image") {
        const file =
          randomBytes(12).toString("hex") +
          (c.mimeType === "image/jpeg" ? ".jpg" : ".png");
        writeFileSync(resolve(traceRoot, file), Buffer.from(c.data, "base64"));
        captures.push(file);
      }
    if (validationProfile === "sypho-motion" && name === "screen_capture" && captures.length) {
      motionCaptures.add(args.capture_id);
      motionPhase = `${args.capture_id}-captured`;
    }
    ledger({
      tool: name,
      arguments: original,
      success: !result.isError,
      captureRecordId:
        name === "screen_capture" ? randomBytes(12).toString("hex") : undefined,
      images:
        name === "upload_image" && !result.isError ? uploadedImages : undefined,
      captures,
      viewport,
      ...(playModeBefore ? { playModeBefore } : {}),
      ...(playModeAfter ? { playModeAfter, ownedStart: args.is_start === true && playModeBefore === "Edit" && playModeAfter === "Play" } : {}),
      result:
        name === "upload_image" ||
        name.startsWith("generate_") ||
        name === "wait_job_finished"
          ? result.content?.filter((c: any) => c.type === "text")
          : undefined,
      ...(validation &&
      name === "execute_luau"
        ? {
            resultText: (result.content || [])
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n")
              .slice(0, 30000),
          }
        : {}),
    });
    return result;
  };
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id === undefined) return;
    void handle(msg.method, msg.params || {})
      .then((result) =>
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
        ),
      )
      .catch((error) =>
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result:
              msg.method === "tools/call"
                ? {
                    isError: true,
                    content: [{ type: "text", text: error.message }],
                  }
                : undefined,
            ...(msg.method !== "tools/call"
              ? { error: { code: -32603, message: error.message } }
              : {}),
          }) + "\n",
        ),
      );
  });
  let closing = false;
  const motionOwnerCurrent = () => {
    const db = new DatabaseSync(env.WORKSHOP_DATABASE!, { readOnly: true });
    try {
      const get = (kind: string, key: string) => {
        const row = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, key);
        return row ? JSON.parse(row.body as string) : null;
      };
      const task = get("task", taskId);
      const session = task && get("nativeSession", task.projectId);
      const context = get("skillValidationContext", taskId);
      return task?.validationProfile === "sypho-motion" && task.attempt === attempt && session?.taskId === taskId && context?.taskId === taskId && context?.projectId === task.projectId;
    } finally { db.close(); }
  };
  const close = () => {
    if (closing) return;
    closing = true;
    void (async () => {
      if (motionStudio && motionOwnerCurrent() && motionOwnedPlay) {
        try {
          const result = await motionStudio.cleanupOnShutdown();
          if (result) {
            const clean = result.verifiedAbsent === true && Array.isArray(result.remaining) && result.remaining.length === 0 && ((result.studioMode === "Play" && result.removed === true) || (result.studioMode === "Edit" && result.removed === false));
            ledger({ tool: "motion_probe", success: clean, arguments: { action: "cleanup" }, result });
            if (!clean) throw new Error("Motion cleanup did not verify owned names absent");
            if (result.studioMode === "Play") {
              if (!motionOwnerCurrent()) throw new Error("Motion cleanup owner changed before Play stop");
              await identity();
              const state = await upstream.tool("get_studio_state", { studio_id: studioId });
              const stateText = (state.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n");
              if (/Current Studio Mode\s*:\s*Play\b/i.test(stateText)) {
                const listing: any = await upstream.call("tools/list", {});
                const stopTool = listing.tools?.find((tool: any) => tool.name === "start_stop_play");
                if (stopTool?.inputSchema?.properties?.is_start) {
                  if (!motionOwnerCurrent()) throw new Error("Motion task/attempt changed before Play stop");
                  await identity();
                  if (!motionOwnerCurrent()) throw new Error("Motion task/attempt changed immediately before Play stop");
                  const stopped = await upstream.tool("start_stop_play", { studio_id: studioId, is_start: false });
                  const afterStop = await upstream.tool("get_studio_state", { studio_id: studioId });
                  const afterText = (afterStop.content || []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n");
                  const stoppedInEdit = !stopped?.isError && /Current Studio Mode\s*:\s*Edit\b/i.test(afterText);
                  ledger({ tool: "start_stop_play", success: stoppedInEdit, arguments: { is_start: false }, result: stoppedInEdit ? "stopped after owned cleanup" : undefined, playModeBefore: "Play", playModeAfter: stoppedInEdit ? "Edit" : undefined });
                }
              }
            }
          }
        } catch (error: any) {
          ledger({ tool: "motion_probe", success: false, arguments: { action: "cleanup" }, error: String(error?.message || error).slice(0, 300) });
        }
      }
    specialist?.close();
    reviewAbort?.abort();
    upstream.close();
    server.close();
    process.exit(0);
    })();
  };
  lines.on("close", close);
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  serve().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });

import type { Project, Task } from "../shared/domain.js";
import { now } from "../shared/domain.js";
import { Store, id } from "./store.js";
import { Vault } from "./vault.js";
import { reserve, settle, releaseReservation } from "./budget.js";
import { z } from "zod";
export const providerConfigSchema = z.object({
  model: z.string().min(1),
  organization: z.string().optional(),
  project: z.string().optional(),
  inputMicrosPerMillion: z.number().nonnegative(),
  outputMicrosPerMillion: z.number().nonnegative(),
  imageMicrosMax: z.number().int().positive().optional(),
  speechMicrosPerMillionChars: z.number().positive().optional(),
  source: z.url(),
  verifiedAt: z.iso.datetime(),
});
export class OpenAIProvider {
  constructor(
    private store: Store,
    private vault: Vault,
  ) {}
  async generate(
    p: Project,
    input: {
      operation: "responses" | "image" | "speech";
      prompt: string;
      maxOutputTokens?: number;
      taskId?: string;
    },
  ) {
    if (!p.budget.approved)
      throw new Error(
        "Сначала согласуйте бюджет, включая подготовительные генерации",
      );
    const pricing = providerConfigSchema.parse(
      this.store.get<any>("setting", "openai-pricing")?.value,
    );
    if (Date.now() - Date.parse(pricing.verifiedAt) > 30 * 86400000)
      throw new Error("Обновите подтверждённые цены провайдера");
    if (p.settings.freeCreditsOnly) {
      const grants = this.store
        .all<any>("grant")
        .filter(
          (g) =>
            g.eligibleForResponses === true &&
            g.remaining > 0 &&
            g.expiresAt &&
            Date.parse(g.expiresAt) > Date.now() &&
            Date.now() - Date.parse(g.verifiedAt) < 3600000,
        );
      if (input.operation !== "responses" || !grants.length)
        throw new Error(
          "Нет свежего подтверждения достаточных применимых бесплатных кредитов",
        );
    }
    const key = await this.vault.get("openai-generation");
    if (!key) throw new Error("Подключите отдельный ключ генерации OpenAI API");
    const outputTokens = Math.min(
      16000,
      Math.max(1, input.maxOutputTokens || 4000),
    );
    // UTF-8 bytes bound the text-token count conservatively. Media uses an explicit worst-case reserve.
    let estimate = Math.ceil(
      (Buffer.byteLength(input.prompt) * pricing.inputMicrosPerMillion +
        outputTokens * pricing.outputMicrosPerMillion) /
        1e6,
    );
    if (input.operation === "image") {
      if (!pricing.imageMicrosMax)
        throw new Error("Не согласована максимальная цена изображения");
      estimate = pricing.imageMicrosMax;
    }
    if (input.operation === "speech") {
      if (!pricing.speechMicrosPerMillionChars)
        throw new Error("Не согласована цена озвучки");
      estimate = Math.ceil(
        (input.prompt.length * pricing.speechMicrosPerMillionChars) / 1e6,
      );
    }
    if (p.settings.freeCreditsOnly) {
      const prior = this.store
        .all<any>("ledger")
        .filter((r) => r.projectId === p.id && r.provider === "openai")
        .reduce(
          (sum, r) => sum + (r.kind === "release" ? -r.micros : r.micros),
          0,
        );
      const available = this.store
        .all<any>("grant")
        .filter(
          (g) =>
            g.eligibleForResponses === true &&
            g.expiresAt &&
            Date.parse(g.expiresAt) > Date.now() &&
            Date.now() - Date.parse(g.verifiedAt) < 3600000,
        )
        .reduce((s, g) => s + (g.remaining || 0) * 1e6, 0);
      if (available - prior < estimate)
        throw new Error("Применимых кредитов недостаточно для резерва");
    }
    const t: Task = {
      id: input.taskId || id(),
      projectId: p.id,
      title: "Прямая генерация OpenAI API",
      role: "assets",
      kind: input.operation,
      status: "running",
      baseRevision: p.revision,
      dependencies: [],
      scope: [],
      instructions: input.prompt,
      attempt: 1,
      maxAttempts: 1,
      estimateMicros: estimate,
      provider: "openai",
      threadId: null,
      turnId: null,
      accountId: null,
      skills: [],
      createdAt: now(),
      updatedAt: now(),
      startedAt: now(),
      error: null,
      result: null,
      reservationId: null,
    };
    if (this.store.get("providerOperation", t.id))
      throw new Error("Операция уже существует. Сначала сверьте её результат.");
    t.reservationId = reserve(this.store, p, t);
    this.store.put("providerOperation", {
      id: t.id,
      projectId: p.id,
      status: "sent",
      task: t,
    });
    let safeFailure = false;
    try {
      const operation = input.operation;
      const endpoint =
        operation === "responses"
          ? "responses"
          : operation === "image"
            ? "images/generations"
            : "audio/speech";
      const body =
        operation === "responses"
          ? {
              model: pricing.model,
              input: input.prompt,
              max_output_tokens: outputTokens,
              store: false,
            }
          : operation === "image"
            ? {
                model: pricing.model,
                prompt: input.prompt,
                n: 1,
                size: "1024x1024",
              }
            : {
                model: pricing.model,
                input: input.prompt,
                voice: "alloy",
                response_format: "mp3",
              };
      const r = await fetch("https://api.openai.com/v1/" + endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          "X-Client-Request-Id": t.id,
          ...(pricing.organization
            ? { "OpenAI-Organization": pricing.organization }
            : {}),
          ...(pricing.project ? { "OpenAI-Project": pricing.project } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      safeFailure = r.status >= 400 && r.status < 500;
      if (!r.ok) {
        if (r.status === 429)
          throw new Error(
            "API: временный лимит или исчерпанные средства (HTTP 429). Автоматическое переключение и бесконечные повторы выключены.",
          );
        throw new Error("OpenAI API HTTP " + r.status);
      }
      let result: any;
      let actual = estimate;
      if (operation === "speech") {
        const data = Buffer.from(await r.arrayBuffer());
        this.store.file(`providers/${t.id}/speech.mp3`, data);
        result = {
          file: `providers/${t.id}/speech.mp3`,
          costStatus: "conservative_estimate",
        };
      } else {
        const data = await r.json();
        if (operation === "responses") {
          const usage = data.usage || {};
          if (
            typeof usage.input_tokens !== "number" ||
            typeof usage.output_tokens !== "number"
          )
            throw new Error("Нет подтверждённого usage в ответе API");
          actual = Math.ceil(
            (usage.input_tokens * pricing.inputMicrosPerMillion +
              usage.output_tokens * pricing.outputMicrosPerMillion) /
              1e6,
          );
          result = {
            responseId: data.id,
            text: data.output
              ?.flatMap((i: any) => i.content || [])
              .filter((c: any) => c.type === "output_text")
              .map((c: any) => c.text)
              .join("\n"),
            usage,
            costStatus: "usage_based_estimate",
          };
        } else {
          const image = data.data?.[0]?.b64_json;
          if (!image)
            throw new Error("API не вернул изображение в ожидаемом формате");
          this.store.file(
            `providers/${t.id}/image.png`,
            Buffer.from(image, "base64"),
          );
          result = {
            file: `providers/${t.id}/image.png`,
            costStatus: "conservative_estimate",
          };
        }
      }
      settle(this.store, t, actual, r.headers.get("x-request-id") || t.id);
      this.store.put("providerOperation", {
        id: t.id,
        projectId: p.id,
        status: "succeeded",
        task: t,
        result,
        completedAt: now(),
      });
      this.store.event(p.id, "provider.result", {
        id: t.id,
        operation,
        chargedMicros: actual,
        costStatus: result.costStatus,
      });
      return result;
    } catch (e) {
      const uncertain = !safeFailure;
      this.store.put("providerOperation", {
        id: t.id,
        projectId: p.id,
        status: uncertain ? "uncertain" : "failed",
        task: t,
        error: (e as Error).message,
      });
      if (!uncertain) releaseReservation(this.store, t);
      throw e;
    }
  }
}

import { z } from "zod";
import study from "../docs/research/roblox-name-study.json";
export const NAMING_POLICY_VERSION = "roblox-context-naming-v1";
export const namingStudy = study;
export const projectNameSchema = z
  .string()
  .trim()
  .min(2, "Введите название от 2 символов")
  .max(100, "Название должно быть не длиннее 100 символов")
  .refine(
    (name) => !/[\u0000-\u001F\u007F]/.test(name),
    "Название должно быть одной строкой без управляющих символов",
  );
export const nameSuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(2)
          .max(48)
          .regex(/^[A-Za-z0-9][A-Za-z0-9 '&:!\-]*$/),
        direction: z.enum(["action", "outcome", "brand"]),
        reason: z.string().trim().min(10).max(350),
      }),
    )
    .length(5),
});
export type NameSuggestion = z.infer<
  typeof nameSuggestionsSchema
>["suggestions"][number];
export interface NameSuggestionsResult {
  id: string;
  suggestions: NameSuggestion[];
  checkedAt: string;
  policyVersion: string;
}
export const normalizeName = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function validateNameSuggestions(
  input: unknown,
  excluded: string[] = [],
): NameSuggestion[] {
  const parsed = nameSuggestionsSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("ИИ вернул некорректный список. Запросите варианты снова.");
  const { suggestions } = parsed.data;
  const forbidden = new Set(
    [...study.games.map((g) => g.baseName), ...excluded].map(normalizeName),
  );
  const seen = new Set<string>();
  for (const s of suggestions) {
    const normalized = normalizeName(s.name);
    if (forbidden.has(normalized) || seen.has(normalized))
      throw new Error(
        "ИИ повторил существующее название. Запросите новые варианты.",
      );
    if (
      s.name.split(/\s+/).length > 6 ||
      s.name === s.name.toUpperCase() ||
      /robux|free\s+money|free\s+roblox/i.test(s.name)
    )
      throw new Error(
        "ИИ вернул название вне выбранного стиля. Запросите новые варианты.",
      );
    seen.add(normalized);
  }
  return suggestions;
}

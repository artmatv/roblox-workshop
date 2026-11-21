import type { Check, Role } from "./domain.js";

export interface DevelopmentStatus {
  gameLanguage: {
    version: number;
    sourceLocaleId: string;
    provider: string;
    automaticTranslation: boolean;
  };
  skills: Array<{
    id: string;
    version: string | null;
    hash: string | null;
    roles: Role[];
    status: "ready" | "missing" | "disabled" | "changed" | "unreviewed";
  }>;
  localization: {
    required: boolean;
    revision: number | null;
    status: Check["status"] | "not_built" | "needs_update";
    entries: number;
    evidence: string | null;
    reason: string | null;
    csv: string | null;
    setup: string | null;
  };
}

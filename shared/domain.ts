import type {
  EffortClass,
  EffortRun,
  ReasoningEffort,
} from "./effort-policy.js";
import { z } from "zod";
import { stages, roles } from "./vocabulary.js";
import type {
  ProductionPlan,
  ProductionProgress,
} from "./production-plan.js";
export { stages, roles, labels } from "./vocabulary.js";
export type Role = (typeof roles)[number];
export type Execution =
  | "idle"
  | "running"
  | "decision"
  | "studio"
  | "quota"
  | "funds"
  | "paused"
  | "error"
  | "complete";
export type TaskStatus =
  | "planned"
  | "dependencies"
  | "queued"
  | "running"
  | "reviewing"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";
export const checkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  required: z.boolean(),
  status: z.enum(["passed", "failed", "blocked", "not_run"]),
  evidence: z.string().nullable(),
  device: z.string().optional(),
});
export type Check = z.infer<typeof checkSchema>;
export const instanceSchema = z.object({
  // A real scene names its instances freely ("Potters' Row", "Bench-1:12",
  // mesh names taken from a description). Paths are XML-escaped on export and
  // split only on "/", so a name may hold anything but a path separator or a
  // control character: an allowlist here only rejected finished milestones.
  path: z
    .string()
    .regex(
      /^(Workspace|ReplicatedStorage|ServerScriptService|ServerStorage|StarterGui|StarterPlayer|Lighting|SoundService)(\/[^\/\\\x00-\x1f]+)*$/,
    ),
  className: z.string().regex(/^\w+$/),
  properties: z.record(z.string(), z.unknown()).default({}),
  source: z.string().max(500_000).optional(),
});
export const manifestSchema = z.object({
  summary: z.string().min(1),
  deletions: z.array(z.string()).max(2000).default([]),
  files: z
    .array(
      z.object({ path: z.string().min(1), content: z.string().max(1_000_000) }),
    )
    .max(200)
    .default([]),
  instances: z.array(instanceSchema).max(2000).default([]),
  checks: z.array(checkSchema).default([]),
  findings: z
    .array(
      z.object({
        severity: z.enum(["blocker", "minor", "info"]),
        message: z.string(),
      }),
    )
    .default([]),
  data: z.record(z.string(), z.unknown()).default({}),
});
// Real Studio snapshots can exceed the smaller AI deliverable limit.
export const snapshotManifestSchema = manifestSchema.extend({
  // The GeneWorks scene had 7,942 instances at its tenth milestone.
  instances: z.array(instanceSchema).max(30000).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;
export interface Project {
  id: string;
  name: string;
  genre: string;
  goal: string;
  stage: (typeof stages)[number];
  execution: Execution;
  revision: number;
  createdAt: string;
  updatedAt: string;
  universeId: string;
  placeId: string;
  studioId: string | null;
  settings: {
    agentPolicy?: "sol-luna-astra-v1" | "legacy";
    productionMode?: "single-owner" | "distributed";
    parallelism: number;
    maxAttempts: number;
    timeoutMinutes: number;
    dailyLimitMicros: number;
    autoResumeQuota: boolean;
    // Owner's permission to keep working on the account's credits after the
    // included quota is used up, while the balance stays above this number.
    // Absent or null: never spend credits.
    creditsFloor?: number | null;
    // Owner's permission to redeem a free rate-limit reset when the included
    // quota is used up long before its own reset.
    autoResetLimits?: boolean;
    // A milestone is accepted only after the workshop itself has run the
    // game's test module in Play for every plan item with "test" evidence.
    testAcceptance?: boolean;
    apiFallback: boolean;
    freeCreditsOnly: boolean;
    model: string | null;
  };
  budget: {
    limitMicros: number;
    approved: boolean;
    estimate: string;
    stageLimits: Record<string, number>;
    providerLimits: Record<string, number>;
  };
  approvals: Record<string, { revision: number; hash: string; at: string }>;
  concept: string;
  specification: string;
  productionPlan?: ProductionPlan;
  productionProgress?: ProductionProgress;
  specificationArtifact?: {
    taskId: string;
    reviewId: string;
    hash: string;
    file: string;
  };
  requiredChecks: string[];
  selectedStyle: string | null;
  styleVersion: number;
  skillPins: Record<string, string>;
}
export interface Task {
  id: string;
  projectId: string;
  title: string;
  role: Role;
  kind: string;
  validationProfile?: "sypho-skills" | "sypho-motion";
  status: TaskStatus;
  baseRevision: number;
  requirementsHash?: string;
  reviewId?: string;
  sourceTaskId?: string;
  repairOfTaskId?: string;
  milestoneId?: string;
  // Owner notes are acceptance items for both reviewers, not only developer hints.
  ownerNotes?: string[];
  reviewerFaults?: number;
  integrationBaseId?: string;
  supersededByTaskId?: string;
  previewStyleId?: string;
  previewStyleHash?: string;
  previewBaseTaskId?: string;
  previewBaseHash?: string;
  dependencies: string[];
  scope: string[];
  instructions: string;
  effortClass?: EffortClass;
  effortOverride?: ReasoningEffort | null;
  effortOverrideReason?: string;
  effortRun?: EffortRun;
  // Follow-up turns started in the same attempt because check_delivery failed.
  formalContinue?: { attempt: number; count: number };
  // Follow-up turns started in the same attempt because the visual review
  // found no defect, only items it could not see on the frames.
  evidenceContinue?: { attempt: number; count: number };
  // Acceptance tests the workshop runs itself on the snapshot taken after the
  // visual review: ids already passed on that snapshot in this attempt.
  testRun?: { attempt: number; snapshotId: string; passed: string[] };
  // Milestone tasks started automatically after this milestone ran out of attempts.
  autoContinued?: number;
  // Last review rejection: later blocks overwrite error, not these findings.
  rejection?: string | null;
  timeWarnedAttempt?: number;
  // Set when the owner pauses a running turn, read once by fail().
  pausedAt?: string;
  effortHistory?: EffortRun[];
  attempt: number;
  maxAttempts: number;
  estimateMicros: number;
  provider: "codex" | "openai" | "studio" | "llmass";
  threadId: string | null;
  turnId: string | null;
  accountId: string | null;
  skills: Array<{ id: string; version: string; hash: string }>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  error: string | null;
  result: Manifest | null;
  reservationId: string | null;
}
export interface Version {
  id: string;
  projectId: string;
  revision: number;
  hash: string;
  createdAt: string;
  reason: string;
  manifest: Manifest;
  specification: string;
  concept: string;
  styleId: string | null;
  styleVersion: number;
  skillPins: Record<string, string>;
  checks: Check[];
  phone: { device: string; at: string; passed: boolean; notes: string } | null;
  findings: Manifest["findings"];
  assets: Array<{ id: string; required: boolean; status: string }>;
}
export interface StudioConnection {
  id: string;
  projectId: string | null;
  name: string;
  placeId: string;
  universeId: string;
  version: number;
  fingerprint: string;
  lastSeen: string;
  capabilities: string[];
  stopped: boolean;
  playMode?: boolean;
  documentId?: string;
  replacedBy?: string;
}
export interface Command {
  id: string;
  projectId: string;
  studioId: string;
  taskId: string;
  baseRevision: number;
  targetRevision: number;
  operation: "snapshot" | "apply" | "test" | "capture" | "import" | "restore";
  payload: Record<string, unknown>;
  status:
    | "queued"
    | "sent"
    | "succeeded"
    | "failed"
    | "uncertain"
    | "cancelled";
  createdAt: string;
  sentAt: string | null;
  result: Record<string, unknown> | null;
  expectedFingerprint: string;
}
export interface Feedback {
  id: string;
  projectId: string;
  revision: number;
  text: string;
  target: string;
  priority: string;
  status: string;
  taskIds: string[];
  attachments: Array<{ file: string; x?: number; y?: number }>;
  createdAt: string;
}
export interface Metric {
  id: string;
  projectId: string;
  releaseId: string | null;
  date: string;
  metric: string;
  value: number | null;
  source: string;
  fetchedAt: string;
  unit: string;
}
export interface Skill {
  id: string;
  name: string;
  source: string;
  path: string;
  version: string;
  hash: string;
  license: string;
  checkedAt: string | null;
  dependencies: string[];
  capabilities: string[];
  roles: Role[];
  status:
    | "discovered"
    | "reviewed"
    | "installed"
    | "connected"
    | "incompatible"
    | "disabled";
  instructions: string;
}
export interface StyleFamily {
  id: string;
  name: string;
  world: string;
  ui: string;
  references: Array<{ name: string; url: string }>;
  palette: string[];
  geometry: string;
}
export interface StylePackage {
  id: string;
  projectId: string;
  familyId: string;
  version: number;
  name: string;
  status: "concept" | "studio" | "approved";
  rules: Record<string, unknown>;
  references: Array<{
    game: string;
    author: string;
    url: string;
    checkedAt: string;
    device: string;
    screen: string;
    observations: string;
    confidence: string;
  }>;
  previews: Array<{
    screen: string;
    device: string;
    file: string;
    kind: string;
  }>;
  studioEvidence: string | null;
  sourceTaskId?: string;
  supersededAt?: string;
  previewTaskId?: string;
}
export interface Ledger {
  id: string;
  projectId: string;
  taskId: string;
  kind: "reservation" | "charge" | "release";
  micros: number;
  provider: string;
  stage: string;
  createdAt: string;
  externalId: string | null;
}
export interface Release {
  id: string;
  projectId: string;
  revision: number;
  hash: string;
  placeId: string;
  universeId: string;
  status:
    | "draft"
    | "approved"
    | "publishing"
    | "published"
    | "uncertain"
    | "failed";
  approvedAt: string | null;
  acceptedMinorIssues: string[];
  createdAt: string;
  result: Record<string, unknown> | null;
}
export const now = () => new Date().toISOString();

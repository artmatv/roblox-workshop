import { existsSync } from "node:fs";
import type { DevelopmentStatus } from "../shared/development.js";
import type { Project, Skill, Version } from "../shared/domain.js";
import { Store, hash, safePath } from "./store.js";
import { DEFAULT_SKILL_IDS } from "./default-skills.js";
import {
  assertGameLocalizationReady,
  GAME_LANGUAGE_POLICY,
} from "./game-localization.js";

// Report the pinned packages and the actual build; a configured policy is not a passed test.
export function developmentStatus(
  store: Store,
  project: Project,
  version?: Version,
): DevelopmentStatus {
  const skills = DEFAULT_SKILL_IDS.map((defaultId) => {
    const id =
      defaultId === "roblox-ui" && project.skillPins["roblox-gui"]
        ? "roblox-gui"
        : defaultId;
    const pin = project.skillPins[id];
    const current = store.get<Skill>("skill", id);
    const skill =
      current?.hash === pin
        ? current
        : store.get<Skill>("skillArchive", `${id}:${pin}`);
    let status: DevelopmentStatus["skills"][number]["status"] = "ready";
    if (current?.status === "disabled") status = "disabled";
    else if (!pin || !skill) status = "missing";
    else if (hash(skill.instructions) !== pin) status = "changed";
    else if (
      !skill.checkedAt ||
      !["reviewed", "connected", "incompatible"].includes(skill.status)
    )
      status = "unreviewed";
    return {
      id,
      version: skill?.version || null,
      hash: pin || null,
      roles: skill?.roles || [],
      status,
    };
  });
  const localization: DevelopmentStatus["localization"] = {
    required: project.requiredChecks.includes("localization"),
    revision: null,
    status: "not_built",
    entries: 0,
    evidence: null,
    reason: null,
    csv: null,
    setup: null,
  };
  if (version && version.revision > 0) {
    localization.revision = version.revision;
    try {
      assertGameLocalizationReady(version.manifest);
      localization.entries = (
        version.manifest.data.localization as { entries: unknown[] }
      ).entries.length;
      const check = version.checks.find((check) => check.id === "localization");
      localization.status =
        check?.status === "passed" && !check.evidence
          ? "not_run"
          : check?.status || "not_run";
      localization.evidence = check?.evidence || null;
      for (const [key, relative] of [
        ["csv", "localization/en-us.csv"],
        ["setup", "localization/ROBLOX_SETUP.md"],
      ] as const) {
        const path = `projects/${project.id}/versions/${version.revision}/${relative}`;
        if (
          version.manifest.files.some((file) => file.path === relative) &&
          existsSync(safePath(store.root, path))
        )
          localization[key] = path;
      }
    } catch (error) {
      localization.status = "needs_update";
      localization.reason = (error as Error).message;
    }
  }
  return { gameLanguage: GAME_LANGUAGE_POLICY, skills, localization };
}

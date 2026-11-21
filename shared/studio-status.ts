import type { StudioConnection } from "./domain.js";

export function studioOnline(
  studio: StudioConnection | undefined,
  at = Date.now(),
) {
  return (
    !!studio &&
    !studio.stopped &&
    !studio.replacedBy &&
    Number.isFinite(Date.parse(studio.lastSeen)) &&
    at - Date.parse(studio.lastSeen) < 15000
  );
}

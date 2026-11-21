import { resolve } from "node:path";
import { Store } from "../server/store.js";
const s = new Store(resolve(import.meta.dirname, "../data"));
try {
  const command = s
    .all<any>("command")
    .filter((c) => c.projectId === process.argv[2])
    .at(-1);
  if (!command) throw new Error("No command");
  console.log(
    JSON.stringify(
      {
        id: command.id,
        operation: command.operation,
        status: command.status,
        fingerprint: command.result?.fingerprint,
        error: command.result?.error,
        checks: command.result?.checks?.map((c: any) => ({
          id: c.id,
          status: c.status,
          device: c.device,
          errors: [
            ...String(c.evidence || "").matchAll(
              /"(?:errors|failures|cameraErrors)"\s*:\s*\[([^\]]*)\]/g,
            ),
          ]
            .map((m) => m[1])
            .filter(Boolean)
            .slice(0, 12),
          evidence:
            c.status !== "passed"
              ? String(c.evidence || "").slice(0, 500)
              : undefined,
        })),
        findings: command.result?.findings,
        logs: command.result?.logs?.slice(-5),
      },
      null,
      2,
    ),
  );
} finally {
  s.close();
}

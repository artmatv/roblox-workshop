// Keep actionable failures even when a client report contains thousands of layout rectangles.
export function checkDiagnostics(check: {
  id: string;
  status: string;
  evidence?: string | null;
}) {
  const observations: unknown[] = [];
  for (const [index, raw] of String(check.evidence || "")
    .split("; mobile: ")
    .entries()) {
    try {
      const data = JSON.parse(raw),
        errors = new Set<string>();
      let visited = 0;
      const walk = (value: any, path: string, depth: number) => {
        if (
          !value ||
          typeof value !== "object" ||
          depth > 12 ||
          visited++ > 50000
        )
          return;
        for (const [key, child] of Object.entries(value)) {
          if (
            /(?:errors|failures)$|^(?:missingSources|reasons|failedChecks)$/i.test(
              key,
            ) &&
            Array.isArray(child)
          )
            for (const error of child)
              if (errors.size < 40)
                errors.add(path + key + ": " + String(error).slice(0, 350));
          if (child && typeof child === "object")
            walk(child, path + key + ".", depth + 1);
        }
      };
      walk(data, "", 0);
      observations.push({
        device: data.device || (index ? "mobile" : "desktop"),
        viewport: data.viewport,
        errors: [...errors],
        ...(!errors.size ? { excerpt: raw.slice(0, 1400) } : {}),
      });
    } catch {
      observations.push({ evidence: raw.slice(0, 1400) });
    }
  }
  return { id: check.id, status: check.status, observations };
}

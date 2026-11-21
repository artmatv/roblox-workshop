import { resolve } from "node:path";
import { Store } from "../server/store.js";
const s = new Store(resolve(import.meta.dirname, "../data"));
const t = s.get<any>("task", process.argv[2]);
const msg = s.get<any>("agentMessage", process.argv[2]);
if (msg) {
  const result = JSON.parse(msg.text);
  console.log(
    JSON.stringify(
      {
        summary: result.summary,
        instances: result.instances.length,
        forbidden: result.instances.flatMap((i: any) => {
          const p = JSON.parse(i.propertiesJson);
          return ["Name", "Parent", "Source"]
            .filter((k) => k in p)
            .map((k) => ({
              path: i.path,
              key: k,
              value: k === "Source" ? "source text" : p[k],
            }));
        }),
        files: result.files.map((f: any) => f.path),
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify(
    { status: t?.status, error: t?.error, attempt: t?.attempt },
    null,
    2,
  ),
);
s.close();

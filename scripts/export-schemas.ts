import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  manifestSchema,
  instanceSchema,
  checkSchema,
} from "../shared/domain.js";
import { agentOutputSchema } from "../server/engine.js";
const dir = resolve(import.meta.dirname, "../protocol");
mkdirSync(dir, { recursive: true });
for (const [name, schema] of Object.entries({
  manifest: manifestSchema,
  instance: instanceSchema,
  check: checkSchema,
})) {
  writeFileSync(
    resolve(dir, name + ".schema.json"),
    JSON.stringify(z.toJSONSchema(schema), null, 2),
  );
}
writeFileSync(
  resolve(dir, "agent-output.schema.json"),
  JSON.stringify(agentOutputSchema, null, 2),
);

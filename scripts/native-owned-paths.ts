import { resolve } from "node:path";
import { Store } from "../server/store.js";
import type { Task } from "../shared/domain.js";
const s = new Store(resolve(import.meta.dirname, "../data"));
try {
  const task = s.get<Task>("task", process.argv[2]);
  if (!task?.result?.instances.length) throw new Error("No accepted scene");
  console.log(
    JSON.stringify(
      task.result.instances
        .filter((i) => i.path.includes("/"))
        .map((i) => i.path),
    ),
  );
} finally {
  s.close();
}

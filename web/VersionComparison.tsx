import React, { useEffect, useState } from "react";
import type { Version } from "../shared/domain";
type Change = { path: string; before: unknown; after: unknown };
// Instances are compared on the server: the project view carries manifests
// without them.
export function VersionComparison({
  versions,
  load,
}: {
  versions: Version[];
  load: (from: string, to: string) => Promise<{ changes: Change[] }>;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [changes, setChanges] = useState<Change[] | null>(null);
  const a = versions.length > 1 ? versions.find((v) => v.id === (from || versions[1].id)) : undefined,
    b = versions.length > 1 ? versions.find((v) => v.id === (to || versions[0].id)) : undefined;
  useEffect(() => {
    if (!a || !b) return;
    let current = true;
    setChanges(null);
    load(a.id, b.id).then(
      (r) => current && setChanges(r.changes),
      () => current && setChanges([]),
    );
    return () => {
      current = false;
    };
  }, [a?.id, b?.id]);
  if (!a || !b) return null;
  return (
    <section className="card">
      <h2>Сравнение версий</h2>
      <div className="grid two">
        <label>
          До
          <select value={a.id} onChange={(e) => setFrom(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.revision} · {v.reason}
              </option>
            ))}
          </select>
        </label>
        <label>
          После
          <select value={b.id} onChange={(e) => setTo(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.revision} · {v.reason}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        {a.specification === b.specification
          ? "Спецификация сохранена."
          : "Спецификация изменилась."}{" "}
        {a.styleId === b.styleId && a.styleVersion === b.styleVersion
          ? "Пакет стиля сохранён."
          : "Пакет стиля изменился."}{" "}
        {changes ? `Затронуто объектов: ${changes.length}.` : "Сравниваем…"}
      </p>
      {(changes || []).map((k) => (
        <details key={k.path}>
          <summary>
            {!k.before ? "Добавлен" : !k.after ? "Удалён" : "Изменён"} · {k.path}
          </summary>
          <div className="grid two">
            <pre>{JSON.stringify(k.before, null, 2)}</pre>
            <pre>{JSON.stringify(k.after, null, 2)}</pre>
          </div>
        </details>
      ))}
    </section>
  );
}

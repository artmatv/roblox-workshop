import { useState } from "react";
import { FileText, Pencil, Download, Check } from "lucide-react";

export function SpecificationDocument({
  text,
  reviewed,
  source,
  onSave,
  onDownload,
}: {
  text: string;
  reviewed: boolean;
  source?: string;
  onSave: (text: string) => Promise<unknown>;
  onDownload?: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(text),
    [saving, setSaving] = useState(false);
  return (
    <div className="specification-document">
      <div className="section-title document-toolbar">
        <span className={"badge " + (reviewed ? "good" : "")}>
          {reviewed ? <Check size={14} /> : <FileText size={14} />}
          {reviewed ? "Проверено оркестратором" : "Документ проекта"}
        </span>
        <div className="button-row">
          {onDownload && (
            <button onClick={onDownload}>
              <Download size={15} /> Скачать SPEC.md
            </button>
          )}
          {!editing && (
            <button
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              <Pencil size={15} /> Редактировать
            </button>
          )}
        </div>
      </div>
      {source && <p className="muted document-source">{source}</p>}
      {editing ? (
        <>
          <textarea
            className="spec-editor"
            aria-label="Спецификация игры"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={24}
          />
          <div className="button-row">
            <button
              className="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  if (await onSave(draft)) setEditing(false);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Сохранить документ
            </button>
            <button disabled={saving} onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </>
      ) : text ? (
        <article
          className="spec-document"
          aria-label="Полный документ спецификации"
        >
          <DocumentBody text={text} />
        </article>
      ) : (
        <p className="soft-note">
          Готовая спецификация появится здесь после проверки оркестратором.
        </p>
      )}
    </div>
  );
}

function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
function DocumentBody({ text }: { text: string }) {
  const lines = text.replaceAll("\r\n", "\n").split("\n"),
    blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const start = i++,
        code: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={start}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const content = inline(heading[2]);
      blocks.push(
        heading[1].length === 1 ? (
          <h3 key={i}>{content}</h3>
        ) : heading[1].length === 2 ? (
          <h4 key={i}>{content}</h4>
        ) : (
          <h5 key={i}>{content}</h5>
        ),
      );
      i++;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3}/.test(lines[i + 1] || "")) {
      const start = i,
        cells = (s: string) =>
          s
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((v) => v.trim()),
        header = cells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(cells(lines[i++]));
      blocks.push(
        <div className="document-table" key={start}>
          <table>
            <thead>
              <tr>
                {header.map((h, j) => (
                  <th key={j}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j}>
                  {row.map((cell, k) => (
                    <td key={k}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const start = i,
        items: string[] = [],
        ordered = /^\s*\d+\./.test(line),
        pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && pattern.test(lines[i]))
        items.push(lines[i++].replace(pattern, ""));
      const children = items.map((item, j) => <li key={j}>{inline(item)}</li>);
      blocks.push(
        ordered ? (
          <ol key={start}>{children}</ol>
        ) : (
          <ul key={start}>{children}</ul>
        ),
      );
      continue;
    }
    const start = i,
      paragraph: string[] = [lines[i++]];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])
    )
      paragraph.push(lines[i++]);
    blocks.push(<p key={start}>{inline(paragraph.join(" "))}</p>);
  }
  return <>{blocks}</>;
}

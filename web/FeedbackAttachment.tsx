import React, { useState, useEffect } from "react";
export type MarkedImage = { file: string; x?: number; y?: number };
export function FeedbackAttachment({
  run,
  onChange,
}: {
  run: any;
  onChange: (v: MarkedImage[]) => void;
}) {
  const [image, setImage] = useState<MarkedImage | null>(null),
    [url, setUrl] = useState("");
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <div>
      <label>
        Изображение референса или скриншот
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void run(async () => {
              const data = new Uint8Array(await f.arrayBuffer());
              let raw = "";
              for (const n of data) raw += String.fromCharCode(n);
              const r = await fetch("/api/attachments", {
                method: "POST",
                headers: {
                  Authorization:
                    "Bearer " + sessionStorage.getItem("automation-token"),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ dataBase64: btoa(raw), mime: f.type }),
              });
              const result = await r.json();
              if (!r.ok) throw new Error(result.error);
              const img = { file: result.file };
              setImage(img);
              onChange([img]);
              setUrl(URL.createObjectURL(f));
            }, "Изображение сохранено. Можно отметить нужное место.");
          }}
        />
      </label>
      {url && image && (
        <>
          <p className="muted">
            Нажмите на изображение, чтобы отметить элемент.
          </p>
          <button
            type="button"
            className="annotation"
            aria-label="Отметить элемент на скриншоте"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const marked = {
                ...image,
                x: (e.clientX - rect.left) / rect.width,
                y: (e.clientY - rect.top) / rect.height,
              };
              setImage(marked);
              onChange([marked]);
            }}
          >
            <img src={url} alt="Скриншот для замечания" />
            {image.x !== undefined && (
              <span
                style={{
                  left: image.x * 100 + "%",
                  top: (image.y || 0) * 100 + "%",
                }}
              >
                +
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ImageOff, Palette, X } from "lucide-react";

export function AssetPreview({
  path,
  endpoint,
  device,
  label = "Предпросмотр оформления",
  mode = "screen",
}: {
  path?: string;
  endpoint?: string;
  device?: string;
  label?: string;
  mode?: "screen" | "icon" | "sheet";
}) {
  const [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true,
      objectUrl = "";
    const controller = new AbortController();
    setUrl("");
    setFailed(false);
    const resource =
      endpoint || (path ? "/api/files?" + new URLSearchParams({ path }) : "");
    if (resource)
      void fetch(resource, {
        headers: {
          Authorization:
            "Bearer " + (sessionStorage.getItem("automation-token") || ""),
        },
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("Preview unavailable");
          return response.blob();
        })
        .then((blob) => {
          const next = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(next);
            return;
          }
          objectUrl = next;
          setUrl(next);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, endpoint]);
  return url ? (
    <>
      <button
        className={`preview-open ${device === "mobile" ? "mobile" : ""} ${mode === "icon" ? "preset-icon" : ""}`}
        onClick={() => dialog.current?.showModal()}
        aria-label={`Рассмотреть: ${label}`}
      >
        <img className="preview" src={url} alt={label} />
      </button>
      <dialog className="preview-dialog" ref={dialog} aria-label={label}>
        <button onClick={() => dialog.current?.close()} autoFocus>
          Закрыть <X size={16} />
        </button>
        <img src={url} alt={label} />
      </dialog>
    </>
  ) : (
    <div
      className={`preview placeholder ${mode === "icon" ? "preset-icon" : ""}`}
      aria-label={label}
    >
      {failed ? <ImageOff size={25} /> : <Palette size={25} />}
      {mode !== "icon" && (
        <span>
          {failed ? "Не удалось загрузить изображение" : "Загрузка оформления…"}
        </span>
      )}
    </div>
  );
}

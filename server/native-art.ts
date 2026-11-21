import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { safePath } from "./store.js";

const digest = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

export function assertImagesInspected(
  images: Array<{ path: string; sha256: string }>,
  records: any[],
) {
  const inspected = new Set(
    records
      .filter((r) => r.tool === "inspect_image" && r.success)
      .map((r) => `${r.asset}\0${r.sha256}`),
  );
  for (const image of images)
    if (!inspected.has(`${image.path}\0${image.sha256}`))
      throw new Error(
        `Inspect the exact current PNG with inspect_image before upload_image: ${image.path}`,
      );
}

export function verifyInspectedImage(
  workspace: string,
  path: string,
  records: any[],
) {
  const normalizedPath = path.replace(/\\/g, "/"),
    file = safePath(workspace, normalizedPath),
    data = readFileSync(file),
    sha256 = digest(data);
  if (
    data.length > 20_000_000 ||
    data.length < 33 ||
    data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("Для загрузки нужен PNG до 20 МБ из рабочей папки");
  assertImagesInspected([{ path: normalizedPath, sha256 }], records);
  return {
    path: normalizedPath,
    sha256,
    data,
    inspectionSha256: sha256,
    inspectionKind: records.find(
      (r) =>
        r.tool === "inspect_image" &&
        r.success &&
        r.asset === normalizedPath &&
        r.sha256 === sha256,
    ).kind as string,
  };
}

export async function inspectImage(
  workspace: string,
  traceRoot: string,
  args: { path: string; kind: "icon" | "texture" },
) {
  if (
    typeof args.path !== "string" ||
    isAbsolute(args.path) ||
    !args.path.toLowerCase().endsWith(".png") ||
    !["icon", "texture"].includes(args.kind)
  )
    throw new Error("Укажите относительный PNG и тип icon или texture");
  const normalizedPath = args.path.replace(/\\/g, "/"),
    source = safePath(workspace, normalizedPath),
    original = readFileSync(source),
    sha256 = digest(original);
  if (
    original.length > 20_000_000 ||
    original.length < 33 ||
    original.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("Для проверки нужен PNG до 20 МБ");
  const width = original.readUInt32BE(16),
    height = original.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16_000_000
  )
    throw new Error("Размер PNG должен быть не больше 4096 px и 16 Мп");

  const sourceUrl = `data:image/png;base64,${original.toString("base64")}`;
  const panels =
    args.kind === "icon"
      ? [
          ["Оригинал · светлый фон", "#f3f3f3", "original"],
          ["Оригинал · тёмный фон", "#242424", "original"],
          ["32 px · светлый фон", "#f3f3f3", "icon32"],
          ["48 px · тёмный фон", "#242424", "icon48"],
        ]
      : [
          ["Оригинал", "#333", "original"],
          ["Повтор 2×2", "#333", "tile"],
        ];
  const aspect = width / height,
    frameWidth = Math.min(400, 300 * aspect),
    frameHeight = frameWidth / aspect;
  const cards = panels
    .map(
      ([label, bg, mode]) =>
        `<section><label>${label}</label><div class="sample ${mode}" style="background:${bg};--framew:${frameWidth}px;--frameh:${frameHeight}px">${mode === "tile" ? Array.from({ length: 4 }, () => `<img src="${sourceUrl}">`).join("") : `<img src="${sourceUrl}">`}</div></section>`,
    )
    .join("");
  const browser = await chromium.launch({ headless: true });
  let previewData: Buffer;
  let previewLayout: any;
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: args.kind === "icon" ? 560 : 420 },
    });
    await page.route("**/*", (route) =>
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.setContent(
      `<html><style>*{box-sizing:border-box}body{margin:0;padding:18px;background:#ddd;font:14px sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:14px}section{height:${args.kind === "icon" ? 250 : 360}px;background:#fff;padding:10px;border-radius:8px}label{display:block;height:24px;font-weight:bold}.sample{height:calc(100% - 24px);display:flex;align-items:center;justify-content:center;overflow:hidden}.sample img{object-fit:contain;max-width:100%;max-height:100%}.sample.original img{width:min(100%,var(--framew));height:min(100%,var(--frameh))}.sample.icon32 img{width:32px;height:32px}.sample.icon48 img{width:48px;height:48px}.sample.tile{display:grid;width:min(100%,var(--framew));height:min(100%,var(--frameh));margin:auto;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;background:#555}.sample.tile img{width:100%;height:100%;object-fit:fill}</style><body>${cards}</body></html>`,
    );
    await page.locator("img").first().waitFor();
    await page.evaluate(async () =>
      Promise.all(Array.from(document.images, (image) => image.decode())),
    );
    previewLayout = await page.evaluate((kind) => {
      if (kind === "icon") {
        const rect32 = document
            .querySelector(".icon32 img")!
            .getBoundingClientRect(),
          rect48 = document
            .querySelector(".icon48 img")!
            .getBoundingClientRect();
        return {
          icon32: { width: rect32.width, height: rect32.height },
          icon48: { width: rect48.width, height: rect48.height },
          backgrounds: ["light", "dark"],
        };
      }
      const rects = Array.from(
        document.querySelectorAll(".tile img"),
        (image) => {
          const { x, y, width, height, right, bottom } =
            image.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        },
      );
      return {
        tile: {
          columns: 2,
          rows: 2,
          cellAspectRatio: rects[0].width / rects[0].height,
          horizontalGap: rects[1].x - rects[0].right,
          verticalGap: rects[2].y - rects[0].bottom,
        },
      };
    }, args.kind);
    previewData = await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
  if (digest(readFileSync(safePath(workspace, normalizedPath))) !== sha256)
    throw new Error(
      "PNG изменился во время проверки; запустите inspect_image ещё раз",
    );
  const trace = realpathSync(traceRoot),
    preview = `${randomBytes(12).toString("hex")}.png`,
    previewFile = resolve(trace, preview),
    rel = relative(trace, previewFile);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Недопустимый путь предпросмотра");
  writeFileSync(previewFile, previewData!, { flag: "wx" });
  return {
    asset: normalizedPath,
    kind: args.kind,
    sha256,
    preview,
    previewLayout,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          path: args.path,
          kind: args.kind,
          sha256,
          preview,
        }),
      },
      {
        type: "image",
        data: previewData!.toString("base64"),
        mimeType: "image/png",
      },
    ],
  };
}

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_FILE = 8 * 1024 * 1024;
// Bytes one reviewer call may receive.
export const MAX_TOTAL = 40 * 1024 * 1024;
// Images one reviewer call receives: ~200 KB / ~2.5k tokens each keeps a call
// under MAX_TOTAL and inside the reviewer's context.
export const MAX_VISUAL_FRAMES = 96;
// A planned milestone can need far more frames than one call holds (m04 needed
// ~175: tutorial steps, every species in motion, rebuild flow, phone windows),
// so the review runs in passes, each with the required views plus whole items.
export const MAX_REVIEW_PASSES = 3;

// Deterministic split of acceptance items into reviewer passes, shared by
// check_delivery and the reviewer. Each pass gets the required views plus the
// targeted frames of its items; an item never spans passes. `images` counts
// images per capture id (one record may hold several).
export function planVisualBatches(
  items: Array<{ item: string; captureIds: string[] }>,
  requiredIds: string[],
  images: (captureId: string) => number = () => 1,
) {
  const capacity =
    MAX_VISUAL_FRAMES - requiredIds.reduce((n, id) => n + images(id), 0);
  const batches: Array<{ items: string[]; captureIds: string[]; images: number }> = [];
  for (const { item, captureIds } of items) {
    const own = [...new Set(captureIds)].filter((id) => !requiredIds.includes(id));
    const size = own.reduce((n, id) => n + images(id), 0);
    if (size > capacity)
      throw new Error(
        `пункт ${item}: ${size} целевых кадров, один проход проверки получает не больше ${capacity} — объединяй близкие состояния в один кадр`,
      );
    let batch = own.length ? batches.at(-1) : batches[0];
    const added = batch ? own.filter((id) => !batch!.captureIds.includes(id)) : own;
    const extra = added.reduce((n, id) => n + images(id), 0);
    if (!batch || batch.images + extra > capacity) {
      batch = { items: [], captureIds: [], images: 0 };
      batches.push(batch);
    }
    batch.items.push(item);
    for (const id of own)
      if (!batch.captureIds.includes(id)) {
        batch.captureIds.push(id);
        batch.images += images(id);
      }
  }
  if (batches.length > MAX_REVIEW_PASSES)
    throw new Error(
      `кадры пунктов требуют ${batches.length} проходов проверки по ${capacity} целевых, максимум ${MAX_REVIEW_PASSES} — объединяй близкие состояния в один кадр или убери лишние кадры`,
    );
  return batches;
}
const MAX_PIXELS = 16_000_000;
const MAX_DIMENSION = 4096;
export type VisualFrame = {
  captureId: string;
  captureRecordId: string;
  label: string;
  source: string;
  path: string;
  sha256: string;
  viewport?: unknown;
  camera?: unknown;
};

function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function traceDirectory(path: string) {
  const abs = resolve(path);
  const stat = lstatSync(abs);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(abs) !== abs)
    throw new Error("Каталог трассировки проходит через ссылку");
  return abs;
}
function dimensions(data: Buffer) {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    data.readUInt32BE(8) === 13 &&
    data.toString("ascii", 12, 16) === "IHDR"
  ) {
    let offset = 8,
      hasData = false,
      ended = false;
    while (offset + 12 <= data.length) {
      const size = data.readUInt32BE(offset),
        type = data.toString("ascii", offset + 4, offset + 8);
      if (size > data.length - offset - 12) throw new Error("Обрезан PNG кадр");
      if (type === "IDAT") hasData = true;
      offset += size + 12;
      if (type === "IEND") {
        ended = size === 0;
        break;
      }
    }
    if (!hasData || !ended) throw new Error("PNG кадр не завершён");
    return {
      format: "png",
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }
  if (
    data.length < 6 ||
    data[0] !== 0xff ||
    data[1] !== 0xd8 ||
    data[data.length - 2] !== 0xff ||
    data[data.length - 1] !== 0xd9
  )
    throw new Error("Кадр не является PNG или JPEG");
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset++] !== 0xff) throw new Error("Повреждён JPEG кадр");
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (
      [0xd8, 0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(
        marker,
      )
    )
      continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (length < 7) throw new Error("Повреждён JPEG заголовок");
      const scan = data.indexOf(Buffer.from([0xff, 0xda]), offset + length);
      if (scan < 0 || scan + 4 > data.length - 2)
        throw new Error("В JPEG кадре нет данных изображения");
      return {
        format: "jpeg",
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw new Error("В JPEG кадре нет размеров изображения");
}
function validateFile(root: string, path: string) {
  const abs = resolve(path);
  if (!within(root, abs))
    throw new Error("Кадр находится вне каталога трассировки");
  const st = lstatSync(abs);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.nlink !== 1 ||
    st.size > MAX_FILE
  )
    throw new Error("Кадр должен быть обычным файлом до 8 MB без ссылок");
  if (realpathSync(abs) !== abs)
    throw new Error("Путь кадра проходит через ссылку");
  const bytes = readFileSync(abs);
  if (bytes.length > MAX_FILE) throw new Error("Кадр превышает предел 8 MB");
  const image = dimensions(bytes);
  if (
    !image.width ||
    !image.height ||
    image.width > MAX_DIMENSION ||
    image.height > MAX_DIMENSION ||
    image.width * image.height > MAX_PIXELS
  )
    throw new Error("Размеры кадра превышают допустимый предел");
  return { abs, bytes, ...image };
}

export function selectVisualFrames(
  records: any[],
  taskId: string,
  attempt: number,
  requiredIds = [
    "world-desktop", "hud-desktop", "shop-desktop", "collection-desktop", "hud-mobile",
  ],
  // Targeted ids the delivery assigns to acceptance items: kept first, the
  // remaining slots go to the most recent other targeted frames.
  preferredIds: string[] = [],
) {
  const latest = new Map<string, any>();
  for (const [index, record] of records.entries()) {
    if (
      record.tool !== "screen_capture" ||
      !record.success ||
      record.taskId !== taskId ||
      record.attempt !== attempt
    )
      continue;
    const id = record.arguments?.capture_id;
    if (
      typeof id === "string" &&
      typeof record.captureRecordId === "string" &&
      /^[a-f0-9]{24}$/.test(record.captureRecordId) &&
      Array.isArray(record.captures) &&
      record.captures.length
    )
      latest.set(id, { record, index });
  }
  const required = requiredIds;
  for (const id of required)
    if (!latest.has(id))
      throw new Error(`Нет свежего кадра ${id} текущей попытки`);
  const selected = required.map((id) => latest.get(id)!.record);
  const candidates = [...latest.entries()]
    .filter(([id]) => /^(?:closeup|visual)-[A-Za-z0-9._-]{1,100}$/.test(id))
    .sort((a, b) => a[1].index - b[1].index);
  // With a delivery map the reviewer gets exactly the assigned frames (split
  // into passes); without one, the most recent targeted frames for one pass.
  const limit = MAX_VISUAL_FRAMES - required.length;
  const preferred = new Set(preferredIds);
  const keep = new Set(
    candidates.filter(([id]) => preferred.has(id)).map(([id]) => id),
  );
  if (!keep.size)
    for (const [id] of [...candidates].reverse()) {
      if (keep.size >= limit) break;
      keep.add(id);
    }
  const targeted = candidates
    .filter(([id]) => keep.has(id))
    .map(([, item]) => item.record);
  for (const record of targeted)
    if (!selected.includes(record)) selected.push(record);
  const frames = selected.flatMap((record) =>
    record.captures.map((source: string) => ({
      captureId: String(record.arguments.capture_id),
      captureRecordId: record.captureRecordId,
      label: String(record.arguments.capture_id),
      source,
      viewport: record.viewport,
      camera: {
        position: record.arguments?.camera_position ?? record.camera?.position,
        lookAt: record.arguments?.look_at_position ?? record.camera?.lookAt,
      },
    })),
  );
  if (frames.some((frame) => frame.captureId.length > 120))
    throw new Error("Идентификатор кадра слишком длинный");
  if (
    frames.some(
      (frame) =>
        Buffer.byteLength(
          JSON.stringify({ viewport: frame.viewport, camera: frame.camera }),
          "utf8",
        ) > 4096,
    )
  )
    throw new Error("Метаданные ракурса слишком велики");
  if (frames.length > MAX_VISUAL_FRAMES * MAX_REVIEW_PASSES)
    throw new Error("Слишком много кадров для независимой визуальной проверки");
  return frames;
}

export function copyVisualFrames(
  traceRoot: string,
  records: any[],
  taskId: string,
  attempt: number,
  requiredIds?: string[],
  reviewerWorkspace?: string,
  preferredIds: string[] = [],
): VisualFrame[] {
  const root = traceDirectory(traceRoot);
  const copyRoot = reviewerWorkspace
    ? resolve(reviewerWorkspace)
    : root;
  if (reviewerWorkspace) {
    const stat = lstatSync(copyRoot);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(copyRoot) !== copyRoot
    )
      throw new Error("Workspace проверяющего проходит через ссылку");
  }
  const selected = selectVisualFrames(records, taskId, attempt, requiredIds, preferredIds);
  if (
    selected.some(
      (frame) =>
        typeof frame.source !== "string" ||
        !frame.source ||
        isAbsolute(frame.source) ||
        frame.source.includes("\\") ||
        frame.source
          .split("/")
          .some((part: string) => !part || part === "." || part === ".."),
    )
  )
    throw new Error("Путь кадра должен быть безопасным относительным путём");
  const checked = selected.map((frame) => {
    const candidate = resolve(root, frame.source);
    if (!within(root, candidate))
      throw new Error("Кадр выходит за каталог трассировки");
    const validated = validateFile(root, candidate);
    return {
      ...frame,
      ...validated,
      sha256: createHash("sha256").update(validated.bytes).digest("hex"),
    };
  });
  const total = checked.reduce((sum, item) => sum + item.bytes.length, 0);
  if (total > MAX_TOTAL * MAX_REVIEW_PASSES)
    throw new Error("Объём кадров превышает 120 MB");
  const reviewRoot = resolve(
    copyRoot,
    `.visual-review-${randomBytes(12).toString("hex")}`,
  );
  mkdirSync(reviewRoot, { recursive: false, mode: 0o700 });
  const created: string[] = [];
  try {
    return checked.map((frame, index) => {
      const ext = frame.format === "png" ? ".png" : ".jpg";
      const path = resolve(
        reviewRoot,
        `${String(index + 1).padStart(2, "0")}${ext}`,
      );
      writeFileSync(path, frame.bytes, { flag: "wx", mode: 0o600 });
      created.push(path);
      return {
        captureId: frame.captureId,
        captureRecordId: frame.captureRecordId,
        label: frame.label,
        source: frame.source,
        path,
        sha256: frame.sha256,
        viewport: frame.viewport,
        camera: frame.camera,
      };
    });
  } catch (error) {
    for (const path of created) unlinkSync(path);
    rmdirSync(reviewRoot);
    throw error;
  }
}

export function cleanupVisualFrames(workspace: string, frames: VisualFrame[]) {
  if (!frames.length) return;
  const workspaceRoot = resolve(workspace);
  if (realpathSync(workspaceRoot) !== workspaceRoot)
    throw new Error("Workspace проверяющего проходит через ссылку");
  const reviewRoot = resolve(frames[0]!.path, "..");
  const rel = relative(workspaceRoot, reviewRoot);
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !/^\.visual-review-[a-f0-9]{24}$/.test(rel)
  )
    throw new Error("Каталог кадров проверяющего вне его workspace");
  const dirStat = lstatSync(reviewRoot);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
    throw new Error("Каталог кадров проверяющего повреждён");
  for (const frame of frames) {
    if (resolve(frame.path, "..") !== reviewRoot)
      throw new Error("Кадры проверяющего находятся в разных каталогах");
    const stat = lstatSync(frame.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("Кадр проверяющего больше не является обычным файлом");
    unlinkSync(frame.path);
  }
  rmdirSync(reviewRoot);
}

export function verifyVisualFrames(
  traceRoot: string,
  frames: VisualFrame[],
  reviewerWorkspace?: string,
) {
  const root = traceDirectory(traceRoot);
  for (const frame of frames) {
    const source = resolve(root, frame.source);
    if (!within(root, source))
      throw new Error("Исходный кадр вышел за каталог трассировки");
    const sourceFile = validateFile(root, source);
    const sourceSha = createHash("sha256").update(sourceFile.bytes).digest("hex");
    if (sourceSha !== frame.sha256)
      throw new Error(`Кадр ${frame.captureId} изменился во время проверки`);
    const copy = resolve(frame.path);
    const copyRoot = reviewerWorkspace ? resolve(reviewerWorkspace) : root;
    if (!within(copyRoot, copy))
      throw new Error("Копия кадра вышла из каталога проверяющего");
    const reviewDir = resolve(copy, "..");
    const reviewRel = relative(copyRoot, reviewDir);
    if (
      !/^\.visual-review-[a-f0-9]{24}$/.test(reviewRel) ||
      isAbsolute(reviewRel)
    )
      throw new Error("Каталог копии кадра вне workspace проверяющего");
    const copyFile = validateFile(copyRoot, copy);
    const copySha = createHash("sha256").update(copyFile.bytes).digest("hex");
    if (copySha !== frame.sha256)
      throw new Error(`Кадр ${frame.captureId} изменился во время проверки`);
  }
}

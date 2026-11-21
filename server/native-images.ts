import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const MAX = 20_000_000;
function within(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith("..\\") &&
    !rel.startsWith("../") &&
    !isAbsolute(rel)
  );
}
function regularNoLinks(path: string) {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1)
    throw new Error("Image file must be a regular unlinked file");
  return st;
}
export function stageGeneratedImage(input: {
  threadId: string;
  item: any;
  workspace: string;
  traceRoot: string;
  codexHome?: string;
}) {
  const { item, threadId } = input;
  if (
    typeof threadId !== "string" ||
    !threadId ||
    threadId.includes("/") ||
    threadId.includes("\\") ||
    threadId === "." ||
    threadId === ".."
  )
    throw new Error("Invalid image generation thread");
  if (
    item?.type !== "imageGeneration" ||
    item.status !== "completed" ||
    item.failure ||
    typeof item.id !== "string" ||
    !item.id ||
    item.id.includes("/") ||
    item.id.includes("\\") ||
    item.id === "." ||
    item.id === ".." ||
    typeof item.savedPath !== "string" ||
    !isAbsolute(item.savedPath)
  )
    throw new Error("Image generation is incomplete or missing its saved file");
  const imageRoot = resolve(
    input.codexHome || process.env.CODEX_HOME || join(homedir(), ".codex"),
    "generated_images",
    threadId,
  );
  const realRoot = realpathSync(imageRoot);
  if (realRoot !== imageRoot)
    throw new Error("Generated image directory contains a link");
  const source = resolve(item.savedPath);
  if (!within(realRoot, source) || !within(imageRoot, source))
    throw new Error("Generated image is outside the task image directory");
  const realSource = realpathSync(source);
  if (realSource !== source || !within(realRoot, realSource))
    throw new Error("Generated image path contains a link or traversal");
  const stat = regularNoLinks(source);
  if (!stat.size || stat.size > MAX)
    throw new Error("Generated PNG is empty or exceeds 20 MB");
  const bytes = readFileSync(source);
  if (
    bytes.length !== stat.size ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.length < 45 ||
    bytes.subarray(12, 16).toString() !== "IHDR" ||
    bytes.subarray(-8, -4).toString() !== "IEND"
  )
    throw new Error("Generated image is not a complete PNG");
  const workspace = resolve(input.workspace);
  if (realpathSync(workspace) !== workspace)
    throw new Error("Workspace root contains a link");
  const assets = resolve(workspace, "assets");
  mkdirSync(assets, { recursive: true });
  if (realpathSync(assets) !== assets || !within(workspace, assets))
    throw new Error("Asset destination escapes workspace");
  const name = `generated-${createHash("sha256").update(String(item.id)).digest("hex")}.png`;
  const dest = resolve(assets, name);
  if (!within(workspace, dest))
    throw new Error("Asset destination escapes workspace");
  const existingAsset = lstatMaybe(dest);
  if (existingAsset) {
    regularNoLinks(dest);
    if (!readFileSync(dest).equals(bytes))
      throw new Error("Existing generated image differs from saved output");
  } else writeFileSync(dest, bytes, { flag: "wx" });
  regularNoLinks(dest);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const traceFile = `image-${createHash("sha256").update(String(item.id)).digest("hex")}.png`;
  const traceRoot = resolve(input.traceRoot);
  mkdirSync(traceRoot, { recursive: true });
  if (realpathSync(traceRoot) !== traceRoot)
    throw new Error("Trace directory contains a link");
  const tracePath = resolve(traceRoot, traceFile);
  if (!within(traceRoot, tracePath))
    throw new Error("Preview destination escapes trace directory");
  const existingPreview = lstatMaybe(tracePath);
  if (existingPreview) {
    regularNoLinks(tracePath);
    const existingBytes = readFileSync(tracePath);
    if (!existingBytes.equals(bytes))
      throw new Error("Existing preview differs from generated image");
  } else writeFileSync(tracePath, bytes, { flag: "wx" });
  const asset = `assets/${name}`;
  const preview = relative(input.traceRoot, tracePath).replace(/\\/g, "/");
  const record = {
    tool: "image_gen",
    success: true,
    asset,
    preview,
    sha256: digest,
    itemId: String(item.id),
  };
  const indexPath = resolve(workspace, "assets/generated-images.json");
  let index: any[] = [];
  const existingIndex = lstatMaybe(indexPath);
  if (existingIndex) {
    regularNoLinks(indexPath);
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  }
  if (!Array.isArray(index))
    throw new Error("Generated image index is invalid");
  if (!index.some((entry) => entry.itemId === record.itemId))
    index.push({ itemId: record.itemId, path: asset, sha256: digest });
  const serializedIndex = JSON.stringify(index, null, 2);
  writeFileSync(indexPath, serializedIndex, { flag: "w" });
  return record;
}
function lstatMaybe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

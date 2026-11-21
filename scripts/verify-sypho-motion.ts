import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const taskId = process.argv[2] || process.env.WORKSHOP_TASK_ID || "";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId))
  throw new Error("Usage: node verify-sypho-motion.ts <taskId UUID>");
const workspace = realpathSync(process.cwd());
const reportRoot = resolve(workspace, "reports", `sypho-motion-${taskId}`);
const exportRoot = resolve(reportRoot, "exports");
const inside = (root: string, file: string) => {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
function safeRead(root: string, path: string, maxBytes: number) {
  const file = resolve(root, path);
  if (!inside(root, file)) throw new Error(`Path escapes task workspace: ${path}`);
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > maxBytes || realpathSync(file) !== file)
    throw new Error(`Expected regular task-local file under ${maxBytes} bytes: ${path}`);
  return readFileSync(file);
}
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const canonicalText = (bytes: Buffer) => {
  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes)) throw new Error("Text export is not valid UTF-8");
  return Buffer.from(value.replace(/\r\n?/g, "\n"), "utf8");
};
function meshSummary(bytes: Buffer) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw new Error("Mesh export is not a complete GLB 2 file");
  let offset = 12, doc: any, bin: Buffer | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Truncated GLB chunk header");
    const length = bytes.readUInt32LE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    offset += 8;
    if (length > bytes.length - offset) throw new Error("Truncated GLB chunk");
    const chunk = bytes.subarray(offset, offset + length); offset += length;
    if (type === "JSON") doc = JSON.parse(chunk.toString("utf8").trim());
    if (type === "BIN\0") bin = chunk;
  }
  const accessors = doc?.accessors || [];
  const positions = accessors.find((x: any) => x.type === "VEC3" && x.componentType === 5126);
  const indices = accessors.find((x: any) => x.type === "SCALAR" && [5121, 5123, 5125].includes(x.componentType));
  if (!positions || !indices || positions.count < 3 || indices.count < 3 || indices.count % 3 !== 0 || !bin)
    throw new Error("GLB export has no measurable triangle geometry");
  return { vertices: positions.count, triangles: indices.count / 3, bounds: positions.max && positions.min ? positions.max.map((v: number, i: number) => v - positions.min[i]) : null };
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../server/validation-fixtures/motion");
const manifest = JSON.parse(readFileSync(resolve(sourceRoot, "manifest.json"), "utf8"));
const expectedFiles = [
  { name: "animation", path: "animation.luau", golden: "golden/animation.luau", limit: 128 * 1024 },
  { name: "mesh", path: "mesh.glb", golden: "golden/mesh.glb", limit: 128 * 1024 },
  { name: "vfx", path: "vfx.lua", golden: "golden/vfx.lua", limit: 64 * 1024 },
];
const results = expectedFiles.map((item) => {
  const actual = safeRead(workspace, relative(workspace, resolve(exportRoot, item.path)), item.limit);
  const golden = readFileSync(resolve(sourceRoot, item.golden));
  const isBinary = item.name === "mesh";
  const normalized = isBinary ? actual : canonicalText(actual);
  const normalizedGolden = isBinary ? golden : canonicalText(golden);
  const pin = manifest.goldens[item.golden];
  if (!pin || digest(normalizedGolden) !== pin.canonicalSha256 || !normalized.equals(normalizedGolden))
    throw new Error(`${item.name} export differs from the complete pinned expected output`);
  return {
    name: item.name,
    path: `reports/sypho-motion-${taskId}/exports/${item.path}`,
    bytes: actual.length,
    rawSha256: digest(actual),
    canonicalSha256: digest(normalized),
    ...(item.name === "mesh" ? { geometry: meshSummary(actual) } : {}),
  };
});
process.stdout.write(JSON.stringify({ taskId, status: "passed", exports: results }, null, 2) + "\n");

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import {
  renderPresetScreen,
  renderPresetIconSheet,
  renderPresetCover,
} from "../server/style-preset-renderer.js";
import { assertSafeSvg } from "../server/safe-svg.js";
import { hash } from "../server/store.js";
import type { UiStyleDefinition } from "../shared/ui-style-presets.js";

const project = resolve(import.meta.dirname, ".."),
  root = resolve(project, ".agents/skills/roblox-ui-styles");
const source = JSON.parse(
  readFileSync(resolve(root, "assets/presets.json"), "utf8"),
);
for (const preset of source.presets as UiStyleDefinition[]) {
  for (const screen of ["hud", "menu", "shop", "inventory"] as const)
    for (const device of ["desktop", "mobile"] as const) {
      const svg = renderPresetScreen(preset, screen, device);
      assertSafeSvg(svg);
      writeFileSync(
        resolve(root, `assets/${preset.id}-${screen}-${device}.svg`),
        svg,
      );
    }
  for (const [name, svg] of [
    ["icons", renderPresetIconSheet(preset)],
    ["cover", renderPresetCover(preset)],
  ]) {
    assertSafeSvg(svg);
    writeFileSync(resolve(root, `assets/${name}-${preset.id}.svg`), svg);
  }
}
const images = (source.presets as UiStyleDefinition[]).map((p) => ({
  presetId: p.id,
  file: p.referenceImage,
  sha256: createHash("sha256")
    .update(readFileSync(resolve(root, "references/images", p.referenceImage)))
    .digest("hex"),
  source:
    "Photograph supplied by the user on 2026-11-02; personal visual reference, not an asset license",
}));
writeFileSync(
  resolve(root, "references/user-images.json"),
  JSON.stringify({ images }, null, 2),
);
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile() && /\.(md|yaml|json|svg)$/.test(f.name))
  .map((f) => {
    const path = resolve(f.parentPath, f.name);
    return {
      path: relative(root, path).replaceAll("\\", "/"),
      content: readFileSync(path, "utf8"),
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const pack = {
  id: "roblox-ui-styles",
  source:
    "file:///D:/Work/roblox/automation/.agents/skills/roblox-ui-styles/SKILL.md",
  version: source.version,
  license:
    "Project-owned original style kit; user photographs are personal visual references",
  roles: ["art", "ui", "assets", "qa"],
  capabilities: [],
  dependencies: ["game-ui-ux"],
  files,
};
writeFileSync(
  resolve(project, "docs/skill-imports/roblox-ui-styles.json"),
  JSON.stringify(pack, null, 2),
);
console.log(
  JSON.stringify({
    id: pack.id,
    version: pack.version,
    files: files.length,
    packageHash: hash(files),
    presets: source.presets.length,
    screens: 24,
    icons: Object.keys(
      JSON.parse(readFileSync(resolve(root, "assets/icons.json"), "utf8"))
        .icons,
    ).length,
  }),
);

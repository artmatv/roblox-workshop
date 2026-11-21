import type { StylePackage } from "./domain.js";
export function preferredStylePreview(
  style: StylePackage,
  screen: string,
  device: string,
) {
  const images = style.previews.filter(
    (p) => p.screen === screen && p.device === device,
  );
  return (
    images.findLast((p) => p.kind === "studio") ||
    images.findLast((p) => p.kind === "preset") ||
    images.at(-1)
  );
}

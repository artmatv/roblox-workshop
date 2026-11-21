import type { Manifest } from "../shared/domain.js";
import { readFileSync } from "node:fs";
const enumRegistry = JSON.parse(
  readFileSync(new URL("./roblox-enums.json", import.meta.url), "utf8"),
);
if (
  !enumRegistry.tokens ||
  typeof enumRegistry.tokens !== "object" ||
  Object.keys(enumRegistry.tokens).length !== enumRegistry.count
)
  throw new Error("Неполный реестр Roblox Enum");
const enumTokens = enumRegistry.tokens as Record<string, number>;
// The semantic Enum name is authoritative; numeric metadata comes from the
// registry captured from Studio. Unknown names are never guessed.
export function normalizeEnumTokens(manifest: Manifest) {
  const changes: Array<{
    path: string;
    property: string;
    name: string;
    provided: number;
    expected: number;
  }> = [];
  for (const instance of manifest.instances) {
    for (const [property, input] of Object.entries(instance.properties)) {
      const value = input as {
        type?: string;
        value?: unknown;
        token?: number;
      } | null;
      if (value?.type !== "Enum" || typeof value.token !== "number") continue;
      const name = String(value.value).replace(/^Enum\./, "");
      const expected = enumTokens[name];
      if (expected === undefined || value.token === expected) continue;
      changes.push({
        path: instance.path,
        property,
        name,
        provided: value.token,
        expected,
      });
      instance.properties[property] = { ...value, token: expected };
    }
  }
  return changes;
}
const escape = (s: unknown) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
function property(k: string, v: any): string {
  const n = `name="${escape(k)}"`;
  if (typeof v === "boolean") return `<bool ${n}>${v}</bool>`;
  if (typeof v === "number") {
    const tag = [
      "ZIndex",
      "DisplayOrder",
      "LayoutOrder",
      "BorderSizePixel",
      "MaxVisibleGraphemes",
      "NumKeys",
      "StarCount",
    ].includes(k)
      ? "int"
      : "float";
    return `<${tag} ${n}>${v}</${tag}>`;
  }
  if (typeof v === "string") {
    if (
      [
        "Texture",
        "TextureID",
        "ColorMap",
        "NormalMap",
        "RoughnessMap",
        "MetalnessMap",
        "MeshId",
        "SoundId",
        "Image",
        "SkyboxBk",
        "SkyboxDn",
        "SkyboxFt",
        "SkyboxLf",
        "SkyboxRt",
        "SkyboxUp",
        "SunTextureId",
        "MoonTextureId",
      ].includes(k)
    )
      return `<Content ${n}>${v ? `<url>${escape(v)}</url>` : "<null></null>"}</Content>`;
    return `<string ${n}>${escape(v)}</string>`;
  }
  if (v?.type === "Vector3")
    return `<Vector3 ${n}><X>${v.value[0]}</X><Y>${v.value[1]}</Y><Z>${v.value[2]}</Z></Vector3>`;
  if (v?.type === "Vector2")
    return `<Vector2 ${n}><X>${v.value[0]}</X><Y>${v.value[1]}</Y></Vector2>`;
  if (v?.type === "Color3")
    return `<Color3 ${n}><R>${v.value[0]}</R><G>${v.value[1]}</G><B>${v.value[2]}</B></Color3>`;
  if (v?.type === "UDim2")
    return `<UDim2 ${n}><XS>${v.value[0]}</XS><XO>${v.value[1]}</XO><YS>${v.value[2]}</YS><YO>${v.value[3]}</YO></UDim2>`;
  if (v?.type === "UDim")
    return `<UDim ${n}><S>${v.value[0]}</S><O>${v.value[1]}</O></UDim>`;
  if (v?.type === "Enum") {
    const known = enumTokens[String(v.value).replace(/^Enum\./, "")];
    if (typeof v.token === "number" && known !== undefined && v.token !== known)
      throw new Error(
        `Неверный XML token ${v.value}: ${v.token}, требуется ${known}`,
      );
    const token = v.token ?? known;
    if (typeof token === "number" && Number.isInteger(token))
      return `<token ${n}>${token}</token>`;
    throw new Error(
      `Неизвестный Enum ${v.value}. Укажите проверенный token из Studio.`,
    );
  }
  if (v?.type === "Content")
    return `<Content ${n}><url>${escape(v.value)}</url></Content>`;
  if (v?.type === "CFrame") {
    const a = v.value;
    if (a.length !== 12)
      throw new Error("CFrame должен содержать 12 компонентов");
    return `<CoordinateFrame ${n}><X>${a[0]}</X><Y>${a[1]}</Y><Z>${a[2]}</Z>${["R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"].map((t, i) => `<${t}>${a[i + 3]}</${t}>`).join("")}</CoordinateFrame>`;
  }
  throw new Error(`Не поддержан XML тип ${k}. Для Enum укажите token.`);
}
export function exportPlace(m: Manifest) {
  type N = {
    name: string;
    className: string;
    properties: Record<string, unknown>;
    source?: string;
    children: Map<string, N>;
  };
  const root: Map<string, N> = new Map();
  for (const i of m.instances) {
    let map = root;
    const parts = i.path.split("/");
    for (let p = 0; p < parts.length; p++) {
      const name = parts[p];
      let n = map.get(name);
      if (!n) {
        n = {
          name,
          className: p === 0 ? name : "Folder",
          properties: {},
          children: new Map(),
        };
        map.set(name, n);
      }
      if (p === parts.length - 1) {
        n.className = i.className;
        n.properties = i.properties;
        n.source = i.source;
      }
      map = n.children;
    }
  }
  let ref = 0;
  const render = (n: N): string =>
    `<Item class="${escape(n.className)}" referent="RBX${++ref}"><Properties><string name="Name">${escape(n.name)}</string>${Object.entries(
      n.properties,
    )
      .filter(([k]) => k !== "Name" && k !== "Parent")
      .map(([k, v]) => property(k, v))
      .join(
        "",
      )}${n.source !== undefined ? `<ProtectedString name="Source">${escape(n.source)}</ProtectedString>` : ""}</Properties>${[...n.children.values()].map(render).join("")}</Item>`;
  return `<?xml version="1.0" encoding="utf-8"?><roblox version="4"><External>null</External><External>nil</External>${[...root.values()].map(render).join("")}</roblox>`;
}

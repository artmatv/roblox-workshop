import { z } from "zod";
import type { Manifest, Project } from "../shared/domain.js";
import { families } from "./catalog.js";
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const PREVIEW_RENDERER = "style-previews@1.2.0";
const scenePlan = z.object({
  layout: z.enum(["platforms", "plots", "beacons", "plaza"]),
  theme: z.enum(["space", "garden", "arena", "neutral"]),
  objective: z.string().min(2).max(36),
  metric: z.string().min(2).max(28),
  context: z.string().min(2).max(38),
  hint: z.string().min(2).max(44),
  items: z.array(z.string().min(2).max(22)).length(3),
});
type ScenePlan = z.infer<typeof scenePlan>;
const plan = z.object({
  familyId: z.string(),
  name: z.string().min(2).max(70),
  rules: z
    .object({
      geometry: z.enum(["blocks", "rounded", "faceted", "arena"]),
      uiLayout: z.enum(["arcade", "playful", "quiet", "tactical"]),
      palette: z.object({
        sky: color,
        ground: color,
        surface: color,
        primary: color,
        accent: color,
        ink: color,
        panel: color,
      }),
      materials: z.array(z.string()).min(2),
      lighting: z.string(),
      avatar: z.string(),
      typography: z.string(),
      rationale: z.string(),
      mobile: z.string(),
      hud: z.string(),
      shop: z.string(),
      inventory: z.string(),
      scene: scenePlan.optional(),
    })
    .passthrough(),
  references: z
    .array(
      z.object({
        game: z.string(),
        author: z.string(),
        url: z.url(),
        checkedAt: z.iso.datetime(),
        device: z.string(),
        screen: z.string(),
        observations: z.string(),
        confidence: z.string(),
      }),
    )
    .min(1),
  previews: z.array(z.unknown()).optional(),
});
export type StylePlan = z.infer<typeof plan>;
export const parseStylePlan = (input: unknown) => plan.parse(input);
const esc = (v: unknown) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const txt = (
  x: number,
  y: number,
  text: string,
  size = 18,
  fill = "#fff",
  weight = 600,
  extra = "",
) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${esc(fill)}" font-weight="${weight}" ${extra}>${esc(text)}</text>`;
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  r = 0,
  stroke = "none",
  sw = 1,
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${sw}"/>`;
const poly = (points: number[][], fill: string, extra = "") =>
  `<polygon points="${points.map((p) => p.join(",")).join(" ")}" fill="${esc(fill)}" ${extra}/>`;
const circle = (x: number, y: number, r: number, fill: string, extra = "") =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${esc(fill)}" ${extra}/>`;
const rgba = (hex: string, a: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
function tint(hex: string, f: number) {
  const a = [1, 3, 5].map((i) =>
    Math.round(
      Math.max(0, Math.min(255, parseInt(hex.slice(i, i + 2), 16) * f)),
    ),
  );
  return "#" + a.map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function contrastText(hex: string) {
  const rgb = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#111111" : "#ffffff";
}
export function sceneForProject(p: Pick<Project, "name" | "genre">): ScenePlan {
  if (p.name === "Лунные почтальоны")
    return {
      layout: "platforms",
      theme: "space",
      objective: "Deliver parcels",
      metric: "Parcels 1 / 3",
      context: "Route 1 · Checkpoint 2",
      hint: "The next station is ahead",
      items: ["Comet Trail", "Postal Badge", "Lunar Backpack"],
    };
  if (p.name === "Кристальный питомник")
    return {
      layout: "plots",
      theme: "garden",
      objective: "Grow crystals",
      metric: "Crystals 240",
      context: "Zone 1 · Tool II",
      hint: "Ready in 00:12",
      items: ["Shimmer Trail", "Gardener Badge", "Crystal Decor"],
    };
  if (p.name === "Световые маяки")
    return {
      layout: "beacons",
      theme: "arena",
      objective: "Light three beacons",
      metric: "Beacons 2 / 3",
      context: "Round 2 / 3 · 01:24",
      hint: "Stay close to your team",
      items: ["Signal Trail", "Team Badge", "Small Beacon"],
    };
  return {
    layout: /obby|полос|платформ/i.test(p.genre)
      ? "platforms"
      : /симулятор|simulator/i.test(p.genre)
        ? "plots"
        : "plaza",
    theme: "neutral",
    objective: "Explore the world",
    metric: "Progress 1 / 3",
    context: "Sample gameplay state",
    hint: "Preview: content in development",
    items: ["Item 1", "Item 2", "Item 3"],
  };
}
function lines(text: string, max: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max && line) {
      out.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) out.push(line);
  return out;
}
function label(
  x: number,
  y: number,
  text: string,
  max: number,
  size: number,
  fill: string,
) {
  return lines(text, max)
    .map((l, i) => txt(x, y + i * (size + 5), l, size, fill))
    .join("");
}
function world(s: StylePlan, scene: ScenePlan, w: number, h: number) {
  const c = s.rules.palette,
    geom = s.rules.geometry,
    g = scene.layout;
  const mobile = w < 500,
    u = 34,
    cx = 0,
    cy = 0;
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const mark = (x: number, y: number) => {
    bounds.x0 = Math.min(bounds.x0, x);
    bounds.x1 = Math.max(bounds.x1, x);
    bounds.y0 = Math.min(bounds.y0, y);
    bounds.y1 = Math.max(bounds.y1, y);
    return [x, y];
  };
  let out = "";
  const at = (x: number, y: number, z: number) =>
    mark(cx + (x - z) * u, cy + (x + z) * u * 0.52 - y * u);
  const box = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    col: string,
    y = 0,
  ) => {
    const a = at(x, y + height, z),
      b = at(x + width, y + height, z),
      d = at(x, y + height, z + depth),
      e = at(x + width, y + height, z + depth),
      bb = at(x + width, y, z),
      dd = at(x, y, z + depth),
      ee = at(x + width, y, z + depth);
    let p =
      poly([b, bb, ee, e], tint(col, 0.64)) +
      poly([d, e, ee, dd], tint(col, 0.79));
    if (geom === "faceted") {
      p += poly(
        [
          a,
          [b[0] - u * 0.22, b[1] - u * 0.1],
          b,
          e,
          [e[0] - u * 0.3, e[1] + u * 0.15],
          d,
        ],
        col,
      );
      p += poly(
        [
          dd,
          ee,
          [ee[0] - u, ee[1] + u * 0.7],
          [dd[0] + u * 0.4, dd[1] + u * 0.4],
        ],
        tint(col, 0.56),
      );
    } else p += poly([a, b, e, d], col);
    if (geom === "blocks" && width > 1 && depth > 1) {
      for (let ix = 0.6; ix < width; ix += 1)
        for (let iz = 0.6; iz < depth; iz += 1) {
          const q = at(x + ix, y + height + 0.01, z + iz);
          p += `<ellipse cx="${q[0]}" cy="${q[1]}" rx="${u * 0.13}" ry="${u * 0.07}" fill="${tint(col, 1.13)}" stroke="${rgba("#000000", 0.12)}"/>`;
        }
    }
    return p;
  };
  const orb = (x: number, y: number, z: number, r: number, col: string) => {
    const q = at(x, y, z);
    return (
      circle(q[0], q[1], r * u, col) +
      circle(
        q[0] - r * u * 0.25,
        q[1] - r * u * 0.3,
        r * u * 0.25,
        "#ffffff",
        'opacity=".25"',
      )
    );
  };
  const gem = (x: number, y: number, z: number, col: string, scale = 1) => {
    const q = at(x, y, z),
      r = u * 0.43 * scale;
    return (
      poly(
        [
          [q[0], q[1] - r * 1.8],
          [q[0] + r, q[1] - r * 0.5],
          [q[0] + r * 0.65, q[1] + r],
          [q[0] - r * 0.65, q[1] + r],
          [q[0] - r, q[1] - r * 0.5],
        ],
        col,
      ) +
      poly(
        [
          [q[0], q[1] - r * 1.8],
          [q[0] + r * 0.1, q[1] + r],
          [q[0] - r * 0.65, q[1] + r],
          [q[0] - r, q[1] - r * 0.5],
        ],
        tint(col, 0.72),
      )
    );
  };
  const avatar = (x: number, z: number) => {
    let a = "";
    if (geom === "rounded") {
      a += box(x - 0.25, z - 0.18, 0.5, 0.42, 0.8, c.primary, 0.15);
      a += orb(x, 1.35, z, 0.32, "#ffe4bf");
    } else {
      a += box(x - 0.26, z - 0.16, 0.52, 0.36, 0.75, c.primary, 0.25);
      a += box(x - 0.23, z - 0.2, 0.46, 0.4, 0.45, "#ffe4bf", 1.02);
    }
    a +=
      box(x - 0.26, z - 0.13, 0.2, 0.25, 0.45, "#20364d", -0.05) +
      box(x + 0.06, z - 0.13, 0.2, 0.25, 0.45, "#20364d", -0.05);
    a +=
      box(x - 0.44, z - 0.12, 0.16, 0.26, 0.6, c.primary, 0.32) +
      box(x + 0.3, z - 0.12, 0.16, 0.26, 0.6, c.primary, 0.32);
    if (scene.theme === "space") {
      a += box(x - 0.25, z + 0.21, 0.5, 0.25, 0.6, c.accent, 0.3);
      const q = at(x + 0.12, 1.27, z - 0.23);
      a += rect(
        q[0] - u * 0.16,
        q[1] - u * 0.09,
        u * 0.32,
        u * 0.18,
        "#17334e",
        3,
      );
    }
    if (scene.layout === "plots")
      a += box(x + 0.45, z - 0.3, 0.12, 0.16, 0.85, c.accent, 0.05);
    return a;
  };
  out += `<ellipse cx="${cx}" cy="${cy + u * 3.6}" rx="${u * 6.4}" ry="${u * 1.5}" fill="#000" opacity=".10" filter="url(#soft)"/>`;
  if (g === "platforms") {
    out += box(-3, -1, 5, 4, geom === "faceted" ? 1.2 : 0.6, c.ground, -1.2);
    const route = [
      [-2, -4],
      [0.4, -5.6],
      [2.1, -8.2],
    ];
    for (let i = 2; i >= 0; i--) {
      const [x, z] = route[i];
      out += box(
        x,
        z,
        2,
        1.65,
        geom === "rounded" ? 0.6 : 0.35,
        i === 2 ? c.accent : c.surface,
        i * 0.18 - 0.2,
      );
      if (geom === "rounded")
        out += orb(x + 0.9, i * 0.18 + 0.25, z + 0.6, 0.28, c.accent);
      if (i === 2) {
        out += box(
          x + 0.7,
          z + 0.45,
          0.6,
          0.55,
          0.65,
          "#ffe2a6",
          i * 0.18 + 0.15,
        );
        const q = at(x + 1, i * 0.18 + 1.3, z + 0.7);
        out += txt(
          q[0],
          q[1],
          "✦",
          mobile ? 25 : 36,
          c.accent,
          700,
          'text-anchor="middle"',
        );
      }
    }
    out += avatar(-0.8, 0.8);
    const q = at(-2, 0.5, 1.2);
    out += rect(q[0] - u * 0.5, q[1], u, 5, c.accent, 2);
  } else if (g === "plots") {
    out += box(-4, -3, 8, 6, geom === "faceted" ? 1.0 : 0.45, c.ground, -0.9);
    const cols = ["#7bd8f3", "#ca9ff0", "#ffcd75"];
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 3; i++) {
        const x = -3 + i * 2.1,
          z = -2.4 + row * 2.3;
        out += box(
          x,
          z,
          1.5,
          1.55,
          0.18,
          geom === "rounded" ? tint(c.surface, 1.08) : tint(c.ground, 0.62),
        );
        out += gem(x + 0.7, 0.7, z + 0.7, cols[i], row === 0 ? 1.0 : 0.65);
        if (geom === "rounded")
          out += orb(x + 0.2, 0.55, z + 0.2, 0.21, c.accent);
      }
    out += avatar(-0.4, 2.2);
    if (geom === "faceted") {
      out += poly(
        [
          mark(cx - 5 * u, cy - 3 * u),
          mark(cx - 3.4 * u, cy - 6.2 * u),
          mark(cx - 1.8 * u, cy - 2.7 * u),
        ],
        tint(c.ground, 0.64),
      );
    }
  } else if (g === "beacons") {
    out += box(-5, -3, 10, 7, 0.45, c.ground, -0.65);
    const beacons = [
      [-3, -1, "#73c9ff", "A"],
      [0, -2.6, "#ffd17c", "B"],
      [3, 1, "#ce9ff3", "C"],
    ] as const;
    for (const [x, z, col, n] of beacons) {
      out += box(x - 0.5, z - 0.5, 1.1, 1.1, 0.22, c.surface);
      if (geom === "faceted") out += gem(x, 1.2, z, col, 1.55);
      else if (geom === "rounded") out += orb(x, 1, z, 0.55, col);
      else out += box(x - 0.25, z - 0.25, 0.5, 0.5, 1.65, col);
      const q = at(x, 3, z);
      out +=
        `<path d="M${q[0]} ${q[1] + u * 2.4}V${q[1]}" stroke="${col}" stroke-width="${u * 0.25}" opacity=".22"/>` +
        rect(q[0] - 14, q[1] - 31, 28, 28, c.panel, 4, c.ink, 1) +
        txt(
          q[0],
          q[1] - 10,
          n,
          mobile ? 19 : 27,
          c.ink,
          800,
          'text-anchor="middle"',
        );
    }
    out += avatar(-1, 1.5) + avatar(1.9, -0.5);
    if (geom === "arena")
      out +=
        box(-3, 2.6, 2, 0.45, 0.7, c.surface) +
        box(2, -2.9, 2, 0.45, 0.7, c.surface);
  } else {
    out += box(-4, -3, 8, 6, 0.5, c.ground, -0.7);
    out +=
      box(-3, -2, 2.5, 2, 2.5, c.surface) +
      box(1, -2.5, 2, 2.5, 1.8, c.surface) +
      avatar(0, 1.7);
    out += gem(0, 1.5, -0.5, c.accent, 1.3);
  }
  if (geom === "rounded") {
    out +=
      orb(-4, 1, -3, 0.7, tint(c.accent, 1.06)) +
      orb(4, 0.5, 1, 0.5, c.primary);
  }
  if (geom === "faceted") {
    for (let i = 0; i < 10; i++) {
      const q = at(
        Math.sin(i * 2.3) * 5,
        0.3 + (i % 3) * 0.45,
        Math.cos(i * 1.7) * 4,
      );
      out += circle(q[0], q[1], mobile ? 1.2 : 2, c.accent, 'opacity=".65"');
    }
  }
  const frame = mobile
    ? { x: 20, y: 255, w: 350, h: 330 }
    : { x: 350, y: 160, w: 860, h: 400 };
  const bw = bounds.x1 - bounds.x0 + 50,
    bh = bounds.y1 - bounds.y0 + 60;
  const scale = Math.min(frame.w / bw, frame.h / bh);
  const tx = frame.x + (frame.w - bw * scale) / 2 - (bounds.x0 - 25) * scale;
  const ty = frame.y + (frame.h - bh * scale) / 2 - (bounds.y0 - 40) * scale;
  return `<g data-role="world" transform="translate(${tx} ${ty}) scale(${scale})">${out}</g>`;
}
export function renderStyleScreen(
  p: Pick<Project, "name" | "genre">,
  s: StylePlan,
  screen: string,
  device: string,
) {
  const mobile = device === "mobile",
    w = mobile ? 390 : 1280,
    h = mobile ? 844 : 720,
    c = s.rules.palette,
    layout = s.rules.uiLayout,
    scene = s.rules.scene || sceneForProject(p),
    quiet = layout === "quiet",
    playful = layout === "playful",
    tactical = layout === "tactical",
    round = quiet ? 7 : playful ? 24 : tactical ? 2 : 4,
    stroke = quiet ? rgba(c.ink, 0.2) : tactical ? rgba(c.primary, 0.5) : c.ink,
    sw = quiet || tactical ? 1 : 3;
  const font = quiet ? "Georgia,serif" : "Segoe UI,Arial,sans-serif";
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(p.name + " / " + s.name + " / " + screen + " / " + device)}"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${c.sky}"/><stop offset="1" stop-color="${tint(c.sky, 1.25)}"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="9"/></filter></defs><g font-family="${font}">`;
  out += rect(0, 0, w, h, "url(#sky)");
  if (scene.theme === "space") {
    for (let i = 0; i < 35; i++)
      out += circle(
        (i * 137.5) % w,
        75 + ((i * 59.3) % (h * 0.36)),
        i % 5 === 0 ? 2 : 1,
        "#ffffff",
        'opacity=".55"',
      );
    out +=
      circle(w * 0.81, h * 0.24, mobile ? 54 : 105, rgba(c.accent, 0.3)) +
      circle(w * 0.79, h * 0.22, mobile ? 45 : 88, rgba(c.surface, 0.32));
  } else if (quiet)
    out += poly(
      [
        [0, h * 0.38],
        [w * 0.18, h * 0.2],
        [w * 0.35, h * 0.38],
        [w * 0.55, h * 0.16],
        [w * 0.8, h * 0.34],
        [w, h * 0.25],
        [w, h],
        [0, h],
      ],
      tint(c.sky, 0.78),
      'opacity=".5"',
    );
  else
    out += `<path d="M0 ${h * 0.29}Q${w * 0.25} ${h * 0.11} ${w * 0.5} ${h * 0.26}T${w} ${h * 0.25}V${h}H0Z" fill="${rgba(c.surface, 0.14)}"/>`;
  out += world(s, scene, w, h);
  const title = scene.objective,
    metric = scene.metric,
    note = scene.context;
  const button = (
    x: number,
    y: number,
    bw: number,
    text: string,
    active = false,
  ) =>
    rect(
      x,
      y,
      bw,
      mobile ? 48 : 43,
      active ? c.primary : c.panel,
      round,
      stroke,
      sw,
    ) +
    txt(
      x + bw / 2,
      y + (mobile ? 30 : 28),
      text,
      mobile ? 16 : 18,
      active ? contrastText(c.primary) : c.ink,
      750,
      'text-anchor="middle"',
    );
  if (screen === "hud") {
    if (quiet) {
      out +=
        rect(
          18,
          44,
          mobile ? 354 : 400,
          108,
          rgba(c.panel, 0.94),
          round,
          stroke,
          1,
        ) +
        txt(34, 77, title, mobile ? 22 : 30, c.ink, 500) +
        txt(34, 104, note, 14, c.ink, 400) +
        txt(34, 135, metric, 17, c.ink, 600);
      out +=
        rect(
          24,
          mobile ? 181 : h - 190,
          mobile ? 342 : 355,
          44,
          rgba(c.panel, 0.92),
          round,
          stroke,
          1,
        ) + txt(36, mobile ? 209 : h - 162, scene.hint, 14, c.ink, 500);
    } else if (tactical) {
      out +=
        rect(
          mobile ? 50 : 430,
          45,
          mobile ? 290 : 420,
          51,
          c.panel,
          2,
          c.primary,
          1,
        ) +
        txt(
          w / 2,
          77,
          note,
          mobile ? 17 : 23,
          c.ink,
          700,
          'text-anchor="middle"',
        );
      out +=
        rect(18, 118, mobile ? 156 : 240, 64, c.panel, 2, stroke, 1) +
        txt(32, 145, metric, 18, c.ink) +
        txt(
          32,
          168,
          scene.layout === "beacons"
            ? "TEAM · 2 PLAYERS"
            : "GOAL · " +
                (scene.layout === "plots" ? "GROW" : "DELIVER"),
          11,
          c.ink,
          500,
        );
    } else {
      out +=
        rect(
          mobile ? 18 : 26,
          44,
          mobile ? 354 : 365,
          80,
          c.panel,
          round,
          stroke,
          sw,
        ) +
        txt(mobile ? 36 : 46, 76, title, mobile ? 21 : 26, c.ink, 800) +
        txt(mobile ? 36 : 46, 105, note, 14, c.ink, 600);
      out +=
        rect(
          mobile ? 205 : 1000,
          mobile ? 144 : 47,
          mobile ? 166 : 250,
          52,
          c.accent,
          playful ? 26 : 4,
          stroke,
          sw,
        ) +
        txt(
          mobile ? 288 : 1125,
          mobile ? 177 : 81,
          metric,
          mobile ? 16 : 22,
          contrastText(c.accent),
          800,
          'text-anchor="middle"',
        );
    }
    if (mobile) {
      out +=
        circle(
          65,
          h - 183,
          46,
          rgba(c.panel, 0.65),
          `stroke="${stroke}" stroke-width="${sw}"`,
        ) +
        circle(65, h - 183, 20, rgba(c.ink, 0.2)) +
        circle(
          w - 62,
          h - 183,
          38,
          c.primary,
          `stroke="${stroke}" stroke-width="${sw}"`,
        ) +
        txt(
          w - 62,
          h - 176,
          "↑",
          28,
          contrastText(c.primary),
          800,
          'text-anchor="middle"',
        );
      out +=
        button(18, h - 106, 164, "Shop") +
        button(208, h - 106, 164, "Inventory");
    } else {
      const bx = quiet ? 840 : playful ? 440 : 26;
      out +=
        button(bx, h - 100, 180, "Shop") +
        button(bx + 194, h - 100, 210, "Inventory");
      out += txt(
        27,
        h - 45,
        "WASD — move · Space — jump · E — interact",
        14,
        quiet ? "#fff" : c.ink,
        500,
      );
    }
  } else if (screen === "menu") {
    out += rect(0, 0, w, h, rgba("#071527", quiet ? 0.4 : 0.17));
    const px = mobile ? 24 : 80,
      py = mobile ? 130 : 160;
    const gameTitle = ({"Лунные почтальоны":"Lunar Couriers", "Кристальный питомник":"Crystal Nursery", "Световые маяки":"Light Beacons"} as Record<string,string>)[p.name] || String(s.rules.gameTitle || (/^[\x00-\x7f]*$/.test(p.name) ? p.name : "New Adventure"));
    out += label(px, py, gameTitle, mobile ? 14 : 28, mobile ? 36 : 58, "#fff");
    out += label(
      px,
      py + (mobile ? 103 : 150),
      scene.theme === "space"
        ? "Three parcels. One lunar route."
        : scene.layout === "plots"
          ? "Small garden. Big discoveries."
          : scene.layout === "beacons"
            ? "A stronger signal together."
            : "Your world. Your story.",
      mobile ? 30 : 48,
      mobile ? 16 : 22,
      "#f2f4ff",
    );
    out +=
      button(px, mobile ? 390 : 430, mobile ? 342 : 310, "Play", true) +
      button(px, mobile ? 454 : 491, mobile ? 342 : 310, "Inventory");
  } else {
    out += rect(0, 0, w, h, rgba("#071527", 0.35));
    const px = mobile ? 16 : quiet ? 230 : 160,
      py = mobile ? 77 : 65,
      pw = mobile ? 358 : quiet ? 820 : 960,
      ph = mobile ? 674 : 590;
    out +=
      rect(px + 4, py + 7, pw, ph, rgba("#000000", 0.2), round) +
      rect(px, py, pw, ph, c.panel, round, stroke, sw);
    out +=
      txt(
        px + 22,
        py + 40,
        screen === "shop" ? "Shop" : "Inventory",
        mobile ? 27 : 34,
        c.ink,
        quiet ? 500 : 800,
      ) +
      rect(
        px + pw - 60,
        py + 12,
        44,
        44,
        playful ? "#ff5c82" : c.primary,
        round,
        stroke,
        sw,
      ) +
      txt(
        px + pw - 38,
        py + 42,
        "×",
        31,
        contrastText(playful ? "#ff5c82" : c.primary),
        600,
        'text-anchor="middle"',
      );
    const cats = ["All", "Trails", "Badges"];
    const tabY = py + (mobile ? 72 : 69);
    cats.forEach((v, i) => {
      out +=
        rect(
          px + 20 + i * (mobile ? 106 : 145),
          tabY,
          mobile ? 100 : 138,
          40,
          i === 0 ? c.primary : rgba(c.primary, 0.1),
          quiet ? 3 : round,
          quiet ? "none" : stroke,
          quiet ? 0 : sw,
        ) +
        txt(
          px + 20 + i * (mobile ? 106 : 145) + (mobile ? 50 : 69),
          tabY + 26,
          v,
          15,
          i === 0 ? contrastText(c.primary) : c.ink,
          700,
          'text-anchor="middle"',
        );
    });
    const names = scene.items;
    const values =
      screen === "shop"
        ? ["500 crystals", "250 crystals", "750 crystals"]
        : ["Equipped", "Owned", "Not equipped"];
    const colors = [c.primary, c.accent, "#9dcbe5"];
    if (quiet) {
      for (let i = 0; i < 3; i++) {
        const y = py + 136 + i * (mobile ? 136 : 113);
        out += rect(
          px + 20,
          y,
          pw - 40,
          mobile ? 124 : 100,
          rgba(c.primary, i === 0 ? 0.2 : 0.07),
          5,
          i === 0 ? c.primary : rgba(c.ink, 0.12),
          1,
        );
        out += gemIcon(
          px + 64,
          y + (mobile ? 49 : 49),
          colors[i],
          mobile ? 24 : 30,
          s.rules.geometry,
        );
        out +=
          txt(
            px + (mobile ? 110 : 136),
            y + 40,
            names[i],
            mobile ? 16 : 22,
            c.ink,
            500,
          ) +
          txt(
            px + (mobile ? 110 : 136),
            y + 70,
            values[i],
            mobile ? 14 : 17,
            c.ink,
            400,
          );
      }
    } else {
      const columns = mobile ? 2 : 3,
        cw = (pw - 40 - (columns - 1) * 15) / columns,
        ch = mobile ? 167 : 265;
      for (let i = 0; i < 3; i++) {
        const x = px + 20 + (i % columns) * (cw + 15),
          y = py + 135 + Math.floor(i / columns) * (ch + 14);
        out +=
          rect(
            x,
            y,
            cw,
            ch,
            rgba(colors[i], 0.18),
            playful ? 22 : round,
            stroke,
            sw,
          ) +
          rect(
            x + 10,
            y + 10,
            cw - 20,
            mobile ? 93 : 158,
            rgba(colors[i], 0.3),
            playful ? 16 : round,
          );
        out += gemIcon(
          x + cw / 2,
          y + (mobile ? 57 : 88),
          colors[i],
          mobile ? 30 : 49,
          s.rules.geometry,
        );
        out +=
          txt(
            x + 12,
            y + (mobile ? 126 : 202),
            names[i],
            mobile ? 15 : 21,
            c.ink,
            750,
          ) +
          txt(
            x + 12,
            y + (mobile ? 151 : 235),
            values[i],
            mobile ? 14 : 18,
            c.ink,
            600,
          );
        if (i === 0)
          out +=
            circle(x + cw - 22, y + 22, 12, c.primary) +
            txt(
              x + cw - 22,
              y + 27,
              "✓",
              17,
              contrastText(c.primary),
              700,
              'text-anchor="middle"',
            );
      }
    }
    out += button(
      px + 20,
      py + ph - 76,
      mobile ? 318 : pw - 40,
      screen === "shop" ? "View item" : "Equip",
      true,
    );
    out += txt(
      px + 20,
      py + ph - 13,
      screen === "shop"
        ? "Sample prices · purchases disabled"
        : "Cosmetics · no gameplay advantage",
      mobile ? 10 : 13,
      c.ink,
      400,
    );
  }
  out +=
    rect(0, 0, w, 25, rgba("#081525", 0.86)) +
    txt(12, 17, "КОНЦЕПЦИЯ · НЕ СКРИНШОТ STUDIO", 10, "#fff", 650) +
    rect(0, h - 31, w, 31, rgba("#081525", 0.86)) +
    txt(
      12,
      h - 11,
      s.name + " · " + (mobile ? "390 × 844" : "1280 × 720"),
      mobile ? 10 : 13,
      "#fff",
      500,
    );
  return out + "</g></svg>";
}
function gemIcon(x: number, y: number, col: string, r: number, geom: string) {
  if (geom === "rounded")
    return (
      circle(x, y, r, col) +
      circle(x - r * 0.3, y - r * 0.35, r * 0.25, "#fff", 'opacity=".4"')
    );
  if (geom === "blocks")
    return (
      rect(x - r, y - r, r * 2, r * 2, col, 1, "#243040", 2) +
      rect(x - r * 0.5, y - r * 0.5, r * 0.35, r * 0.35, tint(col, 1.25), 1)
    );
  return (
    poly(
      [
        [x, y - r * 1.25],
        [x + r, y - r * 0.3],
        [x + r * 0.65, y + r],
        [x - r * 0.65, y + r],
        [x - r, y - r * 0.3],
      ],
      col,
    ) +
    poly(
      [
        [x, y - r * 1.25],
        [x, y + r],
        [x - r * 0.65, y + r],
        [x - r, y - r * 0.3],
      ],
      tint(col, 0.7),
    )
  );
}
export function materializeStylePreviews(p: Project, result: Manifest) {
  const variants = z.array(plan).min(3).max(5).parse(result.data.styles);
  if (
    new Set(variants.map((s) => s.rules.geometry + ":" + s.rules.uiLayout))
      .size < 3
  )
    throw new Error(
      "Варианты должны различаться геометрией и устройством UI, не только палитрой",
    );
  if (result.instances.length)
    throw new Error("Концептуальное оформление не меняет сцену Studio");
  const scenes = variants.map((s) => s.rules.scene || sceneForProject(p));
  if (new Set(scenes.map((s) => JSON.stringify(s))).size !== 1)
    throw new Error(
      "Сравнивайте одинаковые сцену, функции и предметы во всех пакетах",
    );
  variants.forEach((s, i) => {
    if (!families.some((f) => f.id === s.familyId))
      throw new Error("Неизвестное семейство");
    const previews = [];
    for (const screen of ["hud", "shop", "inventory", "menu"])
      for (const device of ["desktop", "mobile"]) {
        const path = `style-${i + 1}/${screen}-${device}.svg`;
        result.files.push({
          path,
          content: renderStyleScreen(p, s, screen, device),
        });
        previews.push({ screen, device, file: path, kind: "concept" });
      }
    s.previews = previews;
    s.rules.scene = scenes[i];
    s.rules.previewRenderer = PREVIEW_RENDERER;
  });
  result.data.styles = variants;
}

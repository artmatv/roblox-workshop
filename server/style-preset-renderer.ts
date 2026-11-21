import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  UiStyleDefinition,
  PresetScreen,
} from "../shared/ui-style-presets.js";

const icons = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../.agents/skills/roblox-ui-styles/assets/icons.json",
    ),
    "utf8",
  ),
).icons as Record<
  string,
  { label: string; color: string; paths: Array<{ d: string; fill: string }> }
>;
const esc = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const r = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  radius = 0,
  stroke = "none",
  sw = 1,
  extra = "",
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;
const circle = (x: number, y: number, size: number, fill: string, extra = "") =>
  `<circle cx="${x}" cy="${y}" r="${size}" fill="${fill}" ${extra}/>`;
const poly = (points: string, fill: string, extra = "") =>
  `<polygon points="${points}" fill="${fill}" ${extra}/>`;
function mix(a: string, b: string, n: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.slice(i, i + 2), 16) * (1 - n) +
            parseInt(b.slice(i, i + 2), 16) * n,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const tactical = (s: UiStyleDefinition) => s.id === "tactical-tycoon";
const neon = (s: UiStyleDefinition) => s.id === "neon-clicker";
function text(
  s: UiStyleDefinition,
  x: number,
  y: number,
  value: string,
  size = 24,
  fill = "#fff",
  anchor = "start",
  outline = true,
) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="900" fill="${fill}" ${!tactical(s) && outline ? 'stroke="#142135" stroke-width="' + (size > 35 ? 5 : 3) + '" paint-order="stroke fill" stroke-linejoin="round"' : ""}>${esc(value)}</text>`;
}
function defs(s: UiStyleDefinition) {
  return `<defs>
<linearGradient id="sky" x2="0" y2="1"><stop stop-color="${s.palette.sky}"/><stop offset="1" stop-color="${mix(s.palette.sky, "#ffffff", 0.7)}"/></linearGradient>
<linearGradient id="floor" x2="0" y2="1"><stop stop-color="${mix(s.palette.ground, "#ffffff", 0.2)}"/><stop offset="1" stop-color="${s.palette.ground}"/></linearGradient>
<linearGradient id="panel" x2="0" y2="1"><stop stop-color="${tactical(s) || neon(s) ? mix(s.palette.panel, "#ffffff", 0.1) : "#ffffff"}"/><stop offset="1" stop-color="${s.palette.panel}"/></linearGradient>
<radialGradient id="energy"><stop stop-color="#efffff"/><stop offset=".55" stop-color="#66fff3"/><stop offset="1" stop-color="#6e33d2"/></radialGradient>
<pattern id="studs" width="30" height="22" patternUnits="userSpaceOnUse"><circle cx="10" cy="8" r="4" fill="#ffffff" opacity=".13"/><circle cx="11" cy="10" r="4" fill="#15233b" opacity=".2"/></pattern>
<pattern id="cliff" width="52" height="36" patternUnits="userSpaceOnUse"><rect width="25" height="17" fill="#ffffff" opacity=".08"/><rect x="26" y="18" width="25" height="17" fill="#ffffff" opacity=".08"/></pattern>
${Object.entries(icons)
  .map(
    ([id, i]) =>
      `<linearGradient id="icon-${id}" x2=".2" y2="1"><stop stop-color="${mix(i.color, "#ffffff", 0.35)}"/><stop offset=".55" stop-color="${i.color}"/><stop offset="1" stop-color="${mix(i.color, "#172637", 0.3)}"/></linearGradient><linearGradient id="tile-${id}" x2="0" y2="1"><stop stop-color="${mix(i.color, "#ffffff", 0.25)}"/><stop offset="1" stop-color="${mix(i.color, "#172637", 0.3)}"/></linearGradient>`,
  )
  .join("")}
</defs>`;
}
export function presetIcon(
  s: UiStyleDefinition,
  name: string,
  x: number,
  y: number,
  size: number,
) {
  const icon = icons[name] || icons.inventory;
  return `<g data-icon="${esc(name)}" transform="translate(${x} ${y}) scale(${size / 64})" stroke="#172637" stroke-width="${tactical(s) ? 2.2 : 3}" stroke-linecap="round" stroke-linejoin="round">${icon.paths.map((p) => `<path d="${p.d}" fill="${p.fill === "none" ? "none" : p.fill === "main" ? `url(#icon-${name in icons ? name : "inventory"})` : p.fill === "light" ? mix(icon.color, "#ffffff", 0.65) : "#ffd65a"}"/>`).join("")}<path d="M17 12l6-3" stroke="#fff" opacity=".6"/></g>`;
}
function avatar(x: number, y: number, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">${circle(0, 72, 32, "#112a3d", 'opacity=".2" transform="scale(1 .35) translate(0 130)"')}${r(-13, -18, 26, 27, "#f4d9b0", 4, "#234056", 2)}${r(-18, 11, 36, 38, "#e9f7fc", 3, "#234056", 2)}${r(-30, 15, 12, 34, "#20384b", 3)}${r(18, 15, 12, 34, "#20384b", 3)}${r(-16, 48, 14, 26, "#25364a", 2)}${r(2, 48, 14, 26, "#25364a", 2)}${circle(-5, -4, 1.5, "#27384b")}${circle(5, -4, 1.5, "#27384b")}</g>`;
}
function world(s: UiStyleDefinition, w: number, h: number) {
  let out = r(0, 0, w, h, "url(#sky)");
  const mobile = w < 500;
  const horizon = mobile ? h * 0.32 : h * 0.39;
  if (s.id === "bright-simulator") {
    out += `<g opacity=".85">${circle(w * 0.2, h * 0.17, 45, "#fff")}${circle(w * 0.24, h * 0.15, 62, "#fff")}${circle(w * 0.28, h * 0.18, 39, "#fff")}${circle(w * 0.78, h * 0.2, 55, "#fff")}${circle(w * 0.83, h * 0.18, 72, "#fff")}</g>`;
    out +=
      r(0, horizon, w, h - horizon, "url(#floor)") +
      poly(
        `0,${horizon - 45} ${w * 0.25},${horizon + 10} ${w * 0.18},${h * 0.67} 0,${h * 0.75}`,
        "#b97841",
      ) +
      poly(
        `0,${horizon - 45} ${w * 0.25},${horizon + 10} ${w * 0.18},${h * 0.67} 0,${h * 0.75}`,
        "url(#cliff)",
      ) +
      poly(
        `${w},${horizon - 60} ${w * 0.78},${horizon + 10} ${w * 0.83},${h * 0.63} ${w},${h * 0.78}`,
        "#b97841",
      ) +
      poly(
        `${w},${horizon - 60} ${w * 0.78},${horizon + 10} ${w * 0.83},${h * 0.63} ${w},${h * 0.78}`,
        "url(#cliff)",
      );
    out +=
      poly(
        `0,${horizon - 55} ${w * 0.25},${horizon + 3} ${w * 0.25},${horizon + 15} 0,${horizon - 35}`,
        "#6de532",
      ) +
      poly(
        `${w},${horizon - 70} ${w * 0.78},${horizon + 4} ${w * 0.78},${horizon + 19} ${w},${horizon - 50}`,
        "#6de532",
      );
    for (let i = 0; i < 10; i++)
      out += `<path d="M${w / 2} ${horizon}L${(i * w) / 7 - w * 0.16} ${h}" stroke="#2a962a" stroke-width="2" opacity=".17"/>`;
    for (let i = 1; i < 6; i++)
      out += `<path d="M0 ${horizon + (h - horizon) * ((i * i) / 36)}H${w}" stroke="#82f254" stroke-width="3" opacity=".4"/>`;
    for (const [x, y, k] of [
      [w * 0.32, horizon + 60, 0.8],
      [w * 0.72, horizon + 30, 0.65],
      [w * 0.87, horizon + 125, 1.1],
    ])
      out += `<g transform="translate(${x} ${y}) scale(${k})">${r(-8, 0, 16, 85, "#78502e")}${circle(0, -10, 45, "#2dba5b")}${circle(-27, 5, 30, "#66df55")}${circle(28, 1, 32, "#38cb66")}</g>`;
    if (!mobile)
      out += `<g transform="translate(210 322)">${r(0, 40, 145, 90, "#a97142", 4, "#633a27", 3)}${r(-8, 15, 162, 34, "#fffaf0", 3)}${[0, 1, 2, 3].map((i) => r(i * 42 - 8, 15, 21, 35, "#ff5969")).join("")}${r(16, 67, 111, 20, "#f2c065", 3)}${text(s, 72, 7, "WORKSHOP", 22, "#fff", "middle")}</g>`;
  } else if (tactical(s)) {
    out +=
      r(0, horizon, w, 130, "#54c9d9") +
      poly(
        `0,${horizon + 125} ${w * 0.32},${horizon + 82} ${w},${horizon + 115} ${w},${h} 0,${h}`,
        "url(#floor)",
      );
    out +=
      poly(
        `0,${horizon + 8} ${w * 0.12},${horizon - 18} ${w * 0.23},${horizon + 6}`,
        "#809aa0",
      ) +
      poly(
        `${w * 0.7},${horizon + 6} ${w * 0.83},${horizon - 20} ${w},${horizon + 9}`,
        "#88a2a4",
      );
    out += `<g transform="translate(${mobile ? 22 : 165} ${horizon - 85}) scale(${mobile ? 0.65 : 1})">${poly("0,200 100,158 228,190 125,234", "#263a47")}${poly("40,4 90,-10 150,10 100,26", "#657a86")}${poly("40,4 100,26 100,197 40,177", "#344d61")}${poly("100,26 150,10 150,179 100,197", "#172b3f")}${r(55, 30, 31, 115, "#26cadc", 3, "#a4ffff", 3)}${r(117, 40, 15, 102, "#4a656e", 2)}${r(30, 187, 130, 12, "#ffb743", 2)}</g>`;
    out +=
      poly(
        `${w * 0.38},${h * 0.66} ${w * 0.67},${h * 0.64} ${w * 0.87},${h * 0.92} ${w * 0.23},${h * 0.94}`,
        "#485e6b",
        'stroke="#8aa1ad" stroke-width="8"',
      ) +
      poly(
        `${w * 0.42},${h * 0.7} ${w * 0.64},${h * 0.69} ${w * 0.78},${h * 0.87} ${w * 0.32},${h * 0.88}`,
        "#7b8a91",
        'stroke="#f0c25d" stroke-width="4"',
      );
    out += `<g transform="translate(${w * 0.72} ${horizon + 60})">${r(0, 0, mobile ? 68 : 165, 110, "#243b4a", 5, "#718d99", 5)}${r(12, 18, mobile ? 44 : 141, 65, "#65d1dc", 2)}${r(7, 87, mobile ? 54 : 151, 12, "#f3bd61")}</g>`;
  } else {
    out +=
      r(0, horizon, w, h - horizon, "url(#floor)") +
      r(0, horizon, w, h - horizon, "url(#studs)");
    out += `<g transform="translate(${w * 0.51} ${horizon + 80})">${circle(0, 5, mobile ? 94 : 132, "#27344a", 'stroke="#d33aff" stroke-width="17"')}${circle(0, 5, mobile ? 78 : 111, "url(#energy)", 'stroke="#75fff1" stroke-width="10"')}${circle(0, 5, mobile ? 54 : 85, "#f0ffff", 'opacity=".55"')}${r(-80, 117, 160, 24, "#27344a", 4, "#72fff0", 5)}</g>`;
    for (let i = 0; i < 4; i++) {
      const x = w * 0.76 + (i % 2) * 70,
        y = horizon + 40 + Math.floor(i / 2) * 95;
      out += `<g transform="translate(${x} ${y})">${poly("-30,42 34,31 64,52 -1,65", "#e8eafa")}${r(-13, 9, 39, 37, "#43f4ed", 3, "#ecffff", 3)}${presetIcon(s, ["inventory", "strength", "potion", "gift"][i], -16, -37, 45)}</g>`;
    }
    out +=
      poly(
        `0,${h * 0.84} ${w},${h * 0.56} ${w},${h * 0.6} 0,${h * 0.89}`,
        "#b733ef",
        'opacity=".7"',
      ) +
      `<path d="M0 ${h * 0.86}L${w} ${h * 0.58}" stroke="#58fff0" stroke-width="5"/>`;
  }
  return (
    out +
    avatar(
      w * (mobile ? 0.52 : 0.53),
      h * (mobile ? 0.56 : 0.67),
      mobile ? 0.65 : 0.8,
    )
  );
}
function tile(
  s: UiStyleDefinition,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label = icons[name]?.label || name,
  active = false,
) {
  const dark = tactical(s),
    rad = dark ? 6 : 12,
    fill = dark
      ? "#273b4b"
      : `url(#tile-${name in icons ? name : "inventory"})`;
  return `<g data-component="navigation-${esc(name)}">${r(x, y + 5, w, h, "#142135", rad)}${r(x, y, w, h, fill, rad, active ? "#fff" : "#142135", active ? 4 : 3)}${presetIcon(s, name, x + (w - h * 0.6) / 2, y + 5, h * 0.6)}${text(s, x + w / 2, y + h - 10, label, Math.min(dark ? 16 : 20, (w - 12) / (label.length * 0.64)), "#fff", "middle", !dark)}</g>`;
}
function button(
  s: UiStyleDefinition,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  icon = "play",
  fill?: string,
) {
  return `<g data-component="primary-action">${r(x, y + 5, w, h, "#122431", tactical(s) ? 5 : 12)}${r(x, y, w, h, fill || s.palette.primary, tactical(s) ? 5 : 12, "#152638", 3)}${presetIcon(s, icon, x + 14, y + 9, h - 18)}${text(s, x + (w + h - 6) / 2, y + h / 2 + 9, label, Math.min(w < 180 ? 22 : 29, (w - h - 26) / (label.length * 0.6)), tactical(s) ? "#132331" : "#ffffff", "middle")}</g>`;
}
function nav(s: UiStyleDefinition, w: number, h: number) {
  const m = w < 500;
  let out = "";
  if (m) {
    const names = s.navigation.slice(0, neon(s) ? 4 : 3),
      size = neon(s) ? 78 : 96,
      gap = 9,
      start = (w - (size + gap) * names.length + gap) / 2;
    names.forEach(
      (n, i) => (out += tile(s, n, start + i * (size + gap), h - 87, size, 68)),
    );
    return out;
  }
  if (tactical(s)) {
    s.navigation.forEach(
      (n, i) => (out += tile(s, n, 25 + i * 91, h - 93, 82, 66)),
    );
    return out;
  }
  s.navigation.forEach((n, i) => {
    const cols = neon(s) ? 2 : 1;
    out += tile(
      s,
      n,
      18 + (i % cols) * 102,
      170 + Math.floor(i / cols) * (neon(s) ? 105 : 111),
      neon(s) ? 92 : 111,
      neon(s) ? 94 : 98,
    );
  });
  return out;
}
function hud(s: UiStyleDefinition, w: number, h: number) {
  const m = w < 500;
  let out = world(s, w, h);
  if (tactical(s)) {
    out +=
      r(22, m ? 45 : 46, m ? 226 : 290, 53, "#182b39", 6, "#76939f", 2) +
      presetIcon(s, "coins", 29, m ? 49 : 50, 45) +
      text(s, 82, m ? 80 : 82, "$2,400", 32) +
      r(
        m ? 13 : w / 2 - 250,
        m ? 103 : 60,
        m ? w - 26 : 500,
        m ? 75 : 94,
        "#182b39",
        6,
        "#76939f",
        2,
      ) +
      text(
        s,
        w / 2,
        m ? 133 : 101,
        "BUILD YOUR ADVENTURE",
        m ? 22 : 34,
        "#fff",
        "middle",
      ) +
      text(
        s,
        w / 2,
        m ? 159 : 135,
        "Explore your next upgrade",
        m ? 15 : 20,
        "#ecf6fa",
        "middle",
      );
    out += button(
      s,
      m ? "OPEN GEAR" : "OPEN EQUIPMENT",
      m ? 45 : w - 284,
      m ? h - 174 : h - 102,
      m ? 300 : 255,
      58,
      "inventory",
      s.palette.accent,
    );
  } else {
    out +=
      text(
        s,
        w / 2,
        m ? 85 : 91,
        "BUILD YOUR ADVENTURE",
        m ? 24 : 40,
        "#fff",
        "middle",
      ) +
      text(
        s,
        w / 2,
        m ? 115 : 126,
        "Collect · Upgrade · Explore",
        m ? 17 : 24,
        "#fff",
        "middle",
      );
    if (m) {
      out +=
        r(16, 140, 166, 48, "#142738", 12, "#f4f8ff", 2) +
        presetIcon(s, "coins", 21, 145, 39) +
        text(s, 68, 174, "2,400", 25) +
        r(198, 140, 175, 48, "#142738", 12, "#f4f8ff", 2) +
        presetIcon(s, "gem", 203, 146, 38) +
        text(s, 249, 174, "25", 25);
    } else {
      out +=
        presetIcon(s, "coins", 23, h - 144, 58) +
        text(s, 87, h - 103, "$2,400", 40, "#a7ff55") +
        presetIcon(s, "gem", 23, h - 80, 54) +
        text(s, 87, h - 42, "25 GEMS", 30, "#8ff8ff");
    }
    if (neon(s)) {
      const px = m ? 18 : 337,
        py = m ? h - 222 : h - 132,
        pw = m ? w - 36 : 595;
      out +=
        r(px, py, pw, 46, "#132134", 14, "#152135", 3) +
        r(px + 4, py + 4, pw * 0.67, 38, "#4be969", 10) +
        text(s, px + 18, py + 32, "LEVEL 3", 25) +
        text(s, px + pw - 17, py + 32, "130 / 164", 23, "#fff", "end");
      out += button(
        s,
        "+ POWER",
        m ? 55 : 410,
        py + 58,
        m ? 280 : 420,
        55,
        "strength",
        "#b63bff",
      );
      if (!m) {
        out +=
          tile(s, "gift", w - 193, 228, 171, 88, "Daily gift") +
          tile(s, "potion", w - 193, 335, 171, 88, "Boosts");
      }
    } else
      out += button(
        s,
        "EXPLORE",
        m ? 61 : 910,
        m ? h - 176 : h - 94,
        m ? 268 : 316,
        64,
        "world",
        "#ffcf38",
      );
  }
  return out + nav(s, w, h);
}
const products = [
  { icon: "inventory", name: "Starter Crate", price: "250" },
  { icon: "potion", name: "Power Potion", price: "750" },
  { icon: "gem", name: "Comet Charm", price: "1,250" },
];
function screenPanel(
  s: UiStyleDefinition,
  w: number,
  h: number,
  title: string,
) {
  const m = w < 500,
    x = m ? 14 : tactical(s) ? 58 : 148,
    y = m ? 74 : 67,
    pw = m ? w - 28 : w - (tactical(s) ? 116 : 296),
    ph = m ? h - 171 : h - 122;
  return {
    x,
    y,
    pw,
    ph,
    svg:
      world(s, w, h) +
      r(0, 0, w, h, "#0c1830", 0, "none", 1, 'opacity=".37"') +
      r(x, y + 6, pw, ph, "#0c1728", 18) +
      r(
        x,
        y,
        pw,
        ph,
        "url(#panel)",
        tactical(s) ? 6 : 18,
        tactical(s) ? "#668594" : "#152638",
        tactical(s) ? 2 : 4,
      ) +
      text(
        s,
        x + 24,
        y + 44,
        title,
        m ? 29 : 39,
        tactical(s) || neon(s) ? "#fff" : "#254062",
        "start",
        neon(s),
      ) +
      presetIcon(s, "close", x + pw - 48, y + 16, 29),
  };
}
function itemCard(
  s: UiStyleDefinition,
  item: (typeof products)[number],
  x: number,
  y: number,
  w: number,
  h: number,
  selected = false,
) {
  const dark = tactical(s) || neon(s);
  return `<g data-component="item-card">${r(x, y, w, h, dark ? "#344660" : "#e0f4fa", tactical(s) ? 4 : 14, selected ? s.palette.accent : dark ? "#58708e" : "#98c9d8", selected ? 5 : 2)}${presetIcon(s, item.icon, x + w * 0.25, y + 10, w * 0.5)}${text(s, x + w / 2, y + h - 53, item.name, w < 155 ? 15 : 21, dark ? "#fff" : "#24384b", "middle", neon(s))}${presetIcon(s, "coins", x + w / 2 - 43, y + h - 42, 27)}${text(s, x + w / 2 - 7, y + h - 20, item.price, w < 155 ? 17 : 22, dark ? "#fff" : "#24384b", "start", neon(s))}</g>`;
}
function shop(s: UiStyleDefinition, w: number, h: number) {
  const m = w < 500,
    p = screenPanel(s, w, h, "SHOP");
  let out = p.svg;
  const dark = tactical(s) || neon(s),
    ink = dark ? "#fff" : "#26394a";
  if (tactical(s)) {
    const listX = p.x + 18,
      listY = p.y + 72,
      listW = m ? p.pw - 36 : Math.floor(p.pw * 0.43);
    products.forEach((item, i) => {
      const yy = listY + i * 95;
      out +=
        r(
          listX,
          yy,
          listW,
          84,
          i === 1 ? "#375b70" : "#253a49",
          5,
          i === 1 ? "#3de7e7" : "#607a89",
          2,
        ) +
        presetIcon(s, item.icon, listX + 9, yy + 10, 60) +
        text(s, listX + 81, yy + 35, item.name, m ? 19 : 23) +
        text(s, listX + 81, yy + 62, item.price + " coins", 18, "#b6d4df");
    });
    const dx = m ? p.x + 24 : p.x + listW + 63,
      dy = m ? listY + 303 : listY + 28;
    out +=
      presetIcon(s, "potion", dx + (m ? 22 : 28), dy, m ? 88 : 170) +
      text(
        s,
        m ? dx + 130 : dx + 15,
        dy + (m ? 37 : 220),
        "Power Potion",
        m ? 22 : 31,
      ) +
      text(
        s,
        m ? dx + 130 : dx + 15,
        dy + (m ? 66 : 255),
        "750 coins",
        m ? 20 : 23,
        "#58e6e8",
      );
    out += button(
      s,
      "VIEW ITEM",
      p.x + 24,
      p.y + p.ph - 88,
      p.pw - 48,
      61,
      "shop",
      s.palette.accent,
    );
  } else {
    if (m) {
      products.forEach((item, i) => {
        const y = p.y + 72 + i * 120;
        out +=
          r(
            p.x + 17,
            y,
            p.pw - 34,
            106,
            neon(s) ? "#344660" : "#e8f7fc",
            12,
            i === 1 ? s.palette.accent : "#a0bccf",
            i === 1 ? 4 : 2,
          ) +
          presetIcon(s, item.icon, p.x + 29, y + 12, 78) +
          text(s, p.x + 121, y + 38, item.name, 23, ink) +
          presetIcon(s, "coins", p.x + 119, y + 53, 29) +
          text(s, p.x + 156, y + 77, item.price + " coins", 20, ink);
      });
      out += button(
        s,
        "VIEW ITEM",
        p.x + 26,
        p.y + p.ph - 89,
        p.pw - 52,
        62,
        "shop",
        neon(s) ? "#b63bff" : "#40dd68",
      );
    } else {
      const gap = 18,
        cw = (p.pw - 80) / 3;
      products.forEach(
        (item, i) =>
          (out += itemCard(
            s,
            item,
            p.x + 22 + i * (cw + gap),
            p.y + 90,
            cw,
            330,
            i === 1,
          )),
      );
      out += button(
        s,
        "VIEW ITEM",
        p.x + p.pw / 2 - 190,
        p.y + p.ph - 96,
        380,
        64,
        "shop",
        neon(s) ? "#b63bff" : "#3ee56e",
      );
    }
  }
  return (
    out +
    text(
      s,
      w / 2,
      p.y + p.ph - 11,
      "Sample items · purchases off",
      m ? 12 : 17,
      dark ? "#b8cbdc" : "#5a7182",
      "middle",
      false,
    ) +
    nav(s, w, h)
  );
}
function inventory(s: UiStyleDefinition, w: number, h: number) {
  const m = w < 500,
    p = screenPanel(s, w, h, tactical(s) ? "EQUIPMENT" : "INVENTORY");
  let out = p.svg;
  const dark = tactical(s) || neon(s),
    ink = dark ? "#fff" : "#26394a";
  if (tactical(s)) {
    const ww = m ? p.pw - 36 : 340;
    products.forEach(
      (item, i) =>
        (out +=
          r(
            p.x + 18,
            p.y + 73 + i * 91,
            ww,
            78,
            i === 1 ? "#3c6074" : "#253a49",
            4,
            i === 1 ? "#42f2ed" : "#607c8c",
            2,
          ) +
          presetIcon(s, item.icon, p.x + 28, p.y + 79 + i * 91, 62) +
          text(s, p.x + 109, p.y + 119 + i * 91, item.name, m ? 18 : 23)),
    );
    const ix = m ? p.x + 35 : p.x + ww + 110,
      iy = m ? p.y + 360 : p.y + 121;
    out +=
      presetIcon(s, "potion", ix, iy, m ? 87 : 184) +
      text(
        s,
        m ? ix + 115 : ix + 92,
        iy + (m ? 35 : 226),
        "Power Potion",
        m ? 20 : 29,
        ink,
        m ? "start" : "middle",
      ) +
      text(
        s,
        m ? ix + 115 : ix + 92,
        iy + (m ? 66 : 262),
        "READY TO EQUIP",
        m ? 13 : 18,
        "#58e6e8",
        m ? "start" : "middle",
      );
  } else {
    const cols = m ? 2 : neon(s) ? 3 : 3,
      size = m ? (p.pw - 52) / 2 : neon(s) ? 162 : 220;
    const count = neon(s) ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const x = p.x + 18 + (i % cols) * (size + 16),
        y = p.y + 79 + Math.floor(i / cols) * (m ? 153 : 183),
        item = products[i % 3];
      out +=
        r(
          x,
          y,
          size,
          m ? 139 : 166,
          dark ? "#354966" : "#e2f7fb",
          12,
          i === 1 ? s.palette.accent : dark ? "#7386b1" : "#a2ccd5",
          i === 1 ? 5 : 2,
        ) +
        presetIcon(s, item.icon, x + size / 2 - 41, y + 8, 82) +
        text(
          s,
          x + size / 2,
          y + (m ? 120 : 144),
          item.name,
          m ? 13 : 17,
          ink,
          "middle",
          neon(s),
        );
    }
    if (!m && neon(s))
      out +=
        presetIcon(s, "potion", p.x + p.pw - 205, p.y + 142, 160) +
        text(
          s,
          p.x + p.pw - 124,
          p.y + 341,
          "SELECTED",
          24,
          "#75fff4",
          "middle",
        );
  }
  out += button(
    s,
    "EQUIP",
    p.x + 25,
    p.y + p.ph - 90,
    p.pw - 50,
    63,
    "check",
    tactical(s) ? s.palette.accent : neon(s) ? "#a54fff" : "#4de67c",
  );
  return out + nav(s, w, h);
}
function menu(s: UiStyleDefinition, w: number, h: number) {
  const m = w < 500;
  let out =
    world(s, w, h) + r(0, 0, w, h, "#112337", 0, "none", 1, 'opacity=".2"');
  if (tactical(s)) {
    const x = m ? 19 : 65,
      y = m ? 98 : 122,
      pw = m ? w - 38 : 473;
    out +=
      r(x, y, pw, m ? 565 : 485, "#182b3c", 7, "#668a9c", 2) +
      text(s, x + 26, y + 47, "MISSION CONTROL", m ? 29 : 35) +
      text(s, x + 26, y + 87, "YOUR ADVENTURE", m ? 24 : 30, "#60e4ea") +
      text(
        s,
        x + 26,
        y + 132,
        "Collect. Upgrade. Explore.",
        m ? 18 : 22,
        "#cbdfeb",
      );
    out +=
      presetIcon(s, "inventory", x + 30, y + 173, m ? 108 : 132) +
      presetIcon(s, "world", x + pw - 156, y + 176, m ? 105 : 132);
    out +=
      button(
        s,
        "PLAY",
        x + 25,
        y + (m ? 398 : 348),
        pw - 50,
        76,
        "play",
        s.palette.accent,
      ) +
      text(
        s,
        x + pw / 2,
        y + (m ? 513 : 452),
        "SETTINGS  ·  INVENTORY",
        m ? 15 : 19,
        "#c5dce6",
        "middle",
        false,
      );
  } else {
    const cx = w / 2;
    out +=
      text(
        s,
        cx,
        m ? 150 : 178,
        "YOUR ADVENTURE",
        m ? 34 : 68,
        "#fff",
        "middle",
      ) +
      text(
        s,
        cx,
        m ? 189 : 221,
        "Collect · Upgrade · Explore",
        m ? 19 : 28,
        "#fff",
        "middle",
      );
    out += presetIcon(
      s,
      neon(s) ? "strength" : "inventory",
      cx - (m ? 68 : 90),
      m ? 236 : 270,
      m ? 136 : 180,
    );
    out += button(
      s,
      "PLAY",
      cx - (m ? 150 : 238),
      m ? 439 : 484,
      m ? 300 : 476,
      m ? 77 : 86,
      "play",
      neon(s) ? "#bd40ff" : "#4ee564",
    );
    const names = ["inventory", "shop", "settings"],
      tileW = m ? 91 : 122;
    names.forEach(
      (n, i) =>
        (out += tile(
          s,
          n,
          cx - (tileW + 12) * 1.5 + i * (tileW + 12) + 6,
          m ? 556 : 602,
          tileW,
          m ? 96 : 82,
        )),
    );
  }
  return out;
}
function svg(s: UiStyleDefinition, w: number, h: number, content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(s.englishName)} style preset" font-family="${tactical(s) ? "Segoe UI, Arial, sans-serif" : "Trebuchet MS, Arial, sans-serif"}">${defs(s)}${content}</svg>`;
}
export function renderPresetScreen(
  s: UiStyleDefinition,
  screen: PresetScreen,
  device: "desktop" | "mobile",
) {
  const w = device === "mobile" ? 390 : 1280,
    h = device === "mobile" ? 844 : 720;
  const content =
    screen === "hud"
      ? hud(s, w, h)
      : screen === "shop"
        ? shop(s, w, h)
        : screen === "inventory"
          ? inventory(s, w, h)
          : menu(s, w, h);
  return svg(s, w, h, content);
}
export function renderPresetCover(s: UiStyleDefinition) {
  let out = r(0, 0, 512, 512, s.palette.ink, 72);
  out += r(14, 14, 484, 484, s.palette.primary, 62, "#ffffff", 5);
  out += circle(
    256,
    242,
    176,
    neon(s) ? "url(#energy)" : tactical(s) ? "#263a49" : "#88ee85",
  );
  out += presetIcon(
    s,
    neon(s) ? "strength" : tactical(s) ? "inventory" : "world",
    125,
    100,
    262,
  );
  out +=
    presetIcon(s, neon(s) ? "gem" : "coins", 309, 315, 126) +
    presetIcon(s, "check", 77, 338, 104);
  return svg(s, 512, 512, out);
}
export function renderPresetIconSheet(s: UiStyleDefinition) {
  let out = r(0, 0, 800, 600, tactical(s) || neon(s) ? "#1c2d44" : "#edf8fc");
  Object.entries(icons).forEach(([name, icon], i) => {
    const x = 20 + (i % 5) * 156,
      y = 15 + Math.floor(i / 5) * 192;
    out +=
      r(
        x,
        y,
        140,
        166,
        tactical(s) || neon(s) ? "#304760" : "#cfeff6",
        14,
        s.palette.primary,
        2,
      ) +
      presetIcon(s, name, x + 28, y + 12, 85) +
      text(
        s,
        x + 70,
        y + 137,
        icon.label,
        20,
        tactical(s) || neon(s) ? "#fff" : "#243b4a",
        "middle",
        neon(s),
      );
  });
  return svg(s, 800, 600, out);
}

import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const root = resolve(import.meta.dirname, ".."),
  assets = resolve(root, ".agents/skills/roblox-ui-styles/assets"),
  out = resolve(root, "outputs/roblox-ui-styles-review");
mkdirSync(out, { recursive: true });
const source = JSON.parse(
    readFileSync(resolve(assets, "presets.json"), "utf8"),
  ),
  browser = await chromium.launch({ headless: true }),
  page = await browser.newPage();
const checks: any[] = [],
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const preset of source.presets)
    for (const device of ["desktop", "mobile"])
      for (const screen of ["hud", "menu", "shop", "inventory"]) {
        const width = device === "mobile" ? 390 : 1280,
          height = device === "mobile" ? 844 : 720,
          svg = readFileSync(
            resolve(assets, `${preset.id}-${screen}-${device}.svg`),
            "utf8",
          );
        await page.setViewportSize({ width, height });
        await page.setContent(
          `<html><body style="margin:0">${svg}</body></html>`,
        );
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll("text")].flatMap((el) => {
            const b = el.getBoundingClientRect(),
              group = el.closest("[data-component]"),
              card = group?.querySelector("rect"),
              c = card?.getBoundingClientRect();
            const outside =
              b.left < -3 ||
              b.right > innerWidth + 3 ||
              b.top < -3 ||
              b.bottom > innerHeight + 3;
            const outsideControl =
              c &&
              (b.left < c.left - 4 ||
                b.right > c.right + 4 ||
                b.top < c.top - 4 ||
                b.bottom > c.bottom + 4);
            return outside || outsideControl
              ? [
                  {
                    text: el.textContent,
                    left: b.left,
                    right: b.right,
                    top: b.top,
                    bottom: b.bottom,
                    control: group?.getAttribute("data-component"),
                  },
                ]
              : [];
          }),
        );
        const nonEnglish = await page.locator("svg text").allTextContents();
        if (nonEnglish.some((text) => /\p{Script=Cyrillic}/u.test(text)))
          errors.push(
            `${preset.id}/${screen}/${device}: authored non-English text`,
          );
        if (overflow.length)
          errors.push(
            `${preset.id}/${screen}/${device}: ${JSON.stringify(overflow)}`,
          );
        const file = `${preset.id}-${screen}-${device}.png`;
        await page.screenshot({ path: resolve(out, file) });
        checks.push({ preset: preset.id, screen, device, file, overflow });
      }
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roblox UI Styles — проверка заготовок</title><style>body{margin:24px;background:#edf2ed;font:15px Segoe UI;color:#21382b}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}article{background:white;border-radius:14px;padding:16px}img{width:100%;height:auto;border-radius:8px}h1{font-size:24px}p{color:#647566}@media(max-width:900px){main{grid-template-columns:1fr}}</style><h1>Готовые пакеты Roblox UI</h1><p>Заготовки оформления из roblox-ui-styles. Это не снимки созданной игры.</p><main>${source.presets.map((s: any) => `<article><h2>${s.name}</h2><p>${s.signature}</p><img src="${s.id}-hud-desktop.png" alt="${s.englishName}"><img src="../../.agents/skills/roblox-ui-styles/assets/icons-${s.id}.svg" alt="Набор иконок"></article>`).join("")}</main></html>`;
  writeFileSync(resolve(out, "index.html"), html);
  await page.setViewportSize({ width: 1680, height: 1100 });
  await page.goto(
    "file:///" + resolve(out, "index.html").replaceAll("\\", "/"),
  );
  await page.locator("img").last().waitFor();
  await page.screenshot({
    path: resolve(out, "contact-sheet.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(root, "docs/verification/ui-style-kit-artwork.json"),
    JSON.stringify({ at: new Date().toISOString(), checks, errors }, null, 2),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      presets: source.presets.length,
      screens: checks.length,
      errors,
    }),
  );
} finally {
  await browser.close();
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { Store, safePath } from "../server/store.js";
import { Vault } from "../server/vault.js";
import { presentStyle } from "../shared/style-display.js";

const root = resolve(import.meta.dirname, ".."),
  out = resolve(root, process.argv[2] || "outputs/style-review");
const native = process.argv.includes("--native");
mkdirSync(resolve(out, "assets"), { recursive: true });
const store = new Store(resolve(root, "data"));
const token = await new Vault(store).get("dashboard-token");
store.close();
const controls = JSON.parse(
  readFileSync(resolve(root, "docs/control-projects/projects.json"), "utf8"),
);
const projectArg = process.argv.indexOf("--project");
if (projectArg !== -1) {
  controls.projects = controls.projects.filter(
    (p: any) => p.key === process.argv[projectArg + 1],
  );
  if (!controls.projects.length) throw new Error("Unknown project filter");
}
const groups: any[] = [],
  statuses: any[] = [];
for (const [i, entry] of controls.projects.entries()) {
  const response = await fetch(
    "http://127.0.0.1:4317/api/projects/" + entry.id,
    { headers: { Authorization: "Bearer " + token } },
  );
  const detail = await response.json();
  if (!response.ok) throw new Error(detail.error);
  statuses.push({
    name: entry.name,
    styles: detail.styles.length,
    tasks: detail.tasks.map((t: any) => ({
      status: t.status,
      attempt: t.attempt,
      error: t.error,
    })),
  });
  if (detail.styles.length !== 3) continue;
  const styles = [];
  for (const [j, style] of detail.styles.entries()) {
    const previewTask = detail.tasks.find((t: any) => t.id === style.previewTaskId);
    if (
      native &&
      (!previewTask?.result?.data?.localization ||
        previewTask.result.data.localization.sourceLocaleId !== "en-us" ||
        !style.studioEvidence ||
        !["studio", "approved"].includes(style.status) ||
        style.previews.length !== 8 ||
        style.previews.some((v: any) => v.kind !== "studio"))
    )
      throw new Error(
        "Нативная галерея пока не готова: " + entry.name + " / " + style.name,
      );
    const previews = [];
    for (const v of style.previews) {
      const extension = v.file.endsWith(".png")
        ? "png"
        : v.file.endsWith(".jpg")
          ? "jpg"
          : "svg";
      const name = `p${i + 1}-v${j + 1}-${v.screen}-${v.device}.${extension}`;
      copyFileSync(
        safePath(resolve(root, "data"), v.file),
        resolve(out, "assets", name),
      );
      previews.push({ ...v, file: "assets/" + name });
    }
    styles.push({
      ...style,
      number: j + 1,
      presentation: presentStyle(style.familyId),
      previews,
    });
  }
  groups.push({ ...entry, concept: detail.project.concept, styles });
}
if (groups.length !== controls.projects.length) {
  console.log(JSON.stringify(statuses, null, 2));
  process.exit(2);
}
const css = `*{box-sizing:border-box}body{margin:0;background:#f4f5f1;color:#243730;font:15px/1.6 'Segoe UI',Arial,sans-serif}header{background:#fff;border-bottom:1px solid #dce3d7;padding:26px 34px}h1{font-size:30px;letter-spacing:-.8px;margin:0}p{color:#667661;margin:8px 0}.badge{font-size:12px;border-radius:20px;background:#eaf1e4;color:#476139;padding:5px 11px;display:inline-block}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:18px}button,select{font:inherit;cursor:pointer;border:1px solid #d6dfd0;background:#fff;padding:10px 15px;border-radius:7px;color:#435b3b}button.active{background:#286a4c;color:#fff;border-color:#286a4c}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #b0903c;outline-offset:3px}main{padding:24px 30px;max-width:1600px;margin:auto}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:23px}.card{background:white;border:1px solid #dce4d6;border-radius:12px;padding:19px;min-width:0}.card h2{margin:8px 0;font-size:22px;line-height:1.35}.image-button{display:block;width:100%;padding:0;border:0;background:#eef1e9;cursor:zoom-in}.image-button img{display:block;width:100%;height:590px;object-fit:contain;border-radius:7px}.image-button img.desktop{height:auto;aspect-ratio:16/9}.card h3{font-size:14px;margin:14px 0 4px}.card p{font-size:14px}.swatches{display:flex;gap:6px;margin-top:12px}.swatches span{width:23px;height:23px;border-radius:50%;border:1px solid #a1aa98}details{font-size:13px;color:#536b47;margin-top:15px}summary{cursor:pointer}details section{margin:14px 0}details p{font-size:12px}.reference{border-top:1px solid #edf0e8;padding:10px 0}a{color:#286a4c}small{display:block;color:#667661;font-size:11px;overflow-wrap:anywhere}footer{padding:26px;text-align:center;color:#667661;font-size:13px}.legend{background:#eaf0e3;border-radius:8px;padding:14px 20px;margin:0 0 23px;color:#536947;font-size:13px}dialog{padding:20px;border:0;border-radius:10px;background:#f4f5f1;max-width:96vw;max-height:96vh}dialog::backdrop{background:#14221be8}dialog img{display:block;max-width:90vw;max-height:82vh;object-fit:contain}dialog button{display:block;margin:0 0 12px auto}.counter{font-size:12px;color:#667661;margin-left:auto}@media(max-width:950px){.cards{grid-template-columns:1fr}.image-button img{height:650px}.toolbar .counter{margin-left:0}header{padding:20px}main{padding:16px}}`;
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Оформление трёх контрольных игр</title><link rel="stylesheet" href="review.css"></head><body><header><span class="badge">Концепции утверждены · оформление на выбор</span><h1>Как будут выглядеть ваши игры</h1><p>Мир, персонаж и интерфейс сравниваются вместе.</p><div class="toolbar" id="projects" aria-label="Игра"></div><div class="toolbar"><select id="screen" aria-label="Экран"><option value="hud">Сцена и HUD</option><option value="shop">Магазин</option><option value="inventory">Инвентарь</option><option value="menu">Главное меню</option></select><button id="mobile" class="active" aria-pressed="true">Телефон · 390×844</button><button id="desktop" aria-pressed="false">Компьютер · 1280×720</button><span class="counter">Нажмите изображение, чтобы рассмотреть крупнее</span></div></header><main><div class="legend">Собственные эскизы. Выбранный вариант далее проверяется в работающей сцене Roblox Studio. Числа и цены демонстрационные; покупок нет.</div><div class="cards" id="cards"></div></main><footer>Выберите по одному варианту для каждой игры. Можно сочетать совместимые элементы.</footer><dialog id="zoom" aria-label="Эскиз оформления"><button id="close" autofocus>Закрыть ×</button><img id="large" alt="Крупный предпросмотр"></dialog><script src="review.js"></script></body></html>`;
const data = JSON.stringify(groups).replace(/</g, "\\u003c");
const js = `const groups=${data};let project=0,screen='hud',device='mobile';const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function render(){document.getElementById('projects').innerHTML=groups.map((p,i)=>'<button data-project="'+i+'" class="'+(i===project?'active':'')+'" aria-pressed="'+(i===project)+'">'+esc(p.name)+'</button>').join('');document.querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>{project=Number(b.dataset.project);render()});document.getElementById('cards').innerHTML=groups[project].styles.map(s=>{const view=s.previews.find(v=>v.screen===screen&&v.device===device);const r=s.rules,d=s.presentation;return '<article class="card"><span class="badge">Вариант '+s.number+' · '+esc(d.label)+'</span><h2>'+esc(s.name)+'</h2><button class="image-button" aria-label="Увеличить '+esc(s.name)+'"><img class="'+device+'" src="'+esc(view.file)+'" alt="'+esc(s.name+' '+screen)+'"></button><div class="swatches" aria-label="Цвета оформления">'+Object.values(r.palette).map(c=>'<span style="background:'+esc(c)+'"></span>').join('')+'</div><p>'+esc(d.world+' '+d.ui)+'</p><details><summary>Мир, персонаж и интерфейс</summary>'+[['Материалы','materials'],['Свет','lighting'],['Персонаж','avatar'],['Шрифты','typography'],['Игровой экран','hud'],['Магазин','shop'],['Инвентарь','inventory'],['Телефон','mobile']].map(([label,key])=>'<section><strong>'+label+'</strong><p>'+esc(Array.isArray(r[key])?r[key].join(', '):r[key])+'</p></section>').join('')+'</details><details><summary>Источники и степень проверки</summary>'+s.references.map(v=>'<section class="reference"><a href="'+esc(v.url)+'" target="_blank" rel="noreferrer">'+esc(v.game)+'</a> · '+esc(v.author)+'<p>'+esc(v.observations)+'</p><small>'+esc(v.screen+' · '+v.device+' · '+v.checkedAt+' · '+v.confidence)+'</small></section>').join('')+'</details></article>'}).join('');document.querySelectorAll('.image-button').forEach(b=>b.onclick=()=>{document.getElementById('large').src=b.querySelector('img').src;document.getElementById('zoom').showModal()});}document.getElementById('screen').onchange=e=>{screen=e.target.value;render()};for(const d of ['mobile','desktop'])document.getElementById(d).onclick=()=>{device=d;for(const x of ['mobile','desktop']){document.getElementById(x).classList.toggle('active',x===d);document.getElementById(x).setAttribute('aria-pressed',String(x===d))}render()};document.getElementById('close').onclick=()=>document.getElementById('zoom').close();render();`;
const pageHtml = native
  ? html
      .replace(
        "Концепции утверждены · оформление на выбор",
        "Настоящие сцены Roblox Studio · оформление на выбор",
      )
      .replace("Компьютер · 1280×720", "Компьютер · 1366×768")
      .replace(
        "Собственные эскизы. Выбранный вариант далее проверяется в работающей сцене Roblox Studio. Числа и цены демонстрационные; покупок нет.",
        "Снимки работающих сцен Roblox Studio. Проверены четыре экрана на компьютере и телефоне в симуляторе. Числа и цены демонстрационные; настоящих покупок нет. Это выбор оформления, а не приёмка готовой игры.",
      )
      .replace("Эскиз оформления", "Сцена Roblox Studio")
  : html.replace(
      "Концепции утверждены · оформление на выбор",
      "Эскизы · оформление пока не утверждено",
    );
const finalHtml =
  groups.length === 1
    ? pageHtml
        .replace(
          "Оформление трёх контрольных игр",
          "Оформление контрольной игры",
        )
        .replace("Как будут выглядеть ваши игры", "Три варианта оформления")
        .replace(
          "Выберите по одному варианту для каждой игры. Можно сочетать совместимые элементы.",
          "Выберите один вариант для этой игры. Можно уточнить оформление по фидбеку.",
        )
    : pageHtml;
writeFileSync(resolve(out, "index.html"), finalHtml);
writeFileSync(resolve(out, "review.css"), css);
writeFileSync(resolve(out, "review.js"), js);
writeFileSync(resolve(out, "styles.json"), JSON.stringify(groups, null, 2));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve(out, "index.html")).href);
  for (let i = 0; i < groups.length; i++) {
    await page.locator('[data-project="' + i + '"]').click();
    for (const device of ["mobile", "desktop"]) {
      await page.locator("#" + device).click();
      for (const screen of ["hud", "shop", "inventory", "menu"]) {
        await page.locator("#screen").selectOption(screen);
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll<HTMLImageElement>(".card img")]
              .length === 3 &&
            [...document.querySelectorAll<HTMLImageElement>(".card img")].every(
              (i) => i.complete && i.naturalWidth > 0,
            ),
        );
        if (screen === "shop" || screen === "hud")
          await page.screenshot({
            path: resolve(
              out,
              groups[i].key + "-" + screen + "-" + device + ".png",
            ),
            fullPage: true,
          });
      }
    }
    await page.locator("#mobile").click();
    await page.locator("#screen").selectOption("hud");
    await page.screenshot({
      path: resolve(out, groups[i].key + "-comparison.png"),
      fullPage: true,
    });
  }
  await page.locator(".image-button").first().click();
  await page.locator("dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    errors.push("Gallery horizontal overflow on mobile");
  const svgPage = await browser.newPage();
  let checked = 0,
    svgChecked = 0;
  for (const group of groups)
    for (const style of group.styles)
      for (const preview of style.previews) {
        checked++;
        if (!preview.file.endsWith(".svg")) continue;
        svgChecked++;
        await svgPage.goto(pathToFileURL(resolve(out, preview.file)).href);
        const clipping = await svgPage.evaluate(() => {
          const svg = document.querySelector("svg")!,
            w = svg.viewBox.baseVal.width,
            h = svg.viewBox.baseVal.height;
          return [...svg.querySelectorAll("text")].flatMap((t) => {
            const b = t.getBBox(),
              matrix = t.getCTM()!,
              points = [
                [b.x, b.y],
                [b.x + b.width, b.y + b.height],
              ].map(([x, y]) => {
                const p = svg.createSVGPoint();
                p.x = x;
                p.y = y;
                return p.matrixTransform(matrix);
              });
            return points.some(
              (p) => p.x < -1 || p.y < -1 || p.x > w + 1 || p.y > h + 1,
            )
              ? [t.textContent]
              : [];
          });
        });
        if (clipping.length)
          errors.push(preview.file + ": clipped text " + clipping.join(", "));
      }
  writeFileSync(
    resolve(out, "review-check.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projects: groups.length,
        variants: groups.reduce((count, g) => count + g.styles.length, 0),
        screens: 4,
        devices: 2,
        imagesChecked: checked,
        svgTextBoundsChecked: svgChecked,
        zoomChecked: true,
        mobileOverflow: false,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    `Review ready: ${groups.reduce((count, g) => count + g.styles.length, 0)} style packages, ${checked} screen images; ${native ? "Studio images" : "SVG text bounds"}, zoom and mobile layout verified.`,
  );
} finally {
  await browser.close();
}

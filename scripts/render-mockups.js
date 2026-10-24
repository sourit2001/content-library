// Renders a dashboard mockup for every theme pack, for the in-app store.
//
//   node scripts/render-mockups.js            # all packs
//   node scripts/render-mockups.js peach-ink  # one pack
//
// Writes packs/<id>/mockup.jpg (1440×900, shown when a user taps 预览) and
// packs/<id>/preview.jpg (640×400 store thumbnail), then adds "mockup" to
// index.json and each pack.json. Requires Node with Playwright (Chromium).
// The mockup approximates the plugin's glass styles with sample content.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const packsDir = path.resolve(__dirname, "..", "packs");
const indexPath = path.join(packsDir, "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const only = process.argv.slice(2);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function html(pack) {
  const dir = path.join(packsDir, pack.id);
  const vars = Object.entries(pack.palette.light).map(([k, v]) => `--cld-${k}:${v};`).join("");
  const light = pack.scheme === "light";
  const line = light ? "rgb(255 255 255 / 55%)" : "rgb(255 255 255 / 22%)";
  const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const wave = icon('<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>');
  const gear = icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/>');
  const cards = [
    ["认知觉醒", "周岭 · 阅读 42%", 42], ["硅谷早知道", "播客 · 38 分钟", 65], ["产品思考笔记", "想法收藏 · 3 天前", 0],
    ["人类简史", "尤瓦尔·赫拉利 · 阅读 18%", 18], ["Lex Fridman", "播客 · 2 小时", 30], ["写作的方法", "书架 · 昨天", 0],
  ].map(([t, s, p]) => `<div class="g card"><b>${t}</b><small>${s}</small>${p ? `<div class="bar"><i style="width:${p}%"></i></div>` : `<p class="ex">先写下来，再慢慢改。好的想法都来自草稿。</p>`}</div>`).join("");
  const days = Array.from({ length: 84 }, (_, i) => `<i style="opacity:${[0.15, 0.35, 0.6, 0.9][(i * 7 + (i % 5)) % 4]}"></i>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:"PingFang SC","Noto Sans CJK SC","Noto Sans SC",sans-serif}
  .root{${vars}--cld-glass:color-mix(in srgb,var(--cld-card) 54%,transparent);--cld-a:color-mix(in srgb,var(--cld-tone-a) 44%,var(--cld-card));
    width:1440px;height:900px;padding:18px;display:grid;grid-template-columns:230px 1fr 290px;gap:18px;color:var(--cld-ink);color-scheme:${light ? "light" : "dark"};
    background-color:color-mix(in srgb,var(--cld-bg) 58%,transparent);
    background-image:${pack.overlay || "none"},url("file://${dir}/${pack.background}");background-size:cover;background-position:center top}
  .g{background:color-mix(in srgb,var(--cld-card) 58%,transparent);border:1px solid ${line};border-radius:26px;backdrop-filter:blur(20px) saturate(130%);
    box-shadow:inset 0 1px 0 ${line},0 12px 30px rgb(0 0 0/14%);padding:20px}
  small{opacity:.68;font-size:12.5px} .nav b{font-size:20px;display:block;margin:4px 6px 18px}
  .nav div{padding:11px 14px;border-radius:13px;margin:3px 0;font-size:14.5px}.nav .on{background:color-mix(in srgb,var(--cld-card) 85%,transparent)}
  .nav .sec{font-size:12px;opacity:.6;padding:14px 14px 4px}
  main{display:grid;grid-template-rows:auto 250px 1fr;gap:18px;min-width:0}
  .top{display:flex;justify-content:space-between;align-items:center}.top h1{margin:4px 0 0;font-size:30px}
  .acts{display:flex;gap:8px;align-items:center}.pill-btn{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:color-mix(in srgb,var(--cld-card) 70%,transparent);border:1px solid ${line};font-size:13px}
  .vol{width:70px;height:4px;border-radius:4px;background:color-mix(in srgb,var(--cld-ink) 25%,transparent);position:relative}.vol:after{content:"";position:absolute;inset:0 45% 0 0;border-radius:4px;background:var(--cld-accent)}
  .hero{border-radius:30px;background:url("file://${dir}/${pack.banner}") center/cover;position:relative;overflow:hidden}
  .hero:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgb(0 0 0/38%),transparent 60%)}
  .hero div{position:absolute;left:30px;bottom:26px;color:#fff;text-shadow:0 2px 14px rgb(0 0 0/45%)}.hero h2{margin:6px 0 4px;font-size:30px}.hero p{margin:0;opacity:.85;font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:150px;gap:16px}
  .card{display:flex;flex-direction:column;gap:7px;padding:18px}.card b{font-size:15.5px}
  .bar{margin-top:auto;height:5px;border-radius:5px;background:color-mix(in srgb,var(--cld-ink) 18%,transparent)}.bar i{display:block;height:100%;border-radius:5px;background:var(--cld-accent)}
  .ex{margin:auto 0 0;font-size:12.5px;opacity:.75;line-height:1.5}
  aside.right{display:flex;flex-direction:column;gap:16px}.right h3{margin:0 0 6px;font-size:16px}
  .heat{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;margin-top:12px}.heat i{aspect-ratio:1;border-radius:4px;background:var(--cld-accent)}
  .quote{font-size:14.5px;line-height:1.7;margin:8px 0 0}
  </style></head><body><div class="root">
  <aside class="g nav"><b>内容图书馆</b><div class="on">今天</div><div class="sec">收听</div><div>播客</div><div>音乐收藏</div><div class="sec">阅读</div><div>书架</div><div>信息</div><div>想法收藏</div><div>技能储备</div></aside>
  <main><div class="top"><div><small>10月24日 星期六</small><h1>下午好</h1></div>
    <div class="acts">${pack.ambient ? `<div class="pill-btn">${wave}<span class="vol"></span></div>` : ""}<div class="pill-btn">${esc(pack.name)} ▾</div><div class="pill-btn">${gear}</div></div></div>
    <section class="hero"><div><small style="opacity:.9">继续阅读 · 今天</small><h2>${esc(pack.name)}</h2><p>书、播客、新闻和灵感，都在一个地方。</p></div></section>
    <div class="grid">${cards}</div></main>
  <aside class="right"><div class="g"><h3>本周阅读</h3><small>已读 6 篇 · 收听 3 期 · 连续 12 天</small><div class="heat">${days}</div></div>
    <div class="g"><h3>今日摘录</h3><p class="quote">“慢慢来，比较快。真正的进步，往往发生在不被打扰的时间里。”</p><small>— 摘自《认知觉醒》</small></div>
    <div class="g" style="flex:1"><h3>继续收听</h3><small>硅谷早知道 · 第 213 期</small><div class="bar" style="margin-top:14px"><i style="width:65%"></i></div></div></aside>
  </div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const pack of index.packs) {
    if (only.length && !only.includes(pack.id)) continue;
    const dir = path.join(packsDir, pack.id);
    const file = path.join(dir, ".mockup.html");
    fs.writeFileSync(file, html(pack));
    await page.goto("file://" + file);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(dir, "mockup.jpg"), type: "jpeg", quality: 82 });
    // Store thumbnail: the mockup scaled to 640×400.
    await page.setViewportSize({ width: 640, height: 400 });
    await page.setContent(`<body style="margin:0"><img src="file://${path.join(dir, "mockup.jpg")}" style="width:640px;height:400px;display:block"></body>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(dir, "preview.jpg"), type: "jpeg", quality: 84 });
    await page.setViewportSize({ width: 1440, height: 900 });
    fs.unlinkSync(file);
    pack.mockup = "mockup.jpg";
    const packJson = path.join(dir, "pack.json");
    if (fs.existsSync(packJson)) {
      const own = JSON.parse(fs.readFileSync(packJson, "utf8"));
      own.mockup = "mockup.jpg";
      fs.writeFileSync(packJson, JSON.stringify(own, null, 2) + "\n");
    }
    console.log("rendered", pack.id);
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  await browser.close();
})();

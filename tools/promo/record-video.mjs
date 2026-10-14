// Records the ScadaCraft presentation video (1920x1080, ~80 s): real screens (GitHub, Claude building the
// pumping-station page through the MCP server, live synoptic, operator commands, alarm, night palette,
// editor, trend, MCP README), captured with the Chrome DevTools screencast and assembled with ffmpeg.
//
// Needs: a running ScadaCraft on 127.0.0.1:1881 with the MCP server built (mcp/dist), ffmpeg, and
// Playwright with a Chromium (tools/openbridge: npm install). Set CHROMIUM_PATH if needed.
//   cd tools/promo && node record-video.mjs        -> out/scadacraft-video.mp4
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { buildStation, VIEW } = await import(path.join(REPO, 'mcp/examples/stazione-pompaggio.mjs'));

const U = 'http://127.0.0.1:1881';
const W = 1920, H = 1080, FPS = 30;
const { chromium } = createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'openbridge', 'package.json'))('playwright');
const WORK = path.resolve('out');
const OUT = path.join(WORK, 'frames');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const LOGO = fs.readFileSync(path.join(REPO, 'docs/brand/scadacraft-logo.png')).toString('base64');
const FONT = fs.readFileSync(path.join(REPO, 'client/src/assets/lib/openbridge/NotoSans.ttf')).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ recorder (CDP screencast)
class Recorder {
  constructor() { this.frames = []; this.offset = 0; this.paused = false; this.n = 0; }
  async attach(page) {
    if (this.cdp) await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.page = page;
    this.cdp = await page.context().newCDPSession(page);
    this.cdp.on('Page.screencastFrame', async (f) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      if (this.paused) return;
      const file = path.join(OUT, `f${String(this.n++).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, t: Date.now() - this.offset });
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  }
  pause() { if (!this.paused) { this.paused = true; this.pauseAt = Date.now(); } }
  resume() { if (this.paused) { this.offset += Date.now() - this.pauseAt; this.paused = false; } }
  /** keep the current picture on screen for ms (screencast sends no frames for a still page) */
  async hold(ms) { await this.nudge(); await sleep(ms); await this.nudge(); }
  async nudge() { await this.page.evaluate(() => { const d = document.getElementById('__nudge') || document.body.appendChild(Object.assign(document.createElement('div'), { id: '__nudge' })); d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;background:#' + (Math.random() * 0xffffff | 0).toString(16).padStart(6, '0'); }).catch(() => {}); }
  async stop() { await this.cdp.send('Page.stopScreencast').catch(() => {}); this.frames.push({ file: this.frames.at(-1).file, t: Date.now() - this.offset }); }
}

// ------------------------------------------------------------------ overlays
const OVERLAY_CSS = `
@font-face { font-family: 'SC Noto'; src: url(data:font/ttf;base64,${FONT}) format('truetype'); font-weight: 100 900; }
#sc-cap { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 2147483647;
  background: rgba(11,31,51,0.92); color: #fff; font-family: 'SC Noto', sans-serif; border-radius: 14px;
  padding: 18px 30px 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.35); max-width: 1500px; text-align: center;
  transition: opacity .35s ease, transform .35s ease; }
#sc-cap .k { font-size: 17px; letter-spacing: 2px; text-transform: uppercase; color: #7FC4E8; font-weight: 700; margin-bottom: 6px; }
#sc-cap .t { font-size: 34px; font-weight: 600; line-height: 1.25; }
#sc-chip { position: fixed; right: 36px; top: 96px; z-index: 2147483647; font-family: ui-monospace, 'DejaVu Sans Mono', monospace;
  background: #0d1117; color: #e6edf3; border-radius: 12px; padding: 16px 22px; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  border: 1px solid #30363d; min-width: 560px; }
#sc-chip .h { color: #7ee787; font-size: 15px; margin-bottom: 8px; }
#sc-chip .c { font-size: 22px; } #sc-chip .c b { color: #79c0ff; font-weight: 600; }
#sc-chip .r { font-size: 17px; color: #a5d6ff; margin-top: 6px; }
`;
async function overlay(page, { kicker, text, chip } = {}) {
  await page.evaluate(({ css, kicker, text, chip }) => {
    let st = document.getElementById('sc-css');
    if (!st) { st = document.createElement('style'); st.id = 'sc-css'; st.textContent = css; document.head.appendChild(st); }
    document.getElementById('sc-cap')?.remove(); document.getElementById('sc-chip')?.remove();
    if (text) {
      const d = document.createElement('div'); d.id = 'sc-cap';
      d.innerHTML = (kicker ? `<div class="k">${kicker}</div>` : '') + `<div class="t">${text}</div>`;
      document.body.appendChild(d);
    }
    if (chip) {
      const c = document.createElement('div'); c.id = 'sc-chip';
      c.innerHTML = `<div class="h">● Claude → ScadaCraft MCP</div><div class="c">▸ <b>${chip.tool}</b></div><div class="r">✓ ${chip.what}</div>`;
      document.body.appendChild(c);
    }
  }, { css: OVERLAY_CSS, kicker, text, chip });
}

function card(kind) {
  const base = `<!doctype html><html><head><style>
  @font-face { font-family: 'SC Noto'; src: url(data:font/ttf;base64,${FONT}) format('truetype'); font-weight: 100 900; }
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'SC Noto',sans-serif;background:#F4F6F8;color:#0B1F33}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#0B1F33,#2D548B,#7FC4E8)}
  @keyframes up{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
  .a1{animation:up .9s ease both}.a2{animation:up .9s .35s ease both}.a3{animation:up .9s .7s ease both}.a4{animation:up .9s 1.05s ease both}
  .pill{display:inline-block;margin:0 8px;padding:10px 22px;border-radius:999px;background:#fff;border:1px solid #d5dbe1;font-size:26px;font-weight:600;color:#2D548B}
  </style></head><body><div class="bar"></div><div class="wrap">`;
  if (kind === 'intro') {
    return base + `<img class="a1" src="data:image/png;base64,${LOGO}" style="width:430px">
      <div class="a2" style="font-size:44px;font-weight:600;margin-top:26px">SCADA/HMI web per l'automazione industriale</div>
      <div class="a3" style="margin-top:34px"><span class="pill">Design OpenBridge</span><span class="pill">AI con server MCP</span><span class="pill">Open source</span></div>
      </div></body></html>`;
  }
  return base + `<img class="a1" src="data:image/png;base64,${LOGO}" style="width:300px">
    <div class="a2" style="font-size:48px;font-weight:700;margin-top:24px">github.com/inferis995/scadacraft</div>
    <div class="a3" style="font-size:28px;margin-top:22px;color:#3d5166">Open source (MIT) · basato su FUXA · componenti OpenBridge · server MCP per Claude</div>
    </div></body></html>`;
}

// ------------------------------------------------------------------ helpers on ScadaCraft
async function project() { return (await fetch(U + '/api/project')).json(); }
async function tagIds() { const d = await project(); const m = {}; for (const t of Object.values(d.devices['0'].tags)) m[t.name] = t.id; return m; }
async function writeTag(name, value) {
  const ids = await tagIds();
  await fetch(U + '/api/setTagValue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: [{ id: ids[name], value }] }) });
}
async function setTheme(theme) {
  const d = await project();
  await fetch(U + '/api/projectData', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'layout', data: { ...d.hmi.layout, obcTheme: theme } }) });
}
async function deleteView(name) {
  const d = await project(); const v = d.hmi.views.find((x) => x.name === name);
  if (v) await fetch(U + '/api/projectData', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'del-view', data: v }) });
}
async function smoothScroll(page, dy, ms) {
  await page.evaluate(async ({ dy, ms }) => {
    const y0 = window.scrollY, t0 = performance.now();
    await new Promise((res) => { const step = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, y0 + dy * e); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
  }, { dy, ms });
}

// ------------------------------------------------------------------ scenes
const EXE = process.env.CHROMIUM_PATH || undefined;
// GitHub goes through the agent proxy; ScadaCraft is local (no proxy)
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browserGH = await chromium.launch({ executablePath: EXE, proxy, args: ['--ignore-certificate-errors'] });
const browser = await chromium.launch({ executablePath: EXE });
const ghPage = await (await browserGH.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
const rec = new Recorder();
const marks = [];
const mark = (name) => marks.push({ name, t: Date.now() - rec.offset });

await setTheme('day');
await writeTag('Fault_Inverter', false); await writeTag('Modo', 1); await writeTag('Bypass_Sonda', false);

// 1. intro card
await page.setContent(card('intro'));
await rec.attach(page);
mark('intro');
await rec.hold(4800);

// 2. GitHub repository
rec.pause();
await ghPage.goto('https://github.com/inferis995/scadacraft', { waitUntil: 'networkidle' });
await overlay(ghPage, { kicker: 'Il progetto', text: 'Open source su GitHub — fork di FUXA con OpenBridge e un server MCP' });
await sleep(400); await rec.attach(ghPage); rec.resume(); mark('github');
await rec.hold(2200);
await smoothScroll(ghPage, 1050, 3200);
await overlay(ghPage, { kicker: 'Il progetto', text: 'Editor web, runtime, driver Modbus · S7 · OPC UA · MQTT e molto altro' });
await rec.hold(2600);
rec.pause();
await rec.attach(page); rec.pause();

// 3. MCP builds the page, step by step
rec.pause();
await deleteView(VIEW);
let first = true;
await buildStation({
  url: U,
  onStep: async (tool, what) => {
    rec.pause();
    await page.goto(`${U}/home?viewName=${encodeURIComponent(VIEW)}`, { waitUntil: 'networkidle' });
    await sleep(first ? 2500 : 1600);
    await overlay(page, { kicker: 'L\'AI costruisce il sinottico', text: 'Claude crea la pagina con chiamate al server MCP di ScadaCraft', chip: { tool, what } });
    await sleep(200);
    if (first) { mark('build'); first = false; }
    rec.resume();
    await rec.hold(1700);
  },
});

// 4. live synoptic
rec.pause();
await page.goto(`${U}/home?viewName=${encodeURIComponent(VIEW)}`, { waitUntil: 'networkidle' });
await sleep(2500);
await overlay(page, { kicker: 'Runtime', text: 'Sinottico vivo: livelli, pressione e inverter collegati ai tag' });
rec.resume(); mark('live');
await rec.hold(4500);
await overlay(page, { kicker: 'Comandi operatore', text: 'Il click scrive sul tag: passaggio in MANUALE e setpoint' });
const sel = await page.$('obc-toggle-button-group'); const sb = await sel.boundingBox();
await rec.hold(800);
await page.mouse.click(sb.x + sb.width * 0.25, sb.y + sb.height / 2);
await rec.hold(1800);
const inp = await page.$('obc-number-input-field'); const ib = await inp.boundingBox();
await page.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2);
await page.keyboard.press('Control+A'); await page.keyboard.type('42', { delay: 180 }); await page.keyboard.press('Enter');
await rec.hold(2800);
await overlay(page, { kicker: 'Allarmi', text: 'Guasto inverter: allarme, cornice rossa, LED e contatore' });
await writeTag('Fault_Inverter', true);
await rec.hold(5500);
await writeTag('Fault_Inverter', false);
await writeTag('Modo', 1); await writeTag('SP_Manuale_Hz', 48);

// 5. night palette
rec.pause();
await setTheme('night');
await page.reload({ waitUntil: 'networkidle' }); await sleep(2500);
await overlay(page, { kicker: 'Temi OpenBridge', text: 'Giorno, crepuscolo, notte: un clic per la sala controllo' });
rec.resume(); mark('night');
await rec.hold(4200);
rec.pause();
await setTheme('day');

// 6. editor: libraries and property panel
await page.goto(U + '/editor', { waitUntil: 'networkidle' }); await sleep(2500);
await page.getByRole('button', { name: 'CLOSE' }).click().catch(() => {});
await page.getByText(VIEW, { exact: true }).first().click(); await sleep(3000);
await page.getByText('OpenBridge · Automation (P&ID)', { exact: true }).click().catch(() => {}); await sleep(1200);
await overlay(page, { kicker: 'Editor', text: '49 widget OpenBridge in 5 librerie: P&ID, strumenti, grafici, comandi, allarmi' });
rec.resume(); mark('editor');
await rec.hold(3800);
const pump = await page.$('obc-pump'); const pb = await pump.boundingBox();
await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2); await rec.hold(700);
await page.getByRole('button', { name: 'Property' }).click(); await sleep(400);
await overlay(page, { kicker: 'Editor', text: 'Ogni proprietà si collega a un tag, con nome leggibile e descrizione' });
await rec.hold(4200);
await page.keyboard.press('Escape');

// 7. trend
rec.pause();
await page.goto(`${U}/home?viewName=${encodeURIComponent('Trend stazione')}`, { waitUntil: 'networkidle' }); await sleep(3500);
await overlay(page, { kicker: 'Storico', text: 'Trend e storico dei dati, report PDF, backup programmati' });
rec.resume(); mark('trend');
await rec.hold(4000);

// 8. MCP README on GitHub
rec.pause();
await ghPage.goto('https://github.com/inferis995/scadacraft/tree/main/mcp', { waitUntil: 'networkidle' }); await sleep(800);
await ghPage.evaluate(() => document.querySelector('article')?.scrollIntoView());
await ghPage.evaluate(() => window.scrollBy(0, -80));
await overlay(ghPage, { kicker: 'Server MCP', text: '82 strumenti: dispositivi, tag, allarmi, pagine, utenti, report, backup' });
await rec.attach(ghPage); rec.resume(); mark('mcp');
await rec.hold(1800);
await smoothScroll(ghPage, 1400, 4200);
await rec.hold(1200);

// 9. end card
rec.pause();
await page.setContent(card('end'));
await rec.attach(page); rec.resume(); mark('end');
await rec.hold(5500);
await rec.stop();
await browser.close(); await browserGH.close();

// ------------------------------------------------------------------ assemble
const list = [];
for (let i = 0; i < rec.frames.length - 1; i++) {
  const d = Math.max(0.001, (rec.frames[i + 1].t - rec.frames[i].t) / 1000);
  list.push(`file '${rec.frames[i].file}'`, `duration ${d.toFixed(3)}`);
}
list.push(`file '${rec.frames.at(-1).file}'`);
fs.writeFileSync(path.join(WORK, 'frames.txt'), list.join('\n') + '\n');
const total = (rec.frames.at(-1).t - rec.frames[0].t) / 1000;
fs.writeFileSync(path.join(WORK, 'marks.json'), JSON.stringify(marks.map((m) => ({ name: m.name, s: (m.t - rec.frames[0].t) / 1000 })), null, 1));
console.log(`frames ${rec.frames.length}, ${total.toFixed(1)} s`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.txt'),
  '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', path.join(WORK, 'scadacraft-video.mp4')], { stdio: 'inherit' });
console.log(`video: ${path.join(WORK, 'scadacraft-video.mp4')}`);

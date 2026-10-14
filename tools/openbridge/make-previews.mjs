// Render a PNG preview of every OpenBridge widget, for the editor library.
//
// The editor shows library items as <img>, where scripts and web components do not run,
// so each widget embeds a static preview (see make-widgets.py). Previews are rendered from
// the real widget, loaded through FUXA's own widget pipeline (SvgUtils from the client).
//
// Usage (from repo root):  node tools/openbridge/make-previews.mjs
// Requires the dev dependencies in tools/openbridge/package.json (npm install there) and a
// Chromium for Playwright (npx playwright install chromium, or set CHROMIUM_PATH).
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WDIR = path.join(REPO, 'server/_widgets/openbridge');
const OB = path.join(REPO, 'client/src/assets/lib/openbridge');
const OUT = path.join(HERE, 'previews');
const SCALE = 2;

// Preview state per widget: shows the symbol in a representative, neutral state.
const STATE = {
  'ob-pump': { _pb_running: 1 }, 'ob-motor': { _pb_running: 1 }, 'ob-fan': { _pb_running: 1 },
  'ob-valve-digital': { _pb_open: 1 }, 'ob-valve-analog': { _pn_position: 60, _pb_open: 1 },
  'ob-tank': { _pn_level: 60 }, 'ob-readout': { _pn_value: 123 },
  'ob-line-horizontal': { _ps_medium: 'water' }, 'ob-line-vertical': { _ps_medium: 'water' },
  'ob-line-elbow': { _ps_medium: 'water' }, 'ob-line-tee': { _ps_medium: 'water' },
  'ob-line-cross': { _ps_medium: 'water' }, 'ob-line-overlap': { _ps_medium: 'water' },
  'ob-line-end': { _ps_medium: 'water' }, 'ob-line-flow': { _ps_medium: 'water' },
};

// FUXA's SvgUtils, bundled for the browser with Angular stubbed out.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obprev-'));
fs.writeFileSync(path.join(tmp, 'ng.js'), 'export const Injectable=()=>c=>c;export const Pipe=()=>c=>c;export class DomSanitizer{}');
fs.writeFileSync(path.join(tmp, 'entry.ts'),
  `import { SvgUtils } from ${JSON.stringify(path.join(REPO, 'client/src/app/_helpers/svg-utils'))};\n(window as any).SvgUtils = SvgUtils;`);
await build({
  entryPoints: [path.join(tmp, 'entry.ts')], bundle: true, format: 'iife', outfile: path.join(tmp, 'svgutils.js'),
  alias: { '@angular/core': path.join(tmp, 'ng.js'), '@angular/platform-browser': path.join(tmp, 'ng.js') }, logLevel: 'error',
});

const catalog = JSON.parse(fs.readFileSync(path.join(WDIR, 'widgets.json'), 'utf8'));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: SCALE, viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.setContent(`<!doctype html><html data-obc-theme="day"><head>
<style>${fs.readFileSync(path.join(OB, 'openbridge.css'), 'utf8')}</style>
<style>${fs.readFileSync(path.join(OB, 'scadacraft-openbridge.css'), 'utf8')}</style>
<script>${fs.readFileSync(path.join(OB, 'openbridge-automation.min.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(tmp, 'svgutils.js'), 'utf8')}</script>
<style>body{margin:0;background:transparent} #box{position:absolute;left:100px;top:100px}</style>
</head><body><div id="box"></div></body></html>`);

fs.mkdirSync(OUT, { recursive: true });
for (const w of catalog.widgets) {
  const svgContent = fs.readFileSync(path.join(REPO, 'server', w.file), 'utf8');
  await page.evaluate(({ svgContent, values }) => {
    const box = document.getElementById('box'); box.innerHTML = '';
    const svg = new DOMParser().parseFromString(svgContent, 'image/svg+xml').querySelector('svg');
    const guid = Math.random().toString(36).slice(2, 8);
    const idMap = window.SvgUtils.renameIdsInSvg(svg, guid);
    const moduleId = `wModule_${guid}`;
    let res;
    svg.querySelectorAll('script').forEach(s => { res = window.SvgUtils.processWidget(s.textContent, moduleId, idMap, undefined); s.remove(); });
    box.appendChild(svg);
    const sc = document.createElement('script');
    sc.textContent = window.SvgUtils.initWidget(res.content, res.vars);
    document.body.appendChild(sc);
    Object.entries(values).forEach(([k, v]) => window[moduleId].putValue(k, v));
  }, { svgContent, values: STATE[w.widget] || {} });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(OUT, `${w.widget}.png`), omitBackground: true,
    clip: { x: 100, y: 100, width: w.size.width, height: w.size.height },
  });
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (errors.length) { console.error(errors); process.exit(1); }
console.log(`${catalog.widgets.length} previews written to ${path.relative(REPO, OUT)}`);

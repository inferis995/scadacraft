// Parity test: the MCP server's widget script processing must match the editor's
// (client/src/app/_helpers/svg-utils.ts) for every OpenBridge widget.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { processWidget } from '../dist/fuxa/widget-script.js';
import { buildWidgetItem } from '../dist/fuxa/view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'parity-'));
writeFileSync(join(tmp, 'ng.js'), 'export const Injectable=()=>c=>c;export const Pipe=()=>c=>c;export class DomSanitizer{}');
await build({
  entryPoints: [join(REPO, 'client/src/app/_helpers/svg-utils.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: join(tmp, 'svg-utils.mjs'), logLevel: 'error',
  alias: { '@angular/core': join(tmp, 'ng.js'), '@angular/platform-browser': join(tmp, 'ng.js') },
});
const { SvgUtils } = await import(pathToFileURL(join(tmp, 'svg-utils.mjs')).href);

const root = join(REPO, 'server/_widgets');
const files = readdirSync(root).filter((d) => d.startsWith('openbridge'))
  .flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.svg')).map((f) => join(d, f)));
let n = 0;
for (const file of files) {
  const svg = readFileSync(join(root, file), 'utf8');
  const script = svg.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1];
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const idMap = Object.fromEntries(ids.map((id) => [id, `${id}_abc123`]));
  const moduleId = 'wModule_abc123';
  const ours = processWidget(script, moduleId, idMap);
  const ref = SvgUtils.processWidget(script, moduleId, idMap, undefined);
  assert.equal(ours.content, ref.content, `${file}: script differs`);
  assert.deepEqual(ours.vars, ref.vars, `${file}: variables differ`);
  n++;
}
// internal references follow the renamed ids (SvgUtils.renameIdsInSvg since FUXA 1.3.6-3098)
{
  const svgSource = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">
<defs><linearGradient id="g1"/><clipPath id="c1"/><path id="p1" d="M0 0"/></defs>
<rect id="r" fill="url(#g1)" style="clip-path: url('#c1')" stroke="url(#missing)"/><use xlink:href="#p1"/><use href="#p1"/>
<script><![CDATA[//!export-start
let _pn_x = 0;
//!export-end
function putValue(id, value) {}
]]></script></svg>`;
  const { item } = buildWidgetItem({ widget: { widget: 't', varsToBind: [] }, svgSource, address: '_widgets/t.svg', x: 0, y: 0, width: 10, height: 10 });
  const out = item.property.svgContent;
  const sfx = /id="g1_([^"]+)"/.exec(out)[1];
  assert.match(out, new RegExp(`fill="url\\(#g1_${sfx}\\)"`), 'url() reference renamed');
  assert.match(out, new RegExp(`clip-path: url\\('#c1_${sfx}'\\)`), 'quoted url() reference renamed');
  assert.match(out, /stroke="url\(#missing\)"/, 'unknown reference kept');
  assert.equal((out.match(new RegExp(`href="#p1_${sfx}"`, 'g')) || []).length, 2, 'href and xlink:href renamed');
}
rmSync(tmp, { recursive: true, force: true });
console.log(`parity OK: ${n} widgets match the editor's processing`);

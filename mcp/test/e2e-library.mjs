// End-to-end test of widget import (native FUXA SVG widgets into the editor library), placement of
// imported widgets, ScadaCraft trend charts on pages and one-step trend pages.
// Needs a running ScadaCraft (SCADACRAFT_URL). Skips when not reachable.
// Leaves the views "Trend e2e" and "Library e2e" for a visual check; E2E_CLEANUP=1 removes them.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e-library skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'sc-lib-'));
const client = new Client({ name: 'e2e-library', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
const step = (s) => console.log(`\n== ${s}`);
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
const GROUP = 'MCP e2e';

// a native FUXA widget: level bar with colour, writes a command on click
const LEVEL_WIDGET = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="192" viewBox="0 0 96 192">
  <rect id="frame" x="2" y="2" width="92" height="188" rx="6" fill="#eef2f6" stroke="#5a6b7d" stroke-width="2"/>
  <rect id="bar" x="10" y="186" width="76" height="0" fill="#2E7DD7"/>
  <text id="label" x="48" y="100" text-anchor="middle" font-size="18" font-family="sans-serif" fill="#1d1d1d">0 %</text>
  <script type="text/javascript"><![CDATA[
//!export-start
let _pn_level = 0;
let _pc_fill = '#2E7DD7';
let _pb_cmd = false;
//!export-end
function render() {
    var h = Math.max(0, Math.min(100, Number(_pn_level) || 0)) * 1.76;
    var bar = document.getElementById('bar');
    bar.setAttribute('y', String(186 - h));
    bar.setAttribute('height', String(h));
    bar.setAttribute('fill', _pc_fill);
    document.getElementById('label').textContent = Math.round(Number(_pn_level) || 0) + ' %';
}
function putValue(id, value) {
    if (id === '_pn_level') { _pn_level = value; }
    if (id === '_pc_fill') { _pc_fill = value; }
    render();
}
function postValue(id, value) {}
document.getElementById('frame').addEventListener('click', function () { _pb_cmd = !_pb_cmd; postValue('_pb_cmd', _pb_cmd ? 1 : 0); });
render();
]]></script>
</svg>`;

try {
  step('import widgets');
  writeFileSync(join(tmp, 'level-bar.svg'), LEVEL_WIDGET);
  writeFileSync(join(tmp, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20" fill="#0B1F33"/></svg>');
  const imp = await call('scadacraft_import_widgets', { group: GROUP, paths: [tmp], overwrite: true });
  assert.equal(imp.structuredContent.imported.length, 2);
  assert.ok(imp.structuredContent.warnings.some((w) => w.includes('logo.svg') && w.includes('static')));
  const lvl = imp.structuredContent.imported.find((i) => i.path.endsWith('level-bar.svg'));
  assert.deepEqual(lvl.size, { width: 96, height: 192 });
  assert.deepEqual(lvl.properties, ['_pn_level (number)', '_pc_fill (color)', '_pb_cmd (boolean)']);
  const again = await call('scadacraft_import_widgets', { group: GROUP, svg: LEVEL_WIDGET, name: 'level-bar' });
  assert.equal(again.structuredContent.imported.length, 0, 'existing widget skipped without overwrite');
  await assert.rejects(call('scadacraft_import_widgets', { group: 'openbridge', svg: LEVEL_WIDGET, name: 'x' }), /built-in/);
  const lib = (await call('scadacraft_list_library_widgets', { group: GROUP })).structuredContent.groups;
  assert.equal(lib.length, 1);
  assert.equal(lib[0].items.length, 2);
  const desc = (await call('scadacraft_list_library_widgets', { widget: `${GROUP}/level-bar` })).structuredContent.widget;
  assert.equal(desc.properties.find((p) => p.name === '_pn_level').default, '0');
  console.log(`imported into "${GROUP}": ${lib[0].items.map((i) => i.path).join(', ')}`);

  step('tags with history');
  const listed = (await call('scadacraft_list_tags', { device: 'FUXA Server', limit: 500 })).structuredContent.tags.map((t) => t.ref);
  const want = [['TR_Level', '55'], ['TR_Flow', '12']].filter(([n]) => !listed.includes(`FUXA Server.${n}`));
  if (want.length) {
    await call('scadacraft_add_tags', { device: 'FUXA Server', tags: want.map(([name, init]) => ({ name, type: 'number', init, history: { enabled: true, interval_s: 1 } })) });
  }

  step('place the imported widget');
  for (const v of ['Library e2e', 'Trend e2e']) {
    const views = (await call('scadacraft_list_views')).structuredContent.views;
    if (views.some((x) => x.name === v)) await call('scadacraft_delete_view', { view: v });
  }
  await call('scadacraft_create_view', { name: 'Library e2e', width: 1200, height: 720 });
  const pl = await call('scadacraft_place_widgets', { view: 'Library e2e', widgets: [
    { widget: `${GROUP}/level-bar`, node: { x: 2, y: 2 }, name: 'LT-101', properties: { level: { tag: 'FUXA Server.TR_Level' }, fill: '#2BA84A' } },
    { widget: 'level-bar', node: { x: 8, y: 2 }, size: { width: 6, height: 12 }, properties: { level: { tag: 'FUXA Server.TR_Flow' } } },
  ] });
  const [a, b] = pl.structuredContent.placed;
  assert.deepEqual(a.box, { x: 48, y: 48, width: 96, height: 192 });
  assert.deepEqual(b.box, { x: 192, y: 48, width: 144, height: 288 });
  assert.equal(a.bindings._pn_level, 'tag FUXA Server.TR_Level');
  assert.equal(a.bindings._pc_fill, 'value #2BA84A');

  step('chart on a page and trend page');
  await call('scadacraft_set_chart', { name: 'Trend e2e pens', lines: [{ tag: 'FUXA Server.TR_Level', label: 'Livello' }, { tag: 'FUXA Server.TR_Flow', label: 'Portata', yaxis: 2 }] });
  const ch = await call('scadacraft_place_chart', { view: 'Library e2e', chart: 'Trend e2e pens', node: { x: 16, y: 2 }, size: { width: 30, height: 16 }, mode: 'history' });
  assert.equal(ch.structuredContent.placed.widget, 'chart');
  assert.equal(ch.structuredContent.placed.bindings.mode, 'history');
  assert.deepEqual(ch.structuredContent.placed.box, { x: 384, y: 48, width: 720, height: 384 });
  await assert.rejects(call('scadacraft_place_chart', { view: 'Library e2e', chart: 'nope', node: { x: 0, y: 0 } }), /not found/);

  const tp = await call('scadacraft_create_trend_page', {
    name: 'Trend e2e', tags: [{ tag: 'FUXA Server.TR_Level', label: 'Livello' }, { tag: 'FUXA Server.TR_Flow', yaxis: 2 }], minutes: 10,
  });
  assert.equal(tp.structuredContent.chart, 'Trend e2e');
  assert.match(tp.content[0].text, /menu entry (added|already present)/);
  const layout = (await call('scadacraft_get_layout')).structuredContent.layout;
  assert.ok(layout.menu.items.some((i) => i.view === 'Trend e2e'), 'menu entry for the trend page');
  const tv = (await call('scadacraft_get_view', { view: 'Trend e2e' })).structuredContent;
  assert.equal(tv.items.length, 1);
  assert.equal(tv.items[0].bindings.chart, 'Trend e2e');
  assert.equal(tv.items[0].bindings.mode, 'realtime 10 min');
  const raw = (await (await fetch(`${url}/api/project`)).json()).hmi.views.find((v) => v.name === 'Trend e2e');
  const item = Object.values(raw.items)[0];
  assert.equal(item.type, 'svg-ext-html_chart');
  assert.match(raw.svgcontent, /id="D-HXC_/);
  console.log(`trend page: ${tv.items[0].box.width}x${tv.items[0].box.height} px chart, ${tp.structuredContent.warnings.length} warning(s)`);

  step('remove the imported widgets');
  const rm = await call('scadacraft_remove_library_widgets', { widgets: [`${GROUP}/logo`] });
  assert.equal(rm.structuredContent.removed.length, 1);
  await assert.rejects(call('scadacraft_remove_library_widgets', { widgets: ['openbridge/ob-pump'] }), /built-in/);
  if (process.env.E2E_CLEANUP) {
    await call('scadacraft_remove_library_widgets', { widgets: [`${GROUP}/level-bar`] });
    for (const v of ['Library e2e', 'Trend e2e']) await call('scadacraft_delete_view', { view: v });
  }
  console.log('\ne2e-library OK');
} finally {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
}

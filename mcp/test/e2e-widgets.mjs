// End-to-end test of the OpenBridge widget libraries through the MCP server: builds a showcase view with
// every non-P&ID widget bound to server tags (instruments, charts, controls, alerts), checks the catalog
// and placement (top-left anchor, size in cells). Needs a running ScadaCraft (SCADACRAFT_URL). Skips when not reachable.
// The view "OpenBridge showcase" is left in the project for a visual check.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e-widgets skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'e2e-widgets', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
const VIEW = 'OpenBridge showcase';

try {
  // catalog: five libraries, every widget has a known layout and direction on its properties
  const cat = (await call('scadacraft_list_widgets', { response_format: 'json' })).structuredContent;
  assert.deepEqual(cat.categories.map((c) => c.key), ['automation', 'instruments', 'charts', 'controls', 'alerts']);
  for (const c of cat.categories) {
    const n = cat.widgets.filter((w) => w.category === c.key).length;
    assert.ok(n > 0, `library ${c.key} is empty`);
    console.log(`${c.title}: ${n} widgets`);
  }
  for (const w of cat.widgets) for (const p of w.properties) assert.ok(['read', 'write', 'rw'].includes(p.dir), `${w.widget}.${p.name} dir`);
  const controls = (await call('scadacraft_list_widgets', { category: 'controls' })).content[0].text;
  assert.match(controls, /ob-slider/);
  assert.ok(!controls.includes('ob-pump'));

  // tags
  const tags = [
    ['OB_Level', 'number', '62'], ['OB_SP', 'number', '40'], ['OB_Auto', 'boolean', '1'], ['OB_Run', 'boolean', '0'],
    ['OB_Mode', 'number', '1'], ['OB_Cmd', 'number', '0'], ['OB_Alarm', 'boolean', '1'], ['OB_Count', 'number', '3'],
    ['OB_State', 'number', '2'], ['OB_Text', 'string', 'AUTO'], ['OB_QC', 'number', '0'], ['OB_Bypass', 'boolean', '0'],
  ];
  const listed = (await call('scadacraft_list_tags', { device: 'FUXA Server', limit: 500 })).structuredContent;
  const have = new Set((listed.tags ?? []).map((t) => t.ref.replace(/^FUXA Server\./, '')));
  const missing = tags.filter(([n]) => !have.has(n)).map(([name, type, init]) => ({ name, type, init }));
  if (missing.length) await call('scadacraft_add_tags', { device: 'FUXA Server', tags: missing });
  const T = (n) => ({ tag: `FUXA Server.${n}` });

  // view
  const views = (await call('scadacraft_list_views')).structuredContent.views;
  if (views.some((v) => v.name === VIEW)) await call('scadacraft_delete_view', { view: VIEW });
  await call('scadacraft_create_view', { name: VIEW, width: 1488, height: 912 });

  const place = [
    // instruments (row 1)
    { widget: 'ob-gauge-radial', node: { x: 1, y: 1 }, properties: { value: T('OB_Level'), hasSetpoint: true, setpoint: T('OB_SP') } },
    { widget: 'ob-gauge-vertical', node: { x: 10, y: 1 }, size: { width: 4, height: 10 }, properties: { value: T('OB_Level') } },
    { widget: 'ob-gauge-horizontal', node: { x: 15, y: 1 }, properties: { value: T('OB_Level') } },
    { widget: 'ob-instrument-field', node: { x: 15, y: 5 }, properties: { value: T('OB_Level'), unit: '%', tag: 'LT-101' } },
    { widget: 'ob-circular-progress', node: { x: 22, y: 5 }, properties: { value: T('OB_Level') } },
    { widget: 'ob-progress-bar', node: { x: 15, y: 9 }, size: { width: 12, height: 2 }, properties: { value: T('OB_Level') } },
    { widget: 'ob-gauge-trend', node: { x: 32, y: 1 }, properties: { value: T('OB_Level'), unit: '%' } },
    // charts (row 2)
    { widget: 'ob-line-graph', node: { x: 1, y: 13 }, size: { width: 14, height: 9 }, properties: { value: T('OB_Level'), unit: '%' } },
    { widget: 'ob-area-graph', node: { x: 16, y: 13 }, size: { width: 14, height: 9 }, properties: { value: T('OB_SP') } },
    { widget: 'ob-donut-chart', node: { x: 31, y: 13 }, size: { width: 9, height: 9 }, properties: { value1: T('OB_Level'), value2: T('OB_SP'), label3: '' } },
    { widget: 'ob-radial-bar-chart', node: { x: 41, y: 13 }, size: { width: 9, height: 9 }, properties: { value1: T('OB_Level'), value2: T('OB_SP'), rings: 2 } },
    // controls (row 3)
    { widget: 'ob-slider', node: { x: 1, y: 24 }, size: { width: 12, height: 2 }, properties: { value: T('OB_SP') } },
    { widget: 'ob-number-input', node: { x: 14, y: 24 }, properties: { value: T('OB_SP'), unit: '%', decimals: 0 } },
    { widget: 'ob-toggle-switch', node: { x: 23, y: 24 }, properties: { value: T('OB_Auto'), label: 'Automatic' } },
    { widget: 'ob-start-stop', node: { x: 34, y: 24 }, properties: { running: T('OB_Run') } },
    { widget: 'ob-mode-selector', node: { x: 1, y: 27 }, properties: { value: T('OB_Mode') } },
    { widget: 'ob-button', node: { x: 14, y: 27 }, properties: { command: T('OB_Cmd'), pressValue: 7, label: 'Reset' } },
    { widget: 'ob-check-button', node: { x: 21, y: 27 }, properties: { value: T('OB_Bypass') } },
    { widget: 'ob-ok-nok', node: { x: 28, y: 27 }, properties: { value: T('OB_QC') } },
    // alerts (row 4)
    { widget: 'ob-alert-icon', node: { x: 1, y: 31 }, properties: { active: T('OB_Alarm') } },
    { widget: 'ob-alert-button', node: { x: 4, y: 31 }, properties: { count: T('OB_Count') } },
    { widget: 'ob-status-indicator', node: { x: 11, y: 32 }, properties: { state: T('OB_State') } },
    { widget: 'ob-badge', node: { x: 14, y: 31 }, properties: { number: T('OB_Count') } },
    { widget: 'ob-tag', node: { x: 17, y: 31 }, properties: { label: T('OB_Text') } },
    { widget: 'ob-clock', node: { x: 22, y: 31 }, properties: { seconds: true } },
    { widget: 'ob-alert-frame', node: { x: 45, y: 0 }, size: { width: 16, height: 12 }, properties: { active: T('OB_Alarm') } },
  ];
  const res = await call('scadacraft_place_widgets', { view: VIEW, widgets: place });
  const placed = res.structuredContent.placed;
  assert.equal(placed.length, place.length);
  assert.deepEqual(res.structuredContent.warnings, []);
  const slider = placed.find((p) => p.widget === 'ob-slider');
  assert.deepEqual(slider.box, { x: 24, y: 576, width: 288, height: 48 }, 'top-left anchor and size in cells');
  assert.equal(slider.bindings._pn_value, 'tag FUXA Server.OB_SP');
  const pump = await call('scadacraft_place_widgets', { view: VIEW, widgets: [{ widget: 'ob-pump', node: { x: 52, y: 26 }, size: { width: 9, height: 9 } }] });
  assert.match(pump.structuredContent.warnings[0], /size" ignored/);

  const v = (await call('scadacraft_get_view', { view: VIEW })).structuredContent;
  assert.equal(v.items.length, place.length + 1);
  const gv = v.items.find((i) => i.widget === 'ob-gauge-vertical');
  assert.deepEqual(gv.node, { x: 10, y: 1 });
  assert.equal(gv.box.height, 240);
  console.log(`placed ${v.items.length} widgets on "${VIEW}"`);

  // plain shapes: a card, a title following the palette, a separator; removable by id
  const sh = (await call('scadacraft_draw_shapes', { view: VIEW, shapes: [
    { type: 'rect', x: 44, y: 24, width: 10, height: 4, radius: 0.3 },
    { type: 'text', x: 44.5, y: 25, text: 'Card', size: 11, weight: 700, color: 'ob:element-neutral', uppercase: true },
    { type: 'line', x1: 44, y1: 26, x2: 54, y2: 26 },
  ] })).structuredContent;
  assert.equal(sh.ids.length, 3);
  let svg = (await (await fetch(`${url}/api/project`)).json()).hmi.views.find((x) => x.name === VIEW).svgcontent;
  assert.match(svg, /style="fill:var\(--container-global-color\)/);
  assert.match(svg, />CARD</);
  const rm = (await call('scadacraft_remove_items', { view: VIEW, ids: [sh.ids[2]] })).structuredContent;
  assert.deepEqual(rm.removed, [sh.ids[2]]);
  svg = (await (await fetch(`${url}/api/project`)).json()).hmi.views.find((x) => x.name === VIEW).svgcontent;
  assert.ok(!svg.includes(sh.ids[2]) && svg.includes(sh.ids[0]));

  // OpenBridge palette from the layout
  const bk = async () => (await (await fetch(`${url}/api/project`)).json()).hmi.views.find((x) => x.name === VIEW).profile.bkcolor;
  await call('scadacraft_set_layout', { openbridge_theme: 'night' });
  assert.equal((await call('scadacraft_get_layout')).structuredContent.layout.openbridge_theme, 'night');
  assert.equal(await bk(), '#000000', 'page background follows the night palette');
  await call('scadacraft_set_layout', { openbridge_theme: 'day' });
  assert.equal(await bk(), '#F7F7F7', 'page background back to the day palette');

  // alarm status tags follow the alarm engine; bound to the OpenBridge alert widgets
  const st = (await call('scadacraft_create_alarm_status_tags')).structuredContent;
  assert.equal(st.created.length + st.existing.length, 7);
  await call('scadacraft_write_tags', { values: [{ tag: 'FUXA Server.OB_Level', value: 20 }] });
  await call('scadacraft_set_alarm', { name: 'OB level', tag: 'FUXA Server.OB_Level', levels: { highhigh: { above: 90, text: 'OB level very high' } } });
  const readStatus = async () => Object.fromEntries((await call('scadacraft_read_tags', { tags: ['FUXA Server.Alarms Active', 'FUXA Server.Alarms HighHigh', 'FUXA Server.Alarms Unacknowledged'] }))
    .structuredContent.values.map((x) => [x.ref.replace('FUXA Server.Alarms ', ''), Number(x.value)]));
  const waitFor = async (pred, what) => {
    for (let i = 0; i < 40; i++) { const s = await readStatus(); if (pred(s)) return s; await new Promise((r) => setTimeout(r, 500)); }
    throw new Error(`timeout: ${what} ${JSON.stringify(await readStatus())}`);
  };
  await waitFor((x) => x.Active === 0 && x.HighHigh === 0, 'no alarms');
  await call('scadacraft_write_tags', { values: [{ tag: 'FUXA Server.OB_Level', value: 95 }] });
  const on = await waitFor((x) => x.Active === 1 && x.HighHigh === 1 && x.Unacknowledged === 1, 'alarm on');
  console.log(`alarm status tags: ${JSON.stringify(on)}`);
  await call('scadacraft_write_tags', { values: [{ tag: 'FUXA Server.OB_Level', value: 20 }] });
  await call('scadacraft_ack_alarms', {});
  await waitFor((x) => x.Active === 0 && x.Unacknowledged === 0, 'alarm off and acknowledged');
  await call('scadacraft_place_widgets', { view: VIEW, widgets: [
    { widget: 'ob-alert-button', node: { x: 36, y: 31 }, properties: { count: { tag: 'FUXA Server.Alarms Unacknowledged' } } },
  ] });
  await call('scadacraft_delete_alarm', { name: 'OB level' });
  console.log('\ne2e-widgets OK');
} finally {
  await client.close();
}

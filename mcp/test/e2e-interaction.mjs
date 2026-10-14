// End-to-end test of page interaction through the MCP server: click events (page, popup, card, close, set/toggle
// value, script, link) on widgets, buttons and plain shapes; native value display and button; shape animations.
// Checks the stored format against what the editor/runtime expect. Needs a running ScadaCraft (SCADACRAFT_URL);
// skips when not reachable. Leaves the views "Interaction test" and "Interaction popup" for a visual check.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e-interaction skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'e2e-interaction', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
async function fails(name, args, re) {
  const res = await client.callTool({ name, arguments: args });
  assert.ok(res.isError, `${name} should fail`);
  assert.match(res.content[0].text, re);
}
const project = async () => (await fetch(`${url}/api/project`)).json();
const viewOf = async (name) => (await project()).hmi.views.find((v) => v.name === name);
const MAIN = 'Interaction test';
const POPUP = 'Interaction popup';

try {
  // tags + script
  const want = [['IX_Run', 'boolean', '0'], ['IX_SP', 'number', '10'], ['IX_Word', 'number', '0'], ['IX_Level', 'number', '40']];
  const listed = (await call('scadacraft_list_tags', { device: 'FUXA Server', limit: 500 })).structuredContent;
  const have = new Set((listed.tags ?? []).map((t) => t.ref.replace(/^FUXA Server\./, '')));
  const missing = want.filter(([n]) => !have.has(n)).map(([name, type, init]) => ({ name, type, init }));
  if (missing.length) await call('scadacraft_add_tags', { device: 'FUXA Server', tags: missing });
  await call('scadacraft_set_script', { name: 'ix_reset', parameters: [{ name: 'target', type: 'tagid' }, { name: 'v', type: 'value' }], code: '$setTag(target, v);' });

  // views
  const views = (await call('scadacraft_list_views')).structuredContent.views;
  for (const v of [MAIN, POPUP]) if (views.some((x) => x.name === v)) await call('scadacraft_delete_view', { view: v });
  await call('scadacraft_create_view', { name: MAIN, width: 960, height: 600 });
  await call('scadacraft_create_view', { name: POPUP, width: 360, height: 240 });

  // shapes: a status lamp (circle via rect radius) and a card
  const shapes = (await call('scadacraft_draw_shapes', { view: MAIN, shapes: [
    { type: 'rect', x: 2, y: 2, width: 3, height: 3, radius: 36 },
    { type: 'rect', x: 8, y: 2, width: 10, height: 6 },
    { type: 'text', x: 9, y: 3.5, text: 'Detail', uppercase: true },
  ] })).structuredContent.ids;
  const [lamp, card, label] = shapes;

  // animation: colour by IX_Run, blink while IX_Word bit 2 set, hide when level > 90
  const anim = (await call('scadacraft_animate_shape', { view: MAIN, shape_id: lamp, tag: 'FUXA Server.IX_Run',
    colors: [{ min: 0, max: 0, fill: '#7f7f7f' }, { min: 1, max: 1, fill: '#3bb24a' }],
    actions: [{ type: 'blink', tag: 'FUXA Server.IX_Word', bit: 2, fill_a: '#E30019', fill_b: '#FFDB42' }, { type: 'hide', tag: 'FUXA Server.IX_Level', min: 90, max: 100 }],
  })).structuredContent.item;
  assert.equal(anim.widget, 'shape-rect');
  assert.equal(anim.animations.length, 3);
  let v = await viewOf(MAIN);
  const it = v.items[lamp];
  assert.equal(it.type, 'svg-ext-shapes-rect');
  assert.equal(it.label, 'Shapes');
  assert.deepEqual(it.property.ranges.map((r) => r.color), ['#7f7f7f', '#3bb24a']);
  assert.equal(it.property.actions[0].type, 'blink');
  assert.equal(it.property.actions[0].bitmask, 4);
  assert.equal(it.property.actions[0].options.fillA, '#E30019');
  assert.deepEqual(it.property.actions[1].range, { min: 90, max: 100 });
  // the ob: css fill was moved off the shape so the runtime colours show
  const lampEl = v.svgcontent.match(new RegExp(`<rect[^>]*id="${lamp}"[^>]*>`))[0];
  assert.ok(!/style="[^"]*fill:/.test(lampEl), lampEl);
  assert.match(lampEl, /fill="#7f7f7f"/);
  assert.match(lampEl, /style="[^"]*stroke:var\(--border-outline-color\)/, 'stroke not animated: keeps its theme token');
  await fails('scadacraft_animate_shape', { view: MAIN, shape_id: lamp, colors: [{ min: 0, max: 1, fill: 'ob:alarm' }] }, /fixed colours/);
  console.log('shape animation stored');

  // value display
  const val = (await call('scadacraft_place_value', { view: MAIN, x: 3.5, y: 7, tag: 'FUXA Server.IX_SP', value_unit: 'bar', decimals: 1, size: 18 })).structuredContent.item;
  assert.equal(val.widget, 'value');
  assert.equal(val.bindings.unit, 'bar');
  v = await viewOf(MAIN);
  const vi = v.items[val.id];
  assert.equal(vi.type, 'svg-ext-value');
  assert.deepEqual(vi.property.ranges[0], { type: 1, min: 0, max: 0, text: 'bar', fractionDigits: 1 });
  const g = v.svgcontent.match(new RegExp(`<g[^>]*id="${val.id}"[^>]*>([\\s\\S]*?)</g>`));
  assert.ok(g, 'value group');
  assert.equal((g[1].match(/<text/g) ?? []).length, 1, 'the runtime expects one text child');

  // buttons: +1 on the setpoint, toggle run, open popup
  const plus = (await call('scadacraft_place_button', { view: MAIN, x: 2, y: 9, text: '+1', tag: 'FUXA Server.IX_SP',
    events: [{ action: 'set_value', value: 1, mode: 'add' }] })).structuredContent.item;
  const run = (await call('scadacraft_place_button', { view: MAIN, x: 7, y: 9, text: 'Run', tag: 'FUXA Server.IX_Run',
    colors: [{ min: 1, max: 1, fill: '#3bb24a', stroke: '#ffffff' }], events: [{ action: 'toggle_value' }] })).structuredContent.item;
  const pop = (await call('scadacraft_place_button', { view: MAIN, x: 12, y: 9, text: 'Popup', events: [{ action: 'open_popup', page: POPUP }] })).structuredContent.item;
  v = await viewOf(MAIN);
  const popup = await viewOf(POPUP);
  const sp = (await project()).hmi.views; void sp;
  assert.deepEqual(v.items[plus.id].property.events[0].actoptions.function, 'add');
  assert.equal(v.items[plus.id].property.events[0].action, 'onSetValue');
  assert.equal(v.items[plus.id].property.events[0].type, 'click');
  assert.equal(v.items[run.id].property.events[0].action, 'onToggleValue');
  assert.ok(v.items[run.id].property.events[0].actoptions.variable.variableId);
  assert.equal(v.items[run.id].property.ranges[0].color, '#3bb24a');
  assert.deepEqual(v.items[pop.id].property.events[0], { type: 'click', action: 'ondialog', actparam: popup.id, actoptions: { variablesMapping: [] } });
  assert.match(v.svgcontent, new RegExp(`<BUTTON[^>]*id="B-HXB_[^"]*"[^>]*>Popup</BUTTON>`));
  assert.equal(v.items[pop.id].label, 'HtmlButton');

  // events on a plain shape (card → page), on a widget (pump → card), script and link
  const cardEv = (await call('scadacraft_set_events', { view: MAIN, item_id: card, events: [{ action: 'open_page', page: POPUP }] })).structuredContent.item;
  assert.deepEqual(cardEv.events, [`click: open page ${POPUP}`]);
  await call('scadacraft_set_events', { view: MAIN, item_id: label, events: [{ on: 'dblclick', action: 'open_link', url: 'https://example.com' }] });
  const pump = (await call('scadacraft_place_widgets', { view: MAIN, widgets: [{ widget: 'ob-pump', node: { x: 26, y: 5 }, properties: { running: { tag: 'FUXA Server.IX_Run' } } }] })).structuredContent.placed[0];
  await call('scadacraft_set_events', { view: MAIN, item_id: pump.id, events: [{ action: 'open_card', page: POPUP, x: 100, y: 80 }] });
  await call('scadacraft_set_events', { view: MAIN, item_id: pump.id, append: true,
    events: [{ on: 'mouseup', action: 'run_script', script: 'ix_reset', params: { target: 'FUXA Server.IX_SP', v: 5 } }] });
  v = await viewOf(MAIN);
  assert.equal(v.items[card].type, 'svg-ext-shapes-rect');
  assert.equal(v.items[card].property.events[0].action, 'onpage');
  assert.equal(v.items[label].type, 'svg-ext-shapes-text');
  assert.deepEqual(v.items[label].property.events[0], { type: 'dblclick', action: 'onOpenTab', actparam: 'https://example.com', actoptions: { newTab: true, addressType: 'address' } });
  const pe = v.items[pump.id].property.events;
  assert.equal(pe.length, 2);
  assert.deepEqual(pe[0].actoptions, { variablesMapping: [], left: 100, top: 80, relativeFrom: 'window' });
  assert.equal(pe[0].action, 'onwindow');
  assert.equal(pe[1].action, 'onRunScript');
  const params = Object.fromEntries(pe[1].actoptions.params.map((p) => [p.name, p.value]));
  assert.equal(params.v, '5');
  assert.ok(params.target && params.target !== 'FUXA Server.IX_SP', 'tagid parameter resolved to the tag id');

  // close button on the popup
  await call('scadacraft_place_button', { view: POPUP, x: 5, y: 6, text: 'Close', events: [{ action: 'close' }] });

  // get_view lists events and animations
  const text = (await call('scadacraft_get_view', { view: MAIN })).content[0].text;
  assert.match(text, /on click: open popup Interaction popup/);
  assert.match(text, /blink when FUXA Server\.IX_Word/);
  assert.match(text, /on mouseup: run script ix_reset/);

  // errors
  await fails('scadacraft_set_events', { view: MAIN, item_id: card, events: [{ action: 'open_page', page: 'Nope' }] }, /page "Nope" not found/);
  await fails('scadacraft_set_events', { view: MAIN, item_id: card, events: [{ action: 'set_value', value: 1 }] }, /"tag" is required/);
  await fails('scadacraft_set_events', { view: MAIN, item_id: 'svg_missing', events: [] }, /not found/);
  await fails('scadacraft_set_events', { view: MAIN, item_id: pump.id, events: [{ action: 'run_script', script: 'ix_reset', params: { zz: 1 } }] }, /no parameter "zz"/);

  // removing a shape item removes the element too
  const before = (await viewOf(MAIN)).svgcontent.includes(`id="${label}"`);
  await call('scadacraft_remove_items', { view: MAIN, item_ids: [label] });
  v = await viewOf(MAIN);
  assert.ok(before && !v.svgcontent.includes(`id="${label}"`) && !v.items[label]);

  console.log('e2e-interaction OK');
} finally {
  await client.close();
}

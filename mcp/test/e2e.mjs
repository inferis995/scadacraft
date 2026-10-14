// End-to-end test: run the MCP server over stdio against a running ScadaCraft
// (SCADACRAFT_URL, default http://127.0.0.1:1881) and build a small P&ID page.
// Skips when ScadaCraft is not reachable. Leaves the view "MCP e2e" for inspection unless E2E_CLEANUP=1.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')],
  env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
});
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(transport);

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}

const tools = (await client.listTools()).tools.map((t) => t.name);
assert.ok(tools.includes('scadacraft_place_widgets') && tools.includes('scadacraft_draw_pipe'));
const resources = (await client.listResources()).resources.map((r) => r.uri);
assert.ok(resources.includes('scadacraft://docs/openbridge'));

const widgets = await call('scadacraft_list_widgets', { response_format: 'json' });
assert.equal(widgets.structuredContent.grid, 24);

// server tags (unique suffix so the test can run repeatedly)
const sfx = Date.now().toString(36);
const T = (n) => `E2E_${n}_${sfx}`;
await call('scadacraft_add_tags', {
  device: 'FUXA Server',
  tags: [
    { name: T('P101_Run'), type: 'boolean', init: '1' },
    { name: T('P101_Cmd'), type: 'boolean', init: '0' },
    { name: T('P101_Speed'), type: 'number', init: '75' },
    { name: T('T101_Level'), type: 'number', init: '62' },
    { name: T('FCV_Pos'), type: 'number', init: '40' },
    { name: T('Flow'), type: 'number', init: '42.5' },
  ],
});

const viewName = 'MCP e2e';
const existing = (await call('scadacraft_list_views')).structuredContent.views.find((v) => v.name === viewName);
if (existing) await call('scadacraft_delete_view', { view: viewName });
await call('scadacraft_create_view', { name: viewName, width: 960, height: 528 });

const S = (n) => ({ tag: `FUXA Server.${T(n)}` });
const placed = await call('scadacraft_place_widgets', {
  view: viewName,
  widgets: [
    { widget: 'ob-tank', node: { x: 6, y: 8 }, name: 'T-101', properties: { level: S('T101_Level'), fluid: 'waste', tag: 'T-101' } },
    { widget: 'ob-pump', node: { x: 15, y: 4 }, name: 'P-101',
      properties: { running: S('P101_Run'), command: S('P101_Cmd'), speed: S('P101_Speed'), auto: true, tag: '101' } },
    { widget: 'ob-valve-analog', node: { x: 23, y: 4 }, name: 'FCV-201', properties: { position: S('FCV_Pos'), open: true, tag: '201' } },
    { widget: 'ob-line-flow', node: { x: 18, y: 4 }, properties: { medium: 'water', fluid: 'waste' } },
    { widget: 'ob-line-end', node: { x: 32, y: 4 }, properties: { medium: 'water', fluid: 'waste', direction: 'right' } },
    { widget: 'ob-readout', node: { x: 28, y: 4 }, properties: { value: S('Flow'), unit: 'm3/h', position: 'top' } },
  ],
});
assert.equal(placed.structuredContent.placed.length, 6);
assert.equal(placed.structuredContent.placed[1].bindings._pb_running, `tag FUXA Server.${T('P101_Run')}`);

// tank top -> up to row 4 -> right to the pump; pump -> valve; valve -> end
await call('scadacraft_draw_pipe', { view: viewName, path: [{ x: 6, y: 8 }, { x: 6, y: 4 }, { x: 14, y: 4 }], medium: 'water', fluid: 'waste' });
await call('scadacraft_draw_pipe', { view: viewName, path: [{ x: 16, y: 4 }, { x: 22, y: 4 }], medium: 'water', fluid: 'waste' });
await call('scadacraft_draw_pipe', { view: viewName, path: [{ x: 24, y: 4 }, { x: 32, y: 4 }], medium: 'water', fluid: 'waste' });

const view = await call('scadacraft_get_view', { view: viewName });
const items = view.structuredContent.items;
assert.equal(items.length, 6 + 3 + 1 + 1, 'item count'); // widgets + pipe1 (2 lines + elbow) + pipe2 + pipe3
for (const it of items) {
  assert.ok(Number.isInteger(it.node.x) && Number.isInteger(it.node.y), `${it.widget} anchor on a grid node`);
}

// live values: write a server memory tag and read it back
await call('scadacraft_write_tags', { values: [{ tag: `FUXA Server.${T('P101_Speed')}`, value: 50 }] });
const read = await call('scadacraft_read_tags', { tags: [`FUXA Server.${T('P101_Speed')}`, T('T101_Level')] });
assert.equal(Number(read.structuredContent.values[0].value), 50, 'written value read back');
assert.equal(Number(read.structuredContent.values[1].value), 62, 'init value');

// errors are actionable
const bad = await client.callTool({ name: 'scadacraft_place_widgets', arguments: { view: viewName, widgets: [{ widget: 'ob-pump', node: { x: 2, y: 2 }, properties: { running: { tag: 'NoSuchTag' } } }] } });
assert.ok(bad.isError && /not found/.test(bad.content[0].text));

console.log(view.content[0].text);
if (process.env.E2E_CLEANUP === '1') await call('scadacraft_delete_view', { view: viewName });
await client.close();
console.log('e2e OK');

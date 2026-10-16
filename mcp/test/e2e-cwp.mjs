// End-to-end test of AVEVA Custom Widget (.cwp) import through the MCP server: a small package is built here
// (index.html using the cwidget API, .wjson with Boolean/Integer/Double/String properties, a props.js with
// directions), imported, placed with tag bindings, and checked: library listing, properties with labels and
// directions, files served, cwidget host script. Needs a running ScadaCraft (SCADACRAFT_URL); skips otherwise.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e-cwp skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}

// --- minimal zip writer (deflate), like an AVEVA export
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text); const comp = deflateRawSync(data); const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const W = 'cwp_e2e';
const wjson = {
  version: 0, useSDK: false, width: 640, height: 360, events: {},
  properties: {
    0: { type: 'Double', name: 'level', value: '1.5', desc: { 1033: 'Tank level' } },
    1: { type: 'Boolean', name: 'run_cmd', value: 'false', desc: { 1033: 'Run command' } },
    2: { type: 'Integer', name: 'count', value: '3', desc: { 1033: 'Counter' } },
    3: { type: 'String', name: 'unit', value: 'm', desc: { 1033: 'Level unit' } },
  },
};
const pkg = zip({
  [`${W}/index.html`]: `<!DOCTYPE html><html><head><title>CWP e2e</title>
<script src="../resources/apis/proxy.js" cwidget="${W}"></script><script src="../resources/apis/MASvrHelper.js"></script></head>
<body><span id="lv">-</span><button id="b" onclick="cwidget.run_cmd = true">run</button>
<script>cwidget.on('level', function () { document.getElementById('lv').textContent = cwidget.level; });</script></body></html>`,
  [`${W}/${W}.wjson`]: JSON.stringify(wjson),
  [`${W}/build/props.js`]: `window.CW_PROPS = ${JSON.stringify([{ name: 'level', dir: 'in' }, { name: 'run_cmd', dir: 'inout' }, { name: 'count', dir: 'in' }, { name: 'unit', dir: 'inout' }])};`,
});
const tmp = mkdtempSync(join(tmpdir(), 'cwp-e2e-'));
const file = join(tmp, `${W}.cwp`);
writeFileSync(file, pkg);

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'e2e-cwp', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
const GROUP = 'CWP e2e';
const VIEW = 'CWP e2e';

try {
  const imp = (await call('scadacraft_import_widgets', { group: GROUP, paths: [file], overwrite: true })).structuredContent;
  assert.equal(imp.imported.length, 1);
  assert.equal(imp.imported[0].path, `_widgets/${GROUP}/${W}.svg`);
  assert.deepEqual(imp.imported[0].size, { width: 640, height: 360 });
  // again without overwrite: skipped with a warning
  const again = (await call('scadacraft_import_widgets', { group: GROUP, paths: [file] })).structuredContent;
  assert.equal(again.imported.length, 0);
  assert.match(again.warnings[0], /already in/);

  // library: listed once (the package folder is not a widget), properties with directions and labels
  const groups = (await (await fetch(`${url}/api/resources/widgets`)).json()).groups;
  const g = groups.find((x) => x.name === GROUP);
  assert.deepEqual(g.items.map((i) => i.name), [`${W}.svg`]);
  const w = (await call('scadacraft_list_library_widgets', { widget: `${GROUP}/${W}` })).structuredContent.widget;
  assert.equal(w.title, 'CWP e2e');
  const props = Object.fromEntries(w.properties.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(props).sort(), ['_pb_run_cmd', '_pn_count', '_pn_level', '_ps_unit']);
  assert.equal(props._pn_level.dir, 'read');
  assert.equal(props._pb_run_cmd.dir, 'rw');
  assert.match(props._pn_level.description, /Tank level/);
  assert.equal(props._ps_unit.default, 'm');

  // files served: page, host script with the cwidget API
  const page = await fetch(`${url}/_widgets/${encodeURIComponent(GROUP)}/_cwp/${W}/index.html`);
  assert.equal(page.status, 200);
  const proxy = await (await fetch(`${url}/_widgets/${encodeURIComponent(GROUP)}/_cwp/resources/apis/proxy.js`)).text();
  assert.match(proxy, /window\.cwidget = new Proxy/);
  const svg = await (await fetch(`${url}/_widgets/${encodeURIComponent(GROUP)}/${W}.svg`)).text();
  assert.match(svg, /<iframe id="cwpframe" src="_widgets\/CWP%20e2e\/_cwp\/cwp_e2e\/index.html"/);
  assert.match(svg, /let _pn_level = 1.5;/);
  assert.match(svg, /let _ps_unit = `m`;/);

  // place with bindings
  const tags = (await call('scadacraft_list_tags', { device: 'FUXA Server', limit: 500 })).structuredContent.tags ?? [];
  const need = [['CWP_Level', 'number', '2.5'], ['CWP_Run', 'boolean', '0']].filter(([n]) => !tags.some((t) => t.name === n));
  if (need.length) await call('scadacraft_add_tags', { device: 'FUXA Server', tags: need.map(([name, type, init]) => ({ name, type, init })) });
  const views = (await call('scadacraft_list_views')).structuredContent.views;
  if (views.some((v) => v.name === VIEW)) await call('scadacraft_delete_view', { view: VIEW });
  await call('scadacraft_create_view', { name: VIEW, width: 960, height: 600 });
  const placed = (await call('scadacraft_place_widgets', { view: VIEW, widgets: [{ widget: `${GROUP}/${W}`, node: { x: 1, y: 1 }, size: { width: 30, height: 18 },
    properties: { level: { tag: 'FUXA Server.CWP_Level' }, run_cmd: { tag: 'FUXA Server.CWP_Run' }, unit: 'cm' } }] })).structuredContent.placed[0];
  assert.match(placed.bindings._pn_level, /tag FUXA Server\.CWP_Level/);
  assert.equal(placed.bindings._ps_unit, 'value cm');
  const project = await (await fetch(`${url}/api/project`)).json();
  const item = project.hmi.views.find((v) => v.name === VIEW).items[placed.id];
  assert.ok(item.property.scriptContent.content.includes('__scadacraftPut'));
  assert.ok(item.property.scriptContent.content.includes('postValue'));
  assert.ok(item.property.svgContent.includes('cwpframe_'), 'iframe id renamed per instance');

  // invalid packages
  const bad = join(tmp, 'bad.cwp');
  writeFileSync(bad, zip({ 'x/index.html': '<html></html>' }));
  const res = await client.callTool({ name: 'scadacraft_import_widgets', arguments: { group: GROUP, paths: [bad] } });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /No \.wjson/);

  // removing the library widget removes the package
  await call('scadacraft_remove_library_widgets', { widgets: [`${GROUP}/${W}`] });
  assert.equal((await fetch(`${url}/_widgets/${encodeURIComponent(GROUP)}/_cwp/${W}/index.html`)).status, 404);

  console.log('e2e-cwp OK');
} finally {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
}

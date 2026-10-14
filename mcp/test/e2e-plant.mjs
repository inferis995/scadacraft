// Full end-to-end test: a simulated Modbus PLC, then everything through MCP:
// driver, device, tags (with history), live read/write, alarms (raise, ack, history),
// a P&ID page, view duplicate/update, project export and merge import.
// Needs a running ScadaCraft (SCADACRAFT_URL). Skips when not reachable.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startModbusSim } from './modbus-sim.mjs';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e-plant skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = dirname(fileURLToPath(import.meta.url));
const sim = startModbusSim({ port: 5020 });
sim.setLevel(42.5);
sim.setFlow(31.7);
sim.setRunning(true);

const client = new Client({ name: 'e2e-plant', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')],
  env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
const step = (s) => console.log(`\n== ${s}`);
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
async function until(fn, what, timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(500);
  }
}

const DEV = 'PLC_SIM';
const tmp = join(tmpdir(), `scadacraft-e2e-${Date.now()}`);

try {
  step('cleanup from previous runs');
  const devs = (await call('scadacraft_list_devices')).structuredContent.devices;
  if (devs.some((d) => d.name === DEV)) await call('scadacraft_delete_device', { device: DEV });
  const alarmsBefore = (await call('scadacraft_list_alarms')).structuredContent.alarms;
  if (alarmsBefore.some((a) => a.name === 'T-101 level')) await call('scadacraft_delete_alarm', { name: 'T-101 level' });
  for (const v of ['Plant e2e', 'Plant e2e copy']) {
    const views = (await call('scadacraft_list_views')).structuredContent.views;
    if (views.some((x) => x.name === v)) await call('scadacraft_delete_view', { view: v });
  }

  step('driver');
  const drv = await call('scadacraft_install_driver', { type: 'Modbus' });
  console.log(drv.content[0].text);

  step('device and tags');
  const dev = await call('scadacraft_create_device', {
    name: DEV, type: 'ModbusTCP', polling_ms: 500, connection: { host: '127.0.0.1', port: 5020, slave_id: 1 },
  });
  assert.equal(dev.structuredContent.connection.address, '127.0.0.1:5020');
  assert.ok(!dev.structuredContent.warning, 'driver installed, no warning');
  const tags = await call('scadacraft_add_tags', {
    device: DEV,
    tags: [
      { name: 'LT101', address: '40001', type: 'Float32', decimals: 1, history: { enabled: true, interval_s: 1, on_change: true } },
      { name: 'FT101', address: '30001', type: 'Int16', divisor: 10 },
      { name: 'P101_Run', address: '00001', type: 'Bool' },
      { name: 'P101_Cmd', address: 'coil:2', type: 'Bool' },
    ],
  });
  console.log(tags.content[0].text);
  const bad = await client.callTool({ name: 'scadacraft_add_tags', arguments: { device: DEV, tags: [{ name: 'X', address: '99999', type: 'Int16' }] } });
  assert.ok(bad.isError && /Invalid Modbus address/.test(bad.content[0].text));
  await call('scadacraft_update_device', { device: DEV, enabled: true });

  step('live read');
  const values = await until(async () => {
    const r = await call('scadacraft_read_tags', { tags: [`${DEV}.LT101`, `${DEV}.FT101`, `${DEV}.P101_Run`] });
    const v = r.structuredContent.values;
    return v[0].value !== null && Number(v[0].value) > 0 ? v : null;
  }, 'Modbus values');
  console.log(values.map((v) => `${v.ref}=${v.value}`).join(', '));
  assert.ok(Math.abs(Number(values[0].value) - 42.5) < 0.01, 'level read from holding register');
  assert.ok(Math.abs(Number(values[1].value) - 31.7) < 0.01, 'flow scaled by divisor');
  assert.ok([true, 1, '1', 'true'].includes(values[2].value), 'pump running');
  const status = await until(async () => {
    const d = (await call('scadacraft_list_devices')).structuredContent.devices.find((x) => x.name === DEV);
    return d.status === 'ok' ? d : null;
  }, 'device status ok');
  console.log(`device status: ${status.status}`);

  step('write to the PLC');
  await call('scadacraft_write_tags', { values: [{ tag: `${DEV}.P101_Cmd`, value: 1 }] });
  await until(() => sim.writes.some((w) => w.area === 'coil' && w.addr === 1 && w.value === true), 'coil write in the PLC');
  console.log('PLC received command coil 2 = 1');

  step('alarms');
  await call('scadacraft_set_alarm', {
    name: 'T-101 level', tag: `${DEV}.LT101`,
    levels: { highhigh: { above: 90, text: 'T-101 level very high', group: 'Sollevamento' }, low: { below: 10, text: 'T-101 level low', group: 'Sollevamento' } },
  });
  const list = (await call('scadacraft_list_alarms')).structuredContent.alarms.find((a) => a.name === 'T-101 level');
  assert.equal(list.tag, `${DEV}.LT101`);
  sim.setLevel(95);
  const active = await until(async () => {
    const r = (await call('scadacraft_get_active_alarms')).structuredContent.alarms;
    return r.find((a) => a.alarm === 'T-101 level' && a.level === 'highhigh');
  }, 'highhigh alarm');
  console.log(`active: ${active.level} ${active.text} status ${active.status} toack ${active.toack}`);
  assert.ok(active.toack > 0);
  const acked = await call('scadacraft_ack_alarms', { name: 'T-101 level' });
  assert.equal(acked.structuredContent.acknowledged, 1);
  // the runtime moves the alarm to "acknowledged" at its next check (checkdelay, 1 s)
  const afterAck = await until(async () => {
    const a = (await call('scadacraft_get_active_alarms')).structuredContent.alarms.find((x) => x.alarm === 'T-101 level');
    return a && a.toack === 0 ? a : null;
  }, 'acknowledged state');
  console.log(`after ack: status ${afterAck.status}`);
  sim.setLevel(50);
  const hist = await until(async () => {
    const r = (await call('scadacraft_get_alarm_history', { from: '-10m', name: 'T-101 level' })).structuredContent.events;
    return r.find((e) => e.acktime) ? r : null;
  }, 'alarm history with ack');
  console.log(`alarm history: ${hist.length} event(s), ack at ${new Date(hist[0].acktime).toISOString()}`);

  step('tag history');
  for (const v of [60, 65, 70]) { sim.setLevel(v); await sleep(1500); }
  const csvPath = join(tmp, 'lt101.csv');
  const h = await until(async () => {
    const r = await call('scadacraft_get_history', { tags: [`${DEV}.LT101`], from: '-5m', points: true, csv_path: csvPath });
    return r.structuredContent.series[0].count >= 3 ? r : null;
  }, 'history points', 30000);
  const s = h.structuredContent.series[0];
  console.log(`history: ${s.count} points, min ${s.min}, max ${s.max}, avg ${s.avg?.toFixed(2)}; csv ${existsSync(csvPath)}`);
  assert.ok(s.max >= 70 && existsSync(csvPath) && readFileSync(csvPath, 'utf8').includes('LT101'));

  step('page bound to the PLC');
  await call('scadacraft_create_view', { name: 'Plant e2e', width: 960, height: 528 });
  await call('scadacraft_place_widgets', {
    view: 'Plant e2e', widgets: [
      { widget: 'ob-tank', node: { x: 6, y: 8 }, properties: { level: { tag: `${DEV}.LT101` }, tag: 'T-101' } },
      { widget: 'ob-pump', node: { x: 15, y: 4 }, properties: { running: { tag: `${DEV}.P101_Run` }, command: { tag: `${DEV}.P101_Cmd` }, tag: '101' } },
      { widget: 'ob-readout', node: { x: 20, y: 4 }, properties: { value: { tag: `${DEV}.FT101` }, unit: 'm3/h' } },
    ],
  });
  await call('scadacraft_draw_pipe', { view: 'Plant e2e', path: [{ x: 6, y: 8 }, { x: 6, y: 4 }, { x: 14, y: 4 }] });
  await call('scadacraft_draw_pipe', { view: 'Plant e2e', path: [{ x: 16, y: 4 }, { x: 26, y: 4 }] });
  await call('scadacraft_update_view', { view: 'Plant e2e', background: '#f5f5f5ff' });
  const dup = await call('scadacraft_duplicate_view', { view: 'Plant e2e', new_name: 'Plant e2e copy' });
  const orig = (await call('scadacraft_get_view', { view: 'Plant e2e' })).structuredContent.items;
  const copy = (await call('scadacraft_get_view', { view: 'Plant e2e copy' })).structuredContent.items;
  assert.equal(copy.length, orig.length);
  assert.ok(copy.every((c) => !orig.some((o) => o.id === c.id)), 'duplicate has new item ids');
  console.log(`page: ${orig.length} items, duplicate ${dup.structuredContent.name}`);

  step('export / import');
  const exp = await call('scadacraft_export_project', { path: join(tmp, 'project.json') });
  console.log(exp.content[0].text.split('\n')[0]);
  await call('scadacraft_delete_view', { view: 'Plant e2e copy' });
  await call('scadacraft_delete_alarm', { name: 'T-101 level' });
  const merged = await call('scadacraft_import_project', {
    path: join(tmp, 'project.json'), mode: 'merge', views: ['Plant e2e copy', 'Plant e2e'], alarms: ['T-101 level'],
  });
  console.log(merged.content[0].text.split('\n').slice(0, 3).join(' | '));
  assert.ok(merged.structuredContent.added.includes('view "Plant e2e copy"'));
  assert.ok(merged.structuredContent.added.includes('alarm "T-101 level"'));
  assert.ok(merged.structuredContent.skipped.some((x) => x.includes('Plant e2e')), 'existing view skipped without overwrite');

  step('replace whole project from file (backup first)');
  const backupPath = join(tmp, 'backup.json');
  const rep = await call('scadacraft_import_project', { path: join(tmp, 'project.json'), mode: 'replace', backup_path: backupPath });
  assert.ok(existsSync(backupPath), 'backup written');
  console.log(rep.content[0].text.split('\n')[0]);
  await until(async () => {
    try { return (await call('scadacraft_list_views')).structuredContent.views.length > 0; } catch { return false; }
  }, 'server back after replace', 60000);

  const summary = await call('scadacraft_get_project_summary');
  console.log(summary.content[0].text);

  if (process.env.E2E_CLEANUP === '1') {
    await call('scadacraft_delete_view', { view: 'Plant e2e copy' });
    await call('scadacraft_delete_view', { view: 'Plant e2e' });
    await call('scadacraft_delete_alarm', { name: 'T-101 level' });
    await call('scadacraft_delete_device', { device: DEV });
  } else {
    await call('scadacraft_update_device', { device: DEV, enabled: false });
  }
  console.log('\ne2e-plant OK');
} finally {
  await client.close();
  await sim.close();
  rmSync(tmp, { recursive: true, force: true });
}

// End-to-end test of the app/administration tools: layout, upload, settings, users/roles, scripts,
// notifications, languages/texts, charts, reports, API keys, logs, backups, raw sections.
// Needs a running ScadaCraft (SCADACRAFT_URL). Skips when not reachable.
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
  console.log(`e2e-admin skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'sc-admin-'));
const client = new Client({ name: 'e2e-admin', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
const step = (s) => console.log(`\n== ${s}`);
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
async function until(fn, what, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(500);
  }
}
const sfx = Date.now().toString(36);

try {
  step('setup: tags and a view');
  await call('scadacraft_add_tags', { device: 'FUXA Server', tags: [
    { name: `ADM_Level_${sfx}`, type: 'number', init: '40', history: { enabled: true, interval_s: 1 } },
    { name: `ADM_Out_${sfx}`, type: 'number', init: '0' },
  ] });
  const LEVEL = `FUXA Server.ADM_Level_${sfx}`;
  const OUT = `FUXA Server.ADM_Out_${sfx}`;
  const views = (await call('scadacraft_list_views')).structuredContent.views;
  if (!views.some((v) => v.name === 'Admin overview')) await call('scadacraft_create_view', { name: 'Admin overview' });

  step('upload logo and layout');
  const svg = join(tmp, 'logo.svg');
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#0B1F33"/></svg>');
  const up = await call('scadacraft_upload_image', { path: svg, name: `logo_${sfx}` });
  const logoUrl = up.structuredContent.url;
  assert.ok(logoUrl.includes(`logo_${sfx}.svg`));
  const logoRes = await fetch(`${url}/${logoUrl}`);
  assert.equal(logoRes.status, 200, 'logo served');
  const layout = await call('scadacraft_set_layout', {
    start_view: 'Admin overview',
    menu: { mode: 'fix', type: 'block', background: '#0B1F33', color: '#FFFFFF', logo: logoUrl,
      items: [{ text: 'Overview', view: 'Admin overview', icon: 'home' }, { text: 'Allarmi', alarms: true, icon: 'warning' },
        { text: 'Docs', link: 'https://www.openbridge.no', icon: 'menu_book' }] },
    header: { title: 'Impianto test', background: '#0B1F33', color: '#FFFFFF', alarms: 'fix', infos: 'float', date_time: 'dd/MM/yyyy HH:mm', login_info: 'fullname' },
    zoom: 'autoresize',
  });
  const l = (await call('scadacraft_get_layout')).structuredContent.layout;
  assert.equal(l.start_view, 'Admin overview');
  assert.equal(l.menu.items.length, 3);
  assert.equal(l.menu.items[1].link, '[alarms]');
  assert.equal(l.header.title, 'Impianto test');
  assert.equal(l.menu.logo, logoUrl);
  console.log(`layout ok: menu ${l.menu.mode}/${l.menu.type}, ${l.menu.items.length} items, header "${l.header.title}"`);
  const raw = (await call('scadacraft_get_section', { section: 'layout' })).structuredContent.value;
  assert.equal(raw.navigation.mode, 'fix');
  assert.equal(raw.header.alarms, 'fix');
  assert.equal(raw.zoom, 'autoresize');

  step('settings and history database');
  const before = (await call('scadacraft_get_settings')).structuredContent.settings;
  await call('scadacraft_set_settings', { history_db: { type: 'SQlite', retention: 'days90' }, alarms_retention: 'year1', logs_retention: 'days30' });
  await until(async () => { try { return (await call('scadacraft_get_settings')).structuredContent.settings; } catch { return null; } }, 'server after settings');
  const after = (await call('scadacraft_get_settings')).structuredContent.settings;
  assert.equal(after.daqstore.retention, 'days90');
  assert.equal(after.logs.retention, 'days30');
  console.log(`history db ${after.daqstore.type}, retention ${before.daqstore?.retention} -> ${after.daqstore.retention}`);

  step('roles and users');
  await call('scadacraft_set_role', { name: `Turnisti_${sfx}`, description: 'Shift operators' });
  assert.ok((await call('scadacraft_list_roles')).structuredContent.roles.some((r) => r.name === `Turnisti_${sfx}`));
  const uname = `op_${sfx}`;
  await call('scadacraft_set_user', { username: uname, password: 'Secret123!', fullname: 'Operatore Test', groups: ['operator'], start_view: 'Admin overview' });
  let users = (await call('scadacraft_list_users')).structuredContent.users;
  const u = users.find((x) => x.username === uname);
  assert.deepEqual(u.groups, ['operator']);
  await call('scadacraft_set_user', { username: uname, groups: ['operator', 'supervisor'] });
  users = (await call('scadacraft_list_users')).structuredContent.users;
  assert.deepEqual(users.find((x) => x.username === uname).groups, ['operator', 'supervisor']);
  const login = await fetch(`${url}/api/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'Secret123!' }) });
  assert.equal(login.status, 200, 'new user can sign in');
  await call('scadacraft_delete_user', { username: uname });
  await call('scadacraft_delete_role', { name: `Turnisti_${sfx}` });
  console.log('user created, updated, signed in, deleted');

  step('scripts');
  const sname = `double_${sfx}`;
  await call('scadacraft_set_script', {
    name: sname, parameters: [{ name: 'src', type: 'tagid' }, { name: 'k', type: 'value' }],
    code: `const v = Number($getTag(src)); $setTag($getTagId('ADM_Out_${sfx}', 'FUXA Server'), v * k); return v * k;`,
  });
  const r = await call('scadacraft_run_script', { name: sname, params: { src: LEVEL, k: 2 } });
  assert.equal(Number(r.structuredContent.result), 80, 'script result');
  const out = await until(async () => {
    const v = (await call('scadacraft_read_tags', { tags: [OUT] })).structuredContent.values[0].value;
    return Number(v) === 80 ? v : null;
  }, 'script wrote the tag');
  console.log(`script returned 80 and wrote ${OUT} = ${out}`);
  await call('scadacraft_set_script', { name: `tick_${sfx}`, code: 'return 1;', interval_s: 60 });
  assert.ok((await call('scadacraft_list_scripts')).structuredContent.scripts.find((s) => s.name === `tick_${sfx}`).scheduling.interval === 60);
  await call('scadacraft_delete_script', { name: `tick_${sfx}` });
  await call('scadacraft_delete_script', { name: sname });

  step('notifications, languages, texts');
  await call('scadacraft_set_notification', { name: `Reperibile_${sfx}`, receivers: 'reperibile@example.com', levels: ['highhigh'] });
  assert.ok((await call('scadacraft_list_notifications')).structuredContent.notifications.some((n) => n.name === `Reperibile_${sfx}` && n.subscriptions.highhigh));
  await call('scadacraft_delete_notification', { name: `Reperibile_${sfx}` });
  await call('scadacraft_set_languages', { default: { id: 'IT', name: 'Italiano' }, options: [{ id: 'EN', name: 'English' }] });
  await call('scadacraft_set_texts', { texts: [{ name: `pump_${sfx}`, value: 'Pompa', translations: { EN: 'Pump' } }] });
  const texts = (await call('scadacraft_get_texts')).structuredContent;
  assert.equal(texts.languages.default.id, 'IT');
  assert.equal(texts.texts.find((t) => t.name === `pump_${sfx}`).translations.EN, 'Pump');
  await call('scadacraft_delete_texts', { names: [`pump_${sfx}`] });

  step('chart and report');
  await call('scadacraft_set_chart', { name: `Trend_${sfx}`, lines: [{ tag: LEVEL, label: 'Livello' }, { tag: OUT, yaxis: 2 }] });
  assert.ok((await call('scadacraft_list_charts')).structuredContent.charts.some((c) => c.name === `Trend_${sfx}` && c.lines.length === 2));
  await call('scadacraft_set_report', { name: `Giornaliero_${sfx}`, schedule: 'day', title: 'Report giornaliero', tags: [LEVEL], interval: 'hour', alarms: true, chart: `Trend_${sfx}` });
  await call('scadacraft_build_report', { name: `Giornaliero_${sfx}` });
  const files = await until(async () => {
    const f = (await call('scadacraft_list_reports', { files: true })).structuredContent.files ?? [];
    return f.some((x) => JSON.stringify(x).includes(`Giornaliero_${sfx}`)) ? f : null;
  }, 'report PDF', 60000);
  console.log(`report built: ${JSON.stringify(files.filter((x) => JSON.stringify(x).includes(sfx)))}`);
  await call('scadacraft_delete_report', { name: `Giornaliero_${sfx}` });
  await call('scadacraft_delete_chart', { name: `Trend_${sfx}` });

  step('API keys');
  const k = await call('scadacraft_create_api_key', { name: `scada-bi_${sfx}`, expires_days: 30 });
  assert.equal(k.structuredContent.apiKey.key.length, 40);
  assert.ok((await call('scadacraft_list_api_keys')).structuredContent.apiKeys.some((x) => x.name === `scada-bi_${sfx}` && x.key.endsWith('…')));
  await call('scadacraft_delete_api_key', { name: `scada-bi_${sfx}` });

  step('logs');
  const logs = await call('scadacraft_read_logs', { lines: 5, filter: 'ScadaCraft' });
  console.log(logs.content[0].text.split('\n')[0]);

  step('backups');
  const bk = await call('scadacraft_create_backup', { label: `mcp_${sfx}`, include_history: false });
  console.log(bk.content[0].text);
  await call('scadacraft_set_backup_schedule', { enabled: true, time: '03:15', keep: 5 });
  let st = await call('scadacraft_backup_status');
  assert.ok(st.structuredContent.nextRun, 'next run scheduled');
  console.log(st.content[0].text.split('\n')[0]);
  await call('scadacraft_restore_backup', { name: bk.structuredContent.name });
  st = await call('scadacraft_backup_status');
  assert.ok(st.structuredContent.pendingRestore, 'restore pending');
  await call('scadacraft_restore_backup', { cancel: true });
  st = await call('scadacraft_backup_status');
  assert.ok(!st.structuredContent.pendingRestore, 'restore cancelled');
  await call('scadacraft_set_backup_schedule', { enabled: false });
  await call('scadacraft_delete_backup', { name: bk.structuredContent.name });

  console.log('\ne2e-admin OK');
} finally {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
}

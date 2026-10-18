// End-to-end test of navigation and maps through the MCP server: OpenBridge icon search, side menu with
// OpenBridge icons and a sub-menu, header items (button with events, label showing a tag, icon with colours),
// map locations with a tag value and pages, a map page, deletion. Restores the previous layout.
// Needs a running ScadaCraft (SCADACRAFT_URL); skips otherwise.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
try {
  await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`e2e-navigation skipped: ScadaCraft not reachable at ${url}`);
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'e2e-navigation', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res;
}
const project = async () => (await fetch(`${url}/api/project`)).json();
const keep = process.env.E2E_KEEP === '1';
const before = (await project()).hmi?.layout;

try {
  // icons
  const icons = (await call('scadacraft_list_icons', { search: 'pump', limit: 10 })).structuredContent;
  assert.ok(icons.total > 0 && icons.icons.every((i) => i.startsWith('ob:') && i.includes('pump')));
  const all = (await call('scadacraft_list_icons', { limit: 500 })).structuredContent;
  assert.ok(all.total > 1500, `about 2000 icons, got ${all.total}`);
  assert.equal((await fetch(`${url}/assets/lib/openbridge/icons/${icons.icons[0].slice(3)}.svg`)).status, 200);

  // pages
  const views = (await call('scadacraft_list_views')).structuredContent.views;
  for (const v of ['Nav overview', 'Nav station', 'Nav map']) if (views.some((x) => x.name === v)) await call('scadacraft_delete_view', { view: v });
  await call('scadacraft_create_view', { name: 'Nav overview', width: 960, height: 600 });
  await call('scadacraft_create_view', { name: 'Nav station', width: 960, height: 600 });
  const tags = (await call('scadacraft_list_tags', { device: 'FUXA Server', limit: 500 })).structuredContent.tags ?? [];
  const need = [['NAV_Level', 'number', '3.2'], ['NAV_Alarm', 'boolean', '0']].filter(([n]) => !tags.some((t) => t.name === n));
  if (need.length) await call('scadacraft_add_tags', { device: 'FUXA Server', tags: need.map(([name, type, init]) => ({ name, type, init })) });

  // map
  for (const n of ['Nav Ermitage', 'Nav Papaleo']) {
    const list = (await call('scadacraft_list_map_locations')).structuredContent.locations;
    if (list.some((l) => l.name === n)) await call('scadacraft_delete_map_location', { location: n });
  }
  const loc = (await call('scadacraft_set_map_location', { name: 'Nav Ermitage', latitude: 39.55, longitude: 16.95, page: 'Nav station',
    card_page: 'Nav station', value_tag: 'FUXA Server.NAV_Level', icon: 'ob:location-1' })).structuredContent.location;
  assert.equal(loc.page, 'Nav station');
  assert.equal(loc.value_tag, 'FUXA Server.NAV_Level');
  await call('scadacraft_set_map_location', { name: 'Nav Papaleo', latitude: 39.51, longitude: 16.99, url: 'https://example.com' });
  const map = (await call('scadacraft_set_map_page', { name: 'Nav map', locations: ['Nav Ermitage', 'Nav Papaleo'] })).structuredContent;
  assert.deepEqual(map.locations, ['Nav Ermitage', 'Nav Papaleo']);
  let p = await project();
  const mv = p.hmi.views.find((v) => v.name === 'Nav map');
  assert.equal(mv.type, 'maps');
  assert.equal(JSON.parse(mv.svgcontent).length, 2);
  assert.ok(Math.abs(mv.property.startLocation.latitude - 39.53) < 0.01);
  const stored = p.mapsLocations.find((l) => l.name === 'Nav Ermitage');
  assert.equal(stored.pageId, p.hmi.views.find((v) => v.name === 'Nav station').id);
  assert.ok(stored.markerTagValueId && stored.showMarkerValue);
  // update keeps the id
  const upd = (await call('scadacraft_set_map_location', { name: 'Nav Ermitage', latitude: 39.56, longitude: 16.95 })).structuredContent.location;
  assert.equal(upd.id, stored.id);

  // layout: OpenBridge icons, sub-menu, header items
  await call('scadacraft_set_layout', {
    menu: { mode: 'fix', type: 'block', items: [
      { text: 'Overview', view: 'Nav overview', icon: 'ob:home' },
      { text: 'Sites', icon: 'ob:location-a', children: [{ text: 'Map', view: 'Nav map', icon: 'ob:location-1' }, { text: 'Station', view: 'Nav station', icon: icons.icons[0] }] },
      { text: 'Alarms', alarms: true, icon: 'ob:alerts' },
    ] },
    header: { title: 'Nav test', items_anchor: 'right', items: [
      { type: 'button', text: 'Station', icon: icons.icons[0], events: [{ action: 'open_page', page: 'Nav station' }] },
      { type: 'label', text: 'Level', tag: 'FUXA Server.NAV_Level' },
      { type: 'image', icon: 'ob:alerts', tag: 'FUXA Server.NAV_Alarm', colors: [{ min: 1, max: 1, stroke: '#E30019' }], events: [{ action: 'toggle_value' }] },
    ] },
  });
  p = await project();
  const nav = p.hmi.layout.navigation;
  assert.equal(nav.items[0].icon, 'ob:home');
  assert.equal(nav.items[1].children.length, 2);
  assert.equal(nav.items[1].children[0].view, mv.id);
  const hi = p.hmi.layout.header.items;
  assert.equal(hi.length, 3);
  assert.equal(hi[0].type, 'button');
  assert.equal(hi[0].property.events[0].action, 'onpage');
  assert.ok(hi[0].id.startsWith('i_'));
  assert.ok(hi[1].property.variableId);
  assert.equal(hi[2].property.ranges[0].stroke, '#E30019');
  assert.equal(hi[2].property.events[0].action, 'onToggleValue');
  assert.equal(hi[2].property.events[0].actoptions.variable.variableId, hi[2].property.variableId);
  const lay = (await call('scadacraft_get_layout')).structuredContent.layout;
  assert.equal(lay.menu.items[1].children[0].view, 'Nav map');

  // errors
  const bad = await client.callTool({ name: 'scadacraft_set_map_page', arguments: { name: 'Nav map', locations: ['Nowhere'] } });
  assert.ok(bad.isError && /not found/.test(bad.content[0].text));
  const bad3 = await client.callTool({ name: 'scadacraft_set_layout', arguments: { menu: { items: [{ text: 'x', view: 'Nav map', icon: 'ob:pump-onn' }] } } });
  assert.ok(bad3.isError && /Unknown OpenBridge icon "ob:pump-onn"\. Similar: .*ob:pump/.test(bad3.content[0].text), bad3.content[0].text);
  const bad2 = await client.callTool({ name: 'scadacraft_set_layout', arguments: { header: { items: [{ type: 'image' }] } } });
  assert.ok(bad2.isError && /needs an icon/.test(bad2.content[0].text));

  if (!keep) {
    await call('scadacraft_delete_map_location', { location: 'Nav Papaleo' });
    p = await project();
    assert.equal(JSON.parse(p.hmi.views.find((v) => v.name === 'Nav map').svgcontent).length, 1, 'deleted location removed from the map page');
  }
  console.log('e2e-navigation OK');
} finally {
  if (!keep && before) await call('scadacraft_set_section', { cmd: 'layout', value: before }).catch(() => {});
  await client.close();
}

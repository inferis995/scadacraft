// Example: a pumping-station HMI page built entirely through the ScadaCraft MCP server.
//
// Tank levels, booster pump with inverter, pressure loop with setpoint, mode control and coil states,
// with OpenBridge widgets, plain shapes and labels that follow the OpenBridge palette, alarms and
// a server script that simulates the plant (no PLC needed). Re-running it rebuilds the page.
//
//   node examples/stazione-pompaggio.mjs            (SCADACRAFT_URL, default http://127.0.0.1:1881)
//
// To connect a real PLC later: create a Modbus device, move the tags there (same names) and
// disable the "simulazione_stazione" script; the page bindings refer to tag names only through ids.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881';
const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'example-stazione', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: { ...process.env, SCADACRAFT_URL: url }, stderr: 'inherit',
}));
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return res.structuredContent ?? {};
}

const VIEW = 'Stazione di pompaggio';
const DEV = 'FUXA Server';
const T = (n) => ({ tag: `${DEV}.${n}` });

try {
  // ---------------------------------------------------------------- tags (server memory, simulated)
  const tags = [
    // analog values (input registers on the real PLC)
    ['SP_Pressione', 'number', '35', 'Setpoint pressione impianto (bar) — IR 0x0001'],
    ['Corrente', 'number', '12.4', 'Corrente uscita inverter (A) — IR 0x0002'],
    ['Frequenza', 'number', '48.5', 'Frequenza uscita inverter (Hz) — IR 0x0003'],
    ['Potenza', 'number', '7.2', 'Potenza uscita (kW) — IR 0x0004'],
    ['Tensione', 'number', '395', 'Tensione uscita (V) — IR 0x0005'],
    ['Giri', 'number', '1455', 'Numero di giri (rpm) — IR 0x0006'],
    ['Temp_Inverter', 'number', '42', 'Temperatura inverter (°C) — IR 0x0007'],
    ['Energia_kWh', 'number', '4832', 'Energia consumata (kWh) — IR 0x0008'],
    ['Energia_MWh', 'number', '12', 'Energia consumata (MWh) — IR 0x0009'],
    ['Pressione', 'number', '34.2', 'Pressione attuale (bar) — IR 0x000B'],
    ['SP_Manuale_Hz', 'number', '48', 'Setpoint velocità manuale (Hz) — HR 0x000C'],
    ['Livello_S1', 'number', '68.5', 'Livello serbatoio S1 (%) — IR 0x0014'],
    ['Livello_S2', 'number', '82.1', 'Livello serbatoio S2 (%) — IR 0x0012'],
    ['Velocita_Pct', 'number', '97', 'Velocità pompa % (calcolata)'],
    // coils
    ['Abil_Auto', 'boolean', '1', 'Abilitazione inverter AUTO — coil 0x0066'],
    ['Abil_Man', 'boolean', '0', 'Abilitazione inverter MANUALE — coil 0x0067'],
    ['Marcia', 'boolean', '1', 'Inverter in marcia — coil 0x0068'],
    ['Fault_Inverter', 'boolean', '0', 'Inverter in fault — coil 0x0069'],
    ['Richiesta_Acqua', 'boolean', '0', 'Richiesta acqua — coil 0x006A'],
    ['Rete_220V', 'boolean', '1', '220 V carica batterie OK — coil 0x006B'],
    ['Fault_Batterie', 'boolean', '0', 'Fault batterie — coil 0x006C'],
    ['Abil_Esterna', 'boolean', '1', 'Abilitazione esterna — coil 0x006D'],
    ['Galleggiante', 'boolean', '1', 'Galleggiante esterno OK — coil 0x006E'],
    ['Modo', 'number', '1', 'Modo: 0 manuale, 1 automatico (PID) — coil 0x006F/0x0070'],
    ['Modo_Auto', 'boolean', '1', 'Modo automatico (PID) — coil 0x006F'],
    ['Modo_Man', 'boolean', '0', 'Modo manuale — coil 0x0070'],
    ['Bypass_Sonda', 'boolean', '0', 'Bypass sonda livello — coil 0x0071'],
    ['Freq_Costante', 'boolean', '0', 'Frequenza costante (emergenza) — coil 0x0072'],
    // texts for the status tags (computed by the simulation script)
    ['Stato_Testo', 'string', 'OK', 'Stato generale'],
    ['Stato_Colore', 'string', 'green', 'Colore stato generale'],
    ['Modo_Testo', 'string', 'AUTOMATICO', 'Modo in testo'],
    ['Modo_Colore', 'string', 'green', 'Colore modo'],
    ['Pompa_Testo', 'string', 'IN MARCIA', 'Stato pompa in testo'],
    ['Pompa_Colore', 'string', 'green', 'Colore stato pompa'],
  ];
  const existing = new Set(((await call('scadacraft_list_tags', { device: DEV, limit: 500 })).tags ?? []).map((t) => t.ref.slice(DEV.length + 1)));
  const missing = tags.filter(([n]) => !existing.has(n)).map(([name, type, init, description]) => ({
    name, type, init, description, ...(type === 'number' && ['Pressione', 'Livello_S1', 'Livello_S2', 'Frequenza'].includes(name) ? { history: { enabled: true, interval_s: 5 } } : {}),
  }));
  if (missing.length) await call('scadacraft_add_tags', { device: DEV, tags: missing });
  await call('scadacraft_create_alarm_status_tags');
  console.log(`tags: ${tags.length} (${missing.length} created)`);

  // ---------------------------------------------------------------- plant simulation (server script, every 2 s)
  await call('scadacraft_set_script', {
    name: 'simulazione_stazione', interval_s: 2,
    code: `
const D = 'FUXA Server';
const id = (n) => $getTagId(n, D);
const get = (n) => Number($getTag(id(n)));
const set = (n, v) => $setTag(id(n), v);
const walk = (n, step, lo, hi, bias) => {
  const v = get(n) + (Math.random() - (bias === undefined ? 0.5 : bias)) * step;
  set(n, Math.round(Math.max(lo, Math.min(hi, v)) * 10) / 10);
};
const auto = get('Modo') >= 1;
set('Modo_Auto', auto); set('Modo_Man', !auto);
set('Abil_Auto', auto); set('Abil_Man', !auto);
const run = !$getTag(id('Fault_Inverter')) || $getTag(id('Fault_Inverter')) === 'false';
set('Marcia', run);
if (run) {
  walk('Pressione', 0.6, 28, 38, 0.48);
  walk('Corrente', 0.8, 8, 18);
  if (auto && !$getTag(id('Freq_Costante'))) walk('Frequenza', 0.6, 40, 50); else set('Frequenza', get('SP_Manuale_Hz'));
  walk('Potenza', 0.4, 5, 10);
  set('Giri', Math.round(get('Frequenza') * 30));
  walk('Temp_Inverter', 0.6, 35, 55, 0.49);
  set('Energia_kWh', Math.round((get('Energia_kWh') + 0.01) * 100) / 100);
} else {
  set('Corrente', 0); set('Potenza', 0); set('Giri', 0); set('Frequenza', 0);
  walk('Pressione', 0.6, 0, 38, 0.6);
}
set('Velocita_Pct', Math.round(get('Frequenza') / 50 * 100));
walk('Livello_S1', 0.8, 10, 95, 0.51);
walk('Livello_S2', 0.4, 10, 95, 0.5);
const alarm = (!run) || $getTag(id('Fault_Batterie')) === true || get('Pressione') > 50;
set('Stato_Testo', alarm ? 'ALLARME' : 'OK'); set('Stato_Colore', alarm ? 'red' : 'green');
set('Modo_Testo', $getTag(id('Freq_Costante')) === true ? 'FREQ. COSTANTE' : auto ? 'AUTOMATICO' : 'MANUALE');
set('Modo_Colore', auto ? 'green' : 'blue');
set('Pompa_Testo', run ? 'IN MARCIA' : 'FAULT'); set('Pompa_Colore', run ? 'green' : 'red');
return 'ok';`,
  });

  // ---------------------------------------------------------------- alarms (OpenBridge alert colours by default)
  await call('scadacraft_set_alarm', { name: 'Inverter in fault', tag: `${DEV}.Fault_Inverter`, levels: { highhigh: { above: 0.5, text: 'Inverter in fault', group: 'Pompa' } } });
  await call('scadacraft_set_alarm', { name: 'Fault batterie', tag: `${DEV}.Fault_Batterie`, levels: { high: { above: 0.5, text: 'Fault batterie', group: 'Alimentazione' } } });
  await call('scadacraft_set_alarm', { name: 'Pressione impianto', tag: `${DEV}.Pressione`, levels: {
    highhigh: { above: 50, text: 'Pressione molto alta', group: 'Impianto' }, high: { above: 40, text: 'Pressione alta', group: 'Impianto' } } });
  await call('scadacraft_set_alarm', { name: 'Livello S1', tag: `${DEV}.Livello_S1`, levels: { low: { below: 20, text: 'Livello S1 basso', group: 'Serbatoi' } } });
  await call('scadacraft_set_alarm', { name: 'Temperatura inverter', tag: `${DEV}.Temp_Inverter`, levels: { high: { above: 60, text: 'Temperatura inverter alta', group: 'Pompa' } } });

  // ---------------------------------------------------------------- page
  const views = (await call('scadacraft_list_views')).views;
  if (views.some((v) => v.name === VIEW)) await call('scadacraft_delete_view', { view: VIEW });
  await call('scadacraft_create_view', { name: VIEW, width: 1488, height: 888, background: '#F7F7F7' });

  // cards, titles and labels (OpenBridge palette tokens follow day / dusk / night)
  const card = (x, y, w, h) => ({ type: 'rect', x, y, width: w, height: h, radius: 0.33, fill: 'ob:container-global', stroke: 'ob:border-outline' });
  const title = (x, y, text) => ({ type: 'text', x, y, text, size: 11, weight: 700, color: 'ob:element-neutral', uppercase: true });
  const label = (x, y, text, size = 12) => ({ type: 'text', x, y, text, size, color: 'ob:element-active' });
  const addr = (x, y, text) => ({ type: 'text', x, y, text, size: 9, color: 'ob:element-neutral', font: 'monospace' });
  const shapes = [
    // top bar
    { type: 'rect', x: 0, y: 0, width: 62, height: 2.5, fill: 'ob:container-global', stroke: 'ob:border-outline' },
    { type: 'text', x: 1, y: 1.2, text: 'Stazione di pompaggio S1', size: 16, weight: 700, color: 'ob:element-active' },
    addr(1, 2, 'Modbus TCP · FC01 + FC04 · dati simulati'),
    // columns
    card(0.5, 3, 18, 13), title(1.2, 4.1, 'Livelli serbatoi'),
    card(0.5, 16.5, 18, 15.5), title(1.2, 17.6, 'Stato pompa'),
    card(19, 3, 26, 11), title(19.7, 4.1, 'Pressione esercizio'),
    label(29, 9.3, 'Pressione attuale / setpoint', 11),
    card(19, 14.5, 26, 9.5), title(19.7, 15.6, 'Inverter — dati elettrici'),
    card(19, 24.5, 26, 7.5), title(19.7, 25.6, 'Controllo modalità'),
    label(40.3, 27.4, 'SP manuale', 11),
    card(45.5, 3, 16, 29), title(46.2, 4.1, 'Stati I/O — coil'),
    // bottom bar
    card(0.5, 32.5, 61, 4),
    addr(46, 35.2, 'Simulazione dati · aggiornamento 2 s'),
  ];
  // [tag, label, address, state when on: 2 running (green), 1 active (blue), 5 alarm (red)]
  const coils = [
    ['Modo_Auto', 'Modo automatico (PID)', '0x006F', 2], ['Modo_Man', 'Modo manuale', '0x0070', 1],
    ['Marcia', 'Inverter in marcia', '0x0068', 2], ['Abil_Auto', 'Abilitazione inverter AUTO', '0x0066', 1],
    ['Abil_Man', 'Abilitazione inverter MAN', '0x0067', 1], ['Fault_Inverter', 'Inverter in fault', '0x0069', 5],
    ['Richiesta_Acqua', 'Richiesta acqua', '0x006A', 1], ['Abil_Esterna', 'Abilitazione esterna', '0x006D', 2],
    ['Galleggiante', 'Galleggiante esterno', '0x006E', 2], ['Rete_220V', '220 V carica batterie', '0x006B', 2],
    ['Fault_Batterie', 'Fault batterie', '0x006C', 5], ['Bypass_Sonda', 'Bypass sonda livello', '0x0071', 1],
    ['Freq_Costante', 'Frequenza costante attiva', '0x0072', 1],
  ];
  coils.forEach(([, text, a], i) => {
    const y = 5 + i * 2;
    shapes.push(label(48.6, y + 0.75, text), addr(48.6, y + 1.35, a));
    if (i < coils.length - 1) shapes.push({ type: 'line', x1: 46, y1: y + 1.75, x2: 61, y2: y + 1.75, stroke: 'ob:border-divider' });
  });
  await call('scadacraft_draw_shapes', { view: VIEW, shapes });

  // widgets
  const widgets = [
    // top bar: general state, mode, alarms, clock
    { widget: 'ob-tag', node: { x: 13, y: 0 }, size: { width: 4, height: 2 }, properties: { label: T('Stato_Testo'), color: T('Stato_Colore') } },
    { widget: 'ob-alert-button', node: { x: 17, y: 0 }, size: { width: 5, height: 2 }, properties: { count: T('Alarms Unacknowledged') } },
    { widget: 'ob-tag', node: { x: 45, y: 0 }, size: { width: 7, height: 2 }, properties: { label: T('Modo_Testo'), color: T('Modo_Colore') } },
    { widget: 'ob-clock', node: { x: 53, y: 0 }, size: { width: 5, height: 2 }, properties: { seconds: true } },
    // tanks
    { widget: 'ob-tank', node: { x: 5, y: 6 }, name: 'S1', properties: { level: T('Livello_S1'), tag: 'S1', fluid: 'fresh-water' } },
    { widget: 'ob-tank', node: { x: 14, y: 6 }, name: 'S2', properties: { level: T('Livello_S2'), tag: 'S2', fluid: 'fresh-water' } },
    // pump card: alarm frame first (under the pump, so the pump stays selectable), pump symbol, state, speed
    { widget: 'ob-alert-frame', node: { x: 1, y: 18 }, size: { width: 17, height: 13 }, properties: { active: T('Fault_Inverter') } },
    { widget: 'ob-pump', node: { x: 9, y: 21 }, name: 'P1', properties: { running: T('Marcia'), alarm: T('Fault_Inverter'), speed: T('Velocita_Pct'), auto: T('Modo_Auto'), tag: '1' } },
    { widget: 'ob-tag', node: { x: 7, y: 25 }, size: { width: 5, height: 2 }, properties: { label: T('Pompa_Testo'), color: T('Pompa_Colore') } },
    { widget: 'ob-instrument-field', node: { x: 2, y: 28 }, size: { width: 7, height: 3 }, properties: { value: T('Frequenza'), unit: 'Hz', tag: 'Frequenza', digits: 2, decimals: 1 } },
    { widget: 'ob-instrument-field', node: { x: 10, y: 28 }, size: { width: 7, height: 3 }, properties: { value: T('Giri'), unit: 'rpm', tag: 'Giri', digits: 4, decimals: 0 } },
    // pressure
    { widget: 'ob-gauge-radial', node: { x: 20, y: 5 }, name: 'PT-101', properties: { value: T('Pressione'), max: 60, hasSetpoint: true, setpoint: T('SP_Pressione') } },
    { widget: 'ob-instrument-field', node: { x: 29, y: 5 }, size: { width: 8, height: 3 }, properties: { value: T('Pressione'), unit: 'bar', tag: 'PT-101', hasSetpoint: true, setpoint: T('SP_Pressione'), digits: 2, decimals: 1 } },
    { widget: 'ob-gauge-horizontal', node: { x: 29, y: 10 }, size: { width: 15, height: 3 }, properties: { value: T('Pressione'), max: 60, hasSetpoint: true, setpoint: T('SP_Pressione') } },
    // inverter values
    ...[['Corrente', 'A', 'Corrente uscita'], ['Frequenza', 'Hz', 'Frequenza uscita'], ['Potenza', 'kW', 'Potenza uscita'],
      ['Tensione', 'V', 'Tensione uscita'], ['Giri', 'rpm', 'Numero di giri'], ['Temp_Inverter', '°C', 'Temperatura inverter']]
      .map(([tag, unit, text], i) => ({
        widget: 'ob-instrument-field', node: { x: 20 + (i % 3) * 8, y: 16 + Math.floor(i / 3) * 4 }, size: { width: 8, height: 3 },
        properties: { value: T(tag), unit, tag: text, digits: tag === 'Giri' || tag === 'Tensione' ? 4 : 2, decimals: tag === 'Giri' || tag === 'Tensione' ? 0 : 1 },
      })),
    // mode control
    { widget: 'ob-mode-selector', node: { x: 20, y: 26 }, size: { width: 12, height: 2 }, properties: { value: T('Modo'), option1: 'MANUALE', option2: 'AUTO (PID)', options: 2 } },
    { widget: 'ob-number-input', node: { x: 33, y: 26 }, size: { width: 7, height: 2 }, properties: { value: T('SP_Manuale_Hz'), unit: 'Hz', decimals: 0 } },
    { widget: 'ob-check-button', node: { x: 20, y: 29 }, size: { width: 9, height: 2 }, properties: { value: T('Bypass_Sonda'), label: 'Bypass sonda' } },
    { widget: 'ob-check-button', node: { x: 30, y: 29 }, size: { width: 9, height: 2 }, properties: { value: T('Freq_Costante'), label: 'Freq. costante' } },
    // coil states: running/OK as status indicators, faults as alert icons
    // LED colours as in OpenBridge: running/OK green, modes and requests blue (active), faults red (alarm)
    ...coils.map(([tag, , , onState], i) => ({
      widget: 'ob-status-indicator', node: { x: 46, y: 5 + i * 2 }, size: { width: 2, height: 2 }, properties: { state: T(tag), onState },
    })),
    // bottom bar
    { widget: 'ob-instrument-field', node: { x: 1, y: 33 }, size: { width: 8, height: 3 }, properties: { value: T('Energia_kWh'), unit: 'kWh', tag: 'Energia consumata', digits: 5, decimals: 0 } },
    { widget: 'ob-instrument-field', node: { x: 10, y: 33 }, size: { width: 7, height: 3 }, properties: { value: T('Energia_MWh'), unit: 'MWh', tag: 'Energia', digits: 3, decimals: 0 } },
    { widget: 'ob-instrument-field', node: { x: 19, y: 33 }, size: { width: 9, height: 3 }, properties: { value: T('SP_Manuale_Hz'), unit: 'Hz', tag: 'SP velocità manuale', digits: 2, decimals: 0 } },
    { widget: 'ob-instrument-field', node: { x: 29, y: 33 }, size: { width: 9, height: 3 }, properties: { value: T('SP_Pressione'), unit: 'bar', tag: 'SP pressione impianto', digits: 2, decimals: 0 } },
    { widget: 'ob-status-indicator', node: { x: 44, y: 34 }, size: { width: 2, height: 1 }, properties: { state: 2 } },
  ];
  const placed = await call('scadacraft_place_widgets', { view: VIEW, widgets });
  if (placed.warnings?.length) console.log('warnings:', placed.warnings);
  console.log(`page "${VIEW}": ${shapes.length} shapes, ${placed.placed.length} widgets`);

  // pressure trend page and menu entries
  await call('scadacraft_create_trend_page', {
    name: 'Trend stazione', title: 'Pressione e livelli', minutes: 30,
    tags: [{ tag: `${DEV}.Pressione`, label: 'Pressione (bar)' }, { tag: `${DEV}.Livello_S1`, label: 'Livello S1 (%)', yaxis: 2 },
      { tag: `${DEV}.Livello_S2`, label: 'Livello S2 (%)', yaxis: 2 }],
  }).catch((e) => console.log(`trend page: ${e.message.split('\n')[0]}`));
  console.log(`open ${url}/home?viewName=${encodeURIComponent(VIEW)}`);
} finally {
  await client.close();
}

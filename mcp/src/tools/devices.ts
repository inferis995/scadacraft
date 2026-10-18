/** Device and tag tools: connections to field equipment and their data points. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SERVER_DEVICE_ID } from '../fuxa/ids.js';
import { allDevices, allTags } from '../fuxa/tags.js';
import type { Device, Tag } from '../fuxa/types.js';
import {
  DEVICE_TYPES, MODBUS_TYPES, modbusAddressLabel, OPCUA_TYPES, S7_TYPES, SERVER_TYPES, type ConnectionInput, type TagInput,
} from '../services/devices.js';
import { DeviceRef, ok, RELOAD_NOTE, run, type Ctx } from './common.js';

const ConnectionSchema = z.object({
  host: z.string().optional().describe('IP or host name (Modbus TCP, S7)'),
  port: z.number().int().min(1).max(65535).optional().describe('TCP port (Modbus TCP default 502)'),
  address: z.string().optional().describe('Raw address as stored by ScadaCraft, e.g. "192.168.1.10:502", "opc.tcp://host:4840", "mqtt://broker:1883"'),
  slave_id: z.number().int().min(0).max(255).optional().describe('Modbus unit/slave id'),
  serial_port: z.string().optional().describe('Modbus RTU serial port, e.g. "/dev/ttyUSB0" or "COM3"'),
  baudrate: z.number().int().optional(),
  databits: z.number().int().optional(),
  stopbits: z.number().optional(),
  parity: z.enum(['None', 'Odd', 'Even']).optional(),
  modbus_mode: z.enum(['TcpPort', 'UdpPort', 'TcpRTUBufferedPort', 'TelnetPort', 'SerialPort', 'RTUBufferedPort', 'AsciiPort']).optional()
    .describe('Modbus transport (default TcpPort for TCP, SerialPort for RTU)'),
  delay_ms: z.number().int().min(0).optional().describe('Modbus delay between frames (default 10)'),
  force_fc16: z.boolean().optional().describe('Modbus: always write with FC16'),
  rack: z.number().int().min(0).optional().describe('S7 rack (default 0)'),
  slot: z.number().int().min(0).optional().describe('S7 slot (default 2; S7-1200/1500 use 1)'),
  endpoint: z.string().optional().describe('OPC UA endpoint, e.g. "opc.tcp://192.168.1.20:4840"'),
  broker: z.string().optional().describe('MQTT broker URL, e.g. "mqtt://192.168.1.30:1883"'),
  username: z.string().optional().describe('OPC UA / MQTT user (stored as device security, not in the project file)'),
  password: z.string().optional(),
  client_id: z.string().optional().describe('MQTT client id'),
  security_mode: z.string().optional().describe('OPC UA security mode object as text, advanced'),
  timeout_ms: z.number().int().optional(),
  extra: z.record(z.string(), z.unknown()).optional().describe('Advanced: raw fields copied into device.property'),
}).strict();

const HistorySchema = z.object({
  enabled: z.boolean(),
  interval_s: z.number().int().min(1).optional().describe('save at least every N seconds (default 60)'),
  on_change: z.boolean().optional().describe('also save when the value changes (default true)'),
  restore: z.boolean().optional().describe('restore the last saved value at start'),
}).strict();

const TagFields = {
  address: z.string().optional().describe(
    'Modbus: "40001" holding reg, "30001" input reg, "00001" coil, "10001" discrete input (also 6 digits "400001", or "hr:1", "ir:1", "coil:1", "di:1"). ' +
    'S7: "DB1,REAL0", "DB10,INT2", "M0.0", "I0.1", "Q0.0". OPC UA: node id "ns=2;s=Pump1.Run". MQTT: topic. Not needed for server tags.'),
  type: z.string().optional().describe(
    `Modbus: ${MODBUS_TYPES.join(', ')}. S7: ${S7_TYPES.join(', ')}. OPC UA: ${OPCUA_TYPES.join(', ')}. Server tags: ${SERVER_TYPES.join(', ')}.`),
  json_key: z.string().optional().describe('MQTT: key to extract from a JSON payload'),
  divisor: z.number().optional().describe('Modbus: raw value divided by this'),
  decimals: z.number().int().min(0).max(10).optional(),
  description: z.string().optional(),
  init: z.string().optional().describe('Initial value (server tags)'),
  history: HistorySchema.optional().describe('Historical logging (DAQ), required to read history and draw trends'),
  scale: z.object({ raw_low: z.number(), raw_high: z.number(), scaled_low: z.number(), scaled_high: z.number() }).strict().optional()
    .describe('Linear scaling, e.g. 4-20 mA raw 0-27648 to 0-10 bar'),
  deadband: z.number().min(0).optional().describe('Ignore changes smaller than this'),
};

function tagLine(device: Device, t: Tag): string {
  const addr = (device.type === 'ModbusTCP' || device.type === 'ModbusRTU') ? modbusAddressLabel(t) ?? t.address : t.address;
  const daq = (t.daq as { enabled?: boolean; interval?: number } | undefined)?.enabled ? ', history on' : '';
  return `- \`${device.name}.${t.name}\` ${t.type ?? ''}${addr ? ` @ ${addr}` : ''}${t.divisor && t.divisor !== 1 ? ` /${t.divisor}` : ''}${daq}`;
}

function maskProperty(p: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined && v !== null && v !== '') out[k] = /pass|pwd|secret/i.test(k) ? '***' : v;
  return out;
}

/** Connection status tag values (server runtime ConnectionStatusEnum). */
function statusLabel(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'unknown';
  return ({ 0: 'no response', 3: 'warning (slow or intermittent)', 5: 'ok' } as Record<number, string>)[Number(v)] ?? String(v);
}

export function registerDeviceTools(server: McpServer, ctx: Ctx): void {
  server.registerTool('scadacraft_list_devices', {
    title: 'List devices',
    description: `List the devices (field connections) of the project with type, connection settings, polling, tag count and live connection status.

Returns: devices [{id, name, type, enabled, polling_ms, connection, tags, status}]. "FUXA Server" is the internal memory-tag device.
Status: ok | warning (no answer for 2-5 polls) | no response (more than 5 polls) | disabled | unknown, from the "<device> Connection Status" system tag.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => run(async () => {
    const project = await ctx.client.getProject();
    const server0 = ctx.devices.serverDevice(project);
    const statusTags = Object.values(server0.tags ?? {}).filter((t) => t.sysType === 1);
    const values = statusTags.length ? await ctx.client.getTagValues(statusTags.map((t) => t.id)).catch(() => []) : [];
    const devices = allDevices(project).map((d) => {
      const real = d.id === SERVER_DEVICE_ID ? server0 : d;
      const st = statusTags.find((t) => t.memaddress === d.id);
      const val = st ? values.find((v) => v.id === st.id)?.value : undefined;
      return {
        id: real.id, name: real.name, type: real.type, enabled: real.enabled !== false, polling_ms: real.polling,
        connection: maskProperty(real.property), tags: Object.keys(real.tags ?? {}).length,
        status: d.id === SERVER_DEVICE_ID ? 'internal' : real.enabled === false ? 'disabled' : statusLabel(val),
      };
    });
    const text = devices.map((d) => `- **${d.name}** (${d.type}, \`${d.id}\`) ${d.enabled ? 'enabled' : 'DISABLED'}, ` +
      `${d.tags} tags, polling ${d.polling_ms ?? '—'} ms, status ${d.status}${Object.keys(d.connection).length ? ` — ${JSON.stringify(d.connection)}` : ''}`).join('\n');
    return ok(text || 'No devices.', { devices });
  }));

  server.registerTool('scadacraft_create_device', {
    title: 'Create device',
    description: `Create a device (connection to a PLC, RTU, controller or broker). Also adds its "<name> Connection Status" system tag.

Args:
  - name (string): unique device name, used in tag references "Device.Tag"
  - type: ${DEVICE_TYPES.join(' | ')}
  - enabled (boolean, default false): start communicating immediately. Leave false until tags are defined and checked.
  - polling_ms (number, default 1000)
  - connection: driver settings, e.g.
      ModbusTCP:  {"host": "192.168.1.10", "port": 502, "slave_id": 1}
      ModbusRTU:  {"serial_port": "/dev/ttyUSB0", "baudrate": 9600, "parity": "None", "slave_id": 1}
      SiemensS7:  {"host": "192.168.1.20", "rack": 0, "slot": 1}
      OPCUA:      {"endpoint": "opc.tcp://192.168.1.30:4840", "username": "...", "password": "..."}
      MQTTclient: {"broker": "mqtt://192.168.1.40:1883", "client_id": "scadacraft"}

Returns: the created device. Next: scadacraft_add_tags, then scadacraft_update_device {enabled: true}.
${RELOAD_NOTE}`,
    inputSchema: {
      name: z.string().min(1).max(100),
      type: z.enum(DEVICE_TYPES),
      enabled: z.boolean().default(false),
      polling_ms: z.number().int().min(50).max(3600000).default(1000),
      connection: ConnectionSchema.default({}),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name, type, enabled, polling_ms, connection }) => run(async () => {
    const d = await ctx.devices.createDevice({ name, type, enabled, polling_ms, connection: connection as ConnectionInput });
    const warning = await ctx.devices.driverWarning(type);
    return ok(`Created device **${d.name}** (${d.type}, \`${d.id}\`), ${d.enabled ? 'enabled' : 'disabled'}, connection ${JSON.stringify(maskProperty(d.property))}.` +
      (warning ? `\nWarning: ${warning}` : ''),
      { id: d.id, name: d.name, type: d.type, enabled: d.enabled, connection: maskProperty(d.property), ...(warning ? { warning } : {}) });
  }));

  server.registerTool('scadacraft_update_device', {
    title: 'Update device',
    description: `Change a device: enable/disable communication, rename, polling, connection settings (merged with the current ones).

Enabling a device starts real communication with the field equipment.
Renaming changes the "Device.Tag" references shown by the tools but not the bindings (they use tag ids).

Args:
  - device (string): name or id
  - name, enabled, polling_ms, connection (all optional)

Returns: the updated device.`,
    inputSchema: {
      device: DeviceRef,
      name: z.string().min(1).max(100).optional(),
      enabled: z.boolean().optional(),
      polling_ms: z.number().int().min(50).max(3600000).optional(),
      connection: ConnectionSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ device, name, enabled, polling_ms, connection }) => run(async () => {
    const d = await ctx.devices.updateDevice(device, { name, enabled, polling_ms, connection: connection as ConnectionInput | undefined });
    return ok(`Device **${d.name}** (${d.type}) ${d.enabled ? 'enabled' : 'disabled'}, polling ${d.polling} ms, connection ${JSON.stringify(maskProperty(d.property))}.`,
      { id: d.id, name: d.name, enabled: d.enabled, polling_ms: d.polling, connection: maskProperty(d.property) });
  }));

  server.registerTool('scadacraft_delete_device', {
    title: 'Delete device',
    description: `Delete a device and all its tags. Pages and alarms bound to its tags stop working; the result lists them.

Args:
  - device (string): name or id

Returns: the deleted device and the views/alarms that referenced its tags.`,
    inputSchema: { device: DeviceRef },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ device }) => run(async () => {
    const r = await ctx.devices.deleteDevice(device);
    return ok(`Deleted device **${r.device.name}** with ${Object.keys(r.device.tags ?? {}).length} tags.` +
      (r.references.length ? `\nStill referenced by: ${r.references.join(', ')}.` : ''), { id: r.device.id, references: r.references });
  }));

  server.registerTool('scadacraft_list_tags', {
    title: 'List tags',
    description: `List tags of all devices (or one), to find references for bindings, alarms and reads.

Args:
  - device (string, optional): only this device (name or id)
  - query (string, optional): case-insensitive filter on "Device.Tag" and address
  - limit (1-500, default 100), offset (default 0)

Returns: total and tags [{ref ("Device.Tag", use it in bindings), id, type, address, device type}].`,
    inputSchema: {
      device: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, device, limit, offset }) => run(async () => {
    const project = await ctx.client.getProject();
    let tags = allTags(project);
    if (device) tags = tags.filter((t) => t.device.toLowerCase() === device.toLowerCase() || t.deviceId === device);
    if (query) {
      const q = query.toLowerCase();
      tags = tags.filter((t) => t.ref.toLowerCase().includes(q) || (t.address ?? '').toLowerCase().includes(q));
    }
    const page = tags.slice(offset, offset + limit);
    const hasMore = tags.length > offset + page.length;
    const text = page.length
      ? [`${tags.length} tag(s)${hasMore ? `, showing ${offset + 1}-${offset + page.length}` : ''}:`,
        ...page.map((t) => `- \`${t.ref}\` (${t.type ?? '?'}${t.address ? `, ${t.address}` : ''}) [${t.deviceType}]`),
        ...(hasMore ? [`More: offset=${offset + page.length}`] : [])].join('\n')
      : 'No tags found.';
    return ok(text, { total: tags.length, count: page.length, offset, has_more: hasMore, tags: page });
  }));

  server.registerTool('scadacraft_add_tags', {
    title: 'Add tags',
    description: `Add tags (data points) to a device, in one save. Works for every driver and for "FUXA Server" memory tags.

Args:
  - device (string): name or id ("FUXA Server" for memory tags: simulation, setpoints, internal states)
  - tags (array, 1-500): each {name, address, type, ...options}

Examples:
  Modbus: {"name": "P101_Run", "address": "00001", "type": "Bool"}, {"name": "LT101", "address": "40001", "type": "Float32", "decimals": 2, "history": {"enabled": true}}
  S7:     {"name": "Level", "address": "DB1,REAL0", "type": "Real"}
  OPC UA: {"name": "Flow", "address": "ns=2;s=Plant.FT101", "type": "Double"}
  MQTT:   {"name": "Temp", "address": "site1/sensors", "json_key": "temp"}
  Server: {"name": "Setpoint", "type": "number", "init": "50"}

Returns: created tags with their "Device.Tag" reference.
${RELOAD_NOTE}`,
    inputSchema: {
      device: DeviceRef,
      tags: z.array(z.object({ name: z.string().min(1).max(100), ...TagFields }).strict()).min(1).max(500),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ device, tags }) => run(async () => {
    const r = await ctx.devices.addTags(device, tags as TagInput[]);
    return ok([`Added ${r.tags.length} tag(s) to **${r.device.name}**:`, ...r.tags.map((t) => tagLine(r.device, t))].join('\n'),
      { device: r.device.name, tags: r.tags.map((t) => ({ ref: `${r.device.name}.${t.name}`, id: t.id, type: t.type, address: t.address })) });
  }));

  server.registerTool('scadacraft_update_tags', {
    title: 'Update tags',
    description: `Change tags of a device: rename, address, type, scaling, decimals, history logging (DAQ), deadband.
Bindings keep working after a rename (they use tag ids).

Args:
  - device (string): name or id
  - tags (array, 1-500): each {tag: name or id, ...fields to change}. Example: {"tag": "LT101", "history": {"enabled": true, "interval_s": 10}}

Returns: updated tags.`,
    inputSchema: {
      device: DeviceRef,
      tags: z.array(z.object({ tag: z.string().min(1), name: z.string().min(1).max(100).optional(), ...TagFields }).strict()).min(1).max(500),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ device, tags }) => run(async () => {
    const r = await ctx.devices.updateTags(device, tags as (Partial<TagInput> & { tag: string })[]);
    return ok([`Updated ${r.tags.length} tag(s) on **${r.device.name}**:`, ...r.tags.map((t) => tagLine(r.device, t))].join('\n'),
      { device: r.device.name, tags: r.tags.map((t) => ({ ref: `${r.device.name}.${t.name}`, id: t.id })) });
  }));

  server.registerTool('scadacraft_delete_tags', {
    title: 'Delete tags',
    description: `Delete tags from a device. Views and alarms that use them are listed in the result.

Args:
  - device (string): name or id
  - tags (array of string): tag names or ids

Returns: removed tag names and references that still point to them.`,
    inputSchema: { device: DeviceRef, tags: z.array(z.string().min(1)).min(1).max(500) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ device, tags }) => run(async () => {
    const r = await ctx.devices.deleteTags(device, tags);
    return ok(`Removed from **${r.device.name}**: ${r.removed.join(', ')}.` + (r.references.length ? `\nStill referenced by: ${r.references.join(', ')}.` : ''),
      { device: r.device.name, removed: r.removed, references: r.references });
  }));

  server.registerTool('scadacraft_list_drivers', {
    title: 'List drivers',
    description: `List the optional driver packages of the ScadaCraft server (Modbus, S7, OPC UA, BACnet, EtherNet/IP, ...) and whether they are installed.
A device only communicates when its driver is installed. MQTT, WebAPI and server memory tags are built in.

Returns: drivers [{type, package, version, installed}].`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const plugins = await ctx.client.getPlugins();
    const drivers = plugins.map((p) => ({ type: p.type, package: p.name, version: p.version, installed: p.current || null, group: p.group }));
    return ok(drivers.map((d) => `- **${d.type}** (${d.package} ${d.version}): ${d.installed ? `installed ${d.installed}` : 'not installed'}`).join('\n'), { drivers });
  }));

  server.registerTool('scadacraft_install_driver', {
    title: 'Install driver',
    description: `Install a driver package on the ScadaCraft server (downloads it with npm; can take a few minutes and needs internet access on that server).

Args:
  - type (string): driver type from scadacraft_list_drivers, e.g. "Modbus", "SiemensS7", "OPCUA", "BACnet";
    "Chart" installs the packages that draw charts in PDF reports

Returns: confirmation. Devices of that type start communicating afterwards.`,
    inputSchema: { type: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ type }) => run(async () => {
    const plugins = await ctx.client.getPlugins();
    // a type can need several packages (e.g. "Chart" for report charts: chart.js + chartjs-node-canvas)
    const matches = plugins.filter((x) => x.type.toLowerCase() === type.toLowerCase() || x.name === type);
    if (!matches.length) throw new Error(`Unknown driver "${type}". Available: ${[...new Set(plugins.map((x) => x.type))].join(', ')}.`);
    const done: string[] = [];
    for (const p of matches) {
      if (p.current) { done.push(`${p.name} ${p.current} (already installed)`); continue; }
      await ctx.client.installPlugin(p);
      const after = (await ctx.client.getPlugins()).find((x) => x.name === p.name);
      if (!after?.current) throw new Error(`${p.name} was not installed (check the server log: npm needs internet access on the ScadaCraft server).`);
      done.push(`${p.name} ${after.current}`);
    }
    return ok(`${matches[0].type}: ${done.join(', ')}.`, { type: matches[0].type, installed: done });
  }));
}

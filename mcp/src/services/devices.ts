/**
 * Devices (connections to field equipment) and their tags.
 *
 * Device and tag records are built in the same shape as the ScadaCraft client
 * (client/src/app/_models/device.ts, device-map.component.ts, tag-property.service.ts),
 * so the device editor shows and edits them normally.
 */
import { ScadaCraftClient } from '../fuxa/client.js';
import { DEVICE_PREFIX, guid, SERVER_DEVICE_ID, TAG_PREFIX } from '../fuxa/ids.js';
import { allDevices } from '../fuxa/tags.js';
import type { Device, Project, Tag } from '../fuxa/types.js';

export const DEVICE_TYPES = [
  'ModbusTCP', 'ModbusRTU', 'SiemensS7', 'OPCUA', 'MQTTclient', 'BACnet', 'EthernetIP', 'OmronEthernetIP',
  'ADSclient', 'MELSEC', 'WebAPI', 'ODBC', 'REDIS', 'GPIO', 'WebCam', 'internal',
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** Device type -> driver plugin type (GET /api/plugins). MQTT, WebAPI, internal are built in. */
export const DRIVER_FOR_DEVICE: Record<string, string> = {
  ModbusTCP: 'Modbus', ModbusRTU: 'Modbus', SiemensS7: 'SiemensS7', OPCUA: 'OPCUA', BACnet: 'BACnet', EthernetIP: 'EthernetIP',
  OmronEthernetIP: 'OmronEthernetIP', ADSclient: 'ADSclient', ODBC: 'ODBC', GPIO: 'GPIO', WebCam: 'WebCam', MELSEC: 'MELSEC', REDIS: 'REDIS',
};

export const MODBUS_TYPES = ['Bool', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Float32', 'Float64', 'Int64', 'Int16LE', 'UInt16LE',
  'Int32LE', 'UInt32LE', 'Float32LE', 'Float64LE', 'Float64MLE', 'Int64LE', 'Float32MLE', 'Int32MLE', 'UInt32MLE'];
export const S7_TYPES = ['Bool', 'Byte', 'Int', 'Word', 'DInt', 'DWord', 'Real'];
export const OPCUA_TYPES = ['Boolean', 'SByte', 'Byte', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64', 'Float', 'Double',
  'String', 'DateTime', 'Guid', 'ByteString'];
export const SERVER_TYPES = ['number', 'boolean', 'string'];

/** Connection settings accepted by the tools; mapped onto device.property per driver. */
export interface ConnectionInput {
  host?: string;
  port?: number;
  address?: string;
  slave_id?: number;
  serial_port?: string;
  baudrate?: number;
  databits?: number;
  stopbits?: number;
  parity?: 'None' | 'Odd' | 'Even';
  modbus_mode?: 'TcpPort' | 'UdpPort' | 'TcpRTUBufferedPort' | 'TelnetPort' | 'SerialPort' | 'RTUBufferedPort' | 'AsciiPort';
  delay_ms?: number;
  force_fc16?: boolean;
  rack?: number;
  slot?: number;
  endpoint?: string;
  broker?: string;
  username?: string;
  password?: string;
  client_id?: string;
  security_mode?: string;
  timeout_ms?: number;
  /** extra raw fields copied as-is into device.property (advanced / other drivers) */
  extra?: Record<string, unknown>;
}

export interface TagInput {
  name: string;
  /** Modbus: "40001", "400001", "hr:1", "ir:12", "coil:5", "di:3". S7: "DB1,REAL0", "M0.0". OPC UA: node id. MQTT: topic. */
  address?: string;
  type?: string;
  /** MQTT json payload: key to extract */
  json_key?: string;
  divisor?: number;
  decimals?: number;
  description?: string;
  init?: string;
  /** historical logging (DAQ) */
  history?: { enabled: boolean; interval_s?: number; on_change?: boolean; restore?: boolean };
  scale?: { raw_low: number; raw_high: number; scaled_low: number; scaled_high: number };
  deadband?: number;
}

const MODBUS_AREAS: Record<string, string> = { coil: '000000', co: '000000', di: '100000', ir: '300000', hr: '400000' };

/** Parse a Modbus address into the client's memaddress / 1-based register. */
export function parseModbusAddress(input: string): { memaddress: string; address: string } {
  const s = input.trim().toLowerCase();
  const prefixed = s.match(/^(coil|co|di|ir|hr)\s*[:\s]?\s*(\d+)$/);
  if (prefixed) {
    const reg = Number(prefixed[2]);
    if (reg < 1 || reg > 65536) throw new Error(`Modbus register ${reg} out of range 1-65536.`);
    return { memaddress: MODBUS_AREAS[prefixed[1]], address: String(reg) };
  }
  const classic = s.match(/^([0134])(\d{4,5})$/);
  if (classic) {
    const reg = Number(classic[2]);
    if (reg < 1 || reg > 65536) throw new Error(`Modbus address ${input}: register ${reg} out of range.`);
    return { memaddress: `${classic[1]}00000`, address: String(reg) };
  }
  throw new Error(
    `Invalid Modbus address "${input}". Use the classic notation (00001 coil, 10001 input, 30001 input register, 40001 holding register; ` +
      'also 6 digits like 400001) or "hr:1", "ir:1", "coil:1", "di:1" (1-based).',
  );
}

export function modbusAddressLabel(tag: Tag): string | undefined {
  if (typeof tag.memaddress !== 'string' || typeof tag.address !== 'string') return undefined;
  const area = { '000000': 'coil', '100000': 'di', '300000': 'ir', '400000': 'hr' }[tag.memaddress];
  return area ? `${area}:${tag.address} (${Number(tag.memaddress) + Number(tag.address)})` : undefined;
}

function isModbus(type: string): boolean {
  return type === 'ModbusTCP' || type === 'ModbusRTU';
}

export class DevicesService {
  constructor(readonly client: ScadaCraftClient) {}

  findDevice(project: Project, ref: string): Device {
    const devices = allDevices(project);
    const d = devices.find((x) => x.id === ref) ?? devices.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!d) throw new Error(`Device "${ref}" not found. Devices: ${devices.map((x) => x.name).join(', ') || '(none)'}.`);
    // the server device template has no tags: the real one lives in devices['0']
    if (d.id === SERVER_DEVICE_ID) return this.serverDevice(project);
    return d;
  }

  /** Server memory-tag device (devices['0']), created from the project.server template if missing. */
  serverDevice(project: Project): Device {
    const existing = project.devices?.[SERVER_DEVICE_ID];
    const template = existing ?? project.server;
    if (!template) throw new Error('This project has no ScadaCraft server device.');
    const d = JSON.parse(JSON.stringify(template)) as Device;
    d.id = SERVER_DEVICE_ID;
    d.enabled = true;
    d.tags = d.tags ?? {};
    return d;
  }

  // ------------------------------------------------------------ devices
  buildProperty(type: string, c: ConnectionInput, base: Record<string, unknown> = {}): Record<string, unknown> {
    const p: Record<string, unknown> = { ...base };
    switch (type) {
      case 'ModbusTCP': {
        const host = c.host ?? (c.address?.split(':')[0]);
        const port = c.port ?? (c.address?.includes(':') ? Number(c.address.split(':')[1]) : undefined) ?? 502;
        if (host) p.address = `${host}:${port}`;
        if (c.slave_id !== undefined) p.slaveid = String(c.slave_id);
        p.connectionOption = c.modbus_mode ?? (p.connectionOption as string | undefined) ?? 'TcpPort';
        break;
      }
      case 'ModbusRTU': {
        if (c.serial_port ?? c.address) p.address = c.serial_port ?? c.address;
        if (c.slave_id !== undefined) p.slaveid = String(c.slave_id);
        if (c.baudrate !== undefined) p.baudrate = String(c.baudrate);
        if (c.databits !== undefined) p.databits = String(c.databits);
        if (c.stopbits !== undefined) p.stopbits = String(c.stopbits);
        if (c.parity) p.parity = c.parity;
        p.baudrate = p.baudrate ?? '9600';
        p.databits = p.databits ?? '8';
        p.stopbits = p.stopbits ?? '1';
        p.parity = p.parity ?? 'None';
        p.connectionOption = c.modbus_mode ?? (p.connectionOption as string | undefined) ?? 'SerialPort';
        break;
      }
      case 'SiemensS7':
        if (c.host ?? c.address) p.address = c.host ?? c.address;
        p.rack = c.rack ?? (p.rack as number | undefined) ?? 0;
        p.slot = c.slot ?? (p.slot as number | undefined) ?? 2;
        if (c.port !== undefined) p.port = c.port;
        break;
      case 'OPCUA':
        if (c.endpoint ?? c.address) p.address = c.endpoint ?? c.address;
        break;
      case 'MQTTclient':
        if (c.broker ?? c.address) p.address = c.broker ?? c.address;
        break;
      default:
        if (c.address ?? c.host) p.address = c.address ?? (c.port ? `${c.host}:${c.port}` : c.host);
        if (c.port !== undefined && type !== 'ModbusTCP') p.port = c.port;
        if (c.slave_id !== undefined) p.slaveid = String(c.slave_id);
    }
    if (isModbus(type)) {
      if (c.delay_ms !== undefined) p.delay = c.delay_ms;
      p.delay = p.delay ?? 10;
      if (c.force_fc16 !== undefined) p.forceFC16 = c.force_fc16;
    }
    if (c.timeout_ms !== undefined) p.timeout = c.timeout_ms;
    Object.assign(p, c.extra ?? {});
    return p;
  }

  private securityFor(type: string, c: ConnectionInput): Record<string, unknown> | undefined {
    if (!(c.username || c.password || c.client_id || c.security_mode)) return undefined;
    if (type === 'MQTTclient') return { clientId: c.client_id, uid: c.username, pwd: c.password };
    return { mode: c.security_mode, uid: c.username, pwd: c.password };
  }

  /** Returns a warning when the driver for this device type is not installed on the server. */
  async driverWarning(type: string): Promise<string | undefined> {
    const driver = DRIVER_FOR_DEVICE[type];
    if (!driver) return undefined;
    const plugins = await this.client.getPlugins().catch(() => []);
    const p = plugins.find((x) => x.type === driver);
    if (p && !p.current) {
      return `The ${driver} driver (${p.name}) is not installed on the ScadaCraft server: the device will not communicate until it is. ` +
        `Install it with scadacraft_install_driver {"type": "${driver}"}.`;
    }
    return undefined;
  }

  async createDevice(input: { name: string; type: DeviceType; enabled: boolean; polling_ms: number; connection: ConnectionInput }): Promise<Device> {
    const project = await this.client.getProject();
    if (allDevices(project).some((d) => d.name.toLowerCase() === input.name.toLowerCase())) {
      throw new Error(`A device named "${input.name}" already exists.`);
    }
    const device: Device = {
      id: guid(DEVICE_PREFIX),
      name: input.name,
      type: input.type,
      enabled: input.enabled,
      polling: input.polling_ms,
      property: this.buildProperty(input.type, input.connection, { delay: isModbus(input.type) ? 10 : undefined }),
      tags: {},
    };
    if (device.property && device.property.delay === undefined) delete device.property.delay;
    const security = this.securityFor(input.type, input.connection);
    if (security) await this.client.setDeviceSecurity(device.id, security);
    await this.client.saveDevice(device);
    await this.ensureConnectionStatusTag(device);
    return device;
  }

  async updateDevice(ref: string, changes: { name?: string; enabled?: boolean; polling_ms?: number; connection?: ConnectionInput }): Promise<Device> {
    const project = await this.client.getProject();
    const device = this.findDevice(project, ref);
    if (device.id === SERVER_DEVICE_ID) throw new Error('The ScadaCraft server device cannot be reconfigured; use it only for memory tags.');
    if (changes.name && changes.name !== device.name) {
      if (allDevices(project).some((d) => d.id !== device.id && d.name.toLowerCase() === changes.name!.toLowerCase())) {
        throw new Error(`A device named "${changes.name}" already exists.`);
      }
      device.name = changes.name;
    }
    if (changes.enabled !== undefined) device.enabled = changes.enabled;
    if (changes.polling_ms !== undefined) device.polling = changes.polling_ms;
    if (changes.connection) {
      device.property = this.buildProperty(device.type, changes.connection, device.property ?? {});
      const security = this.securityFor(device.type, changes.connection);
      if (security) await this.client.setDeviceSecurity(device.id, security);
    }
    await this.client.saveDevice(device);
    return device;
  }

  async deleteDevice(ref: string): Promise<{ device: Device; references: string[] }> {
    const project = await this.client.getProject();
    const device = this.findDevice(project, ref);
    if (device.id === SERVER_DEVICE_ID) throw new Error('The ScadaCraft server device cannot be deleted.');
    const tagIds = new Set(Object.keys(device.tags ?? {}));
    const references = this.findReferences(project, tagIds);
    await this.client.deleteDevice(device);
    await this.client.setDeviceSecurity(device.id, '');
    // remove its connection-status tag from the server device
    const server = this.serverDevice(project);
    const statusTags = Object.values(server.tags ?? {}).filter((t) => t.sysType === 1 && t.memaddress === device.id);
    if (statusTags.length) {
      for (const t of statusTags) delete server.tags![t.id];
      await this.client.saveDevice(server);
    }
    return { device, references };
  }

  /** Same system tag the client adds for every device ("<name> Connection Status"). */
  private async ensureConnectionStatusTag(device: Device): Promise<void> {
    const project = await this.client.getProject();
    const server = this.serverDevice(project);
    if (Object.values(server.tags ?? {}).some((t) => t.sysType === 1 && t.memaddress === device.id)) return;
    const id = guid(TAG_PREFIX);
    server.tags![id] = {
      id, name: `${device.name} Connection Status`, label: `${device.name} Connection Status`, type: 'number',
      memaddress: device.id, sysType: 1, init: '', value: '',
      daq: { enabled: false, changed: false, interval: 60, restored: false },
    };
    await this.client.saveDevice(server);
  }

  /**
   * Alarm status tags on the server device (sysType 2): kept up to date by ScadaCraft with the
   * number of alarms per level, active, unacknowledged and total. Bind them to OpenBridge alert widgets.
   */
  async ensureAlarmStatusTags(prefix = 'Alarms'): Promise<{ created: string[]; existing: string[] }> {
    const project = await this.client.getProject();
    const server = this.serverDevice(project);
    server.tags = server.tags ?? {};
    const kinds: [string, string][] = [
      ['active', 'Active'], ['unack', 'Unacknowledged'], ['highhigh', 'HighHigh'], ['high', 'High'],
      ['low', 'Low'], ['info', 'Info'], ['total', 'Total'],
    ];
    const created: string[] = [];
    const existing: string[] = [];
    for (const [key, label] of kinds) {
      const found = Object.values(server.tags).find((t) => t.sysType === 2 && t.memaddress === key);
      if (found) { existing.push(String(found.name)); continue; }
      const id = guid(TAG_PREFIX);
      const name = `${prefix} ${label}`;
      server.tags[id] = {
        id, name, label: name, type: 'number', memaddress: key, sysType: 2, init: '0', value: '0',
        daq: { enabled: false, changed: false, interval: 60, restored: false },
      };
      created.push(name);
    }
    if (created.length) await this.client.saveDevice(server);
    return { created, existing };
  }

  /** Views, alarms that reference any of the given tag ids. */
  findReferences(project: Project, tagIds: Set<string>): string[] {
    const refs: string[] = [];
    for (const v of project.hmi?.views ?? []) {
      const text = JSON.stringify(v.items ?? {});
      const used = [...tagIds].filter((id) => text.includes(`"${id}"`)).length;
      if (used) refs.push(`view "${v.name}" (${used} tag(s))`);
    }
    for (const a of project.alarms ?? []) {
      if (tagIds.has(a.property?.variableId)) refs.push(`alarm "${a.name}"`);
    }
    return refs;
  }

  // ------------------------------------------------------------ tags
  buildTag(device: Device, input: TagInput, base?: Tag): Tag {
    const tag: Tag = base ? { ...base } : {
      id: guid(TAG_PREFIX), name: input.name, label: input.name, type: undefined,
      daq: { enabled: false, changed: false, interval: 60, restored: false },
    };
    tag.name = input.name ?? tag.name;
    const type = device.type;
    if (isModbus(type)) {
      if (input.address !== undefined) Object.assign(tag, parseModbusAddress(input.address));
      if (input.type) tag.type = this.checkType(input.type, MODBUS_TYPES, 'Modbus');
      tag.type = tag.type ?? (tag.memaddress === '000000' || tag.memaddress === '100000' ? 'Bool' : 'Int16');
      if (input.divisor !== undefined) tag.divisor = input.divisor;
      tag.divisor = tag.divisor ?? 1;
    } else if (type === 'SiemensS7') {
      if (input.address !== undefined) tag.address = input.address.trim();
      if (input.type) tag.type = this.checkType(input.type, S7_TYPES, 'S7');
    } else if (type === 'OPCUA') {
      if (input.address !== undefined) tag.address = input.address.trim();
      if (input.type) tag.type = this.checkType(input.type, OPCUA_TYPES, 'OPC UA');
    } else if (type === 'MQTTclient') {
      if (input.address !== undefined) {
        tag.address = input.address;
        if (input.json_key) {
          tag.type = 'json';
          tag.memaddress = input.json_key;
          tag.options = { subs: [input.json_key] };
        } else {
          tag.type = 'raw';
          tag.memaddress = input.address;
          tag.options = { subs: input.address };
        }
      }
    } else if (type === 'FuxaServer' || device.id === SERVER_DEVICE_ID) {
      if (input.type) tag.type = this.checkType(input.type, SERVER_TYPES, 'server');
      tag.type = tag.type ?? 'number';
    } else {
      if (input.address !== undefined) tag.address = input.address;
      if (input.type) tag.type = input.type;
    }
    if (!tag.address && !['FuxaServer', 'internal'].includes(type) && device.id !== SERVER_DEVICE_ID) {
      throw new Error(`Tag "${tag.name}" on ${type} device "${device.name}" needs an address.`);
    }
    if (!tag.type && !['FuxaServer', 'internal'].includes(type)) {
      throw new Error(`Tag "${tag.name}" on ${type} device "${device.name}" needs a type.`);
    }
    if (input.decimals !== undefined) tag.format = input.decimals;
    if (input.description !== undefined) tag.description = input.description;
    if (input.init !== undefined) tag.init = input.init;
    if (input.history) {
      tag.daq = {
        enabled: input.history.enabled,
        interval: input.history.interval_s ?? 60,
        changed: input.history.on_change ?? true,
        restored: input.history.restore ?? false,
      };
    }
    if (input.scale) {
      tag.scale = {
        mode: 'linear', rawLow: input.scale.raw_low, rawHigh: input.scale.raw_high,
        scaledLow: input.scale.scaled_low, scaledHigh: input.scale.scaled_high,
      };
    }
    if (input.deadband !== undefined) tag.deadband = { value: input.deadband, mode: 'absolute' };
    return tag;
  }

  private checkType(t: string, allowed: string[], label: string): string {
    const found = allowed.find((x) => x.toLowerCase() === t.toLowerCase());
    if (!found) throw new Error(`Invalid ${label} tag type "${t}". Allowed: ${allowed.join(', ')}.`);
    return found;
  }

  async addTags(deviceRef: string, inputs: TagInput[]): Promise<{ device: Device; tags: Tag[] }> {
    const project = await this.client.getProject();
    const device = this.findDevice(project, deviceRef);
    device.tags = device.tags ?? {};
    const names = new Set(Object.values(device.tags).map((t) => t.name.toLowerCase()));
    const created: Tag[] = [];
    for (const input of inputs) {
      if (names.has(input.name.toLowerCase())) throw new Error(`Tag "${input.name}" already exists on device "${device.name}".`);
      const tag = this.buildTag(device, input);
      device.tags[tag.id] = tag;
      names.add(input.name.toLowerCase());
      created.push(tag);
    }
    await this.client.saveDevice(device);
    return { device, tags: created };
  }

  async updateTags(deviceRef: string, updates: (Partial<TagInput> & { tag: string })[]): Promise<{ device: Device; tags: Tag[] }> {
    const project = await this.client.getProject();
    const device = this.findDevice(project, deviceRef);
    const tags = Object.values(device.tags ?? {});
    const changed: Tag[] = [];
    for (const u of updates) {
      const t = tags.find((x) => x.id === u.tag) ?? tags.find((x) => x.name.toLowerCase() === u.tag.toLowerCase());
      if (!t) throw new Error(`Tag "${u.tag}" not found on device "${device.name}".`);
      if (u.name && u.name.toLowerCase() !== t.name.toLowerCase() && tags.some((x) => x.name.toLowerCase() === u.name!.toLowerCase())) {
        throw new Error(`Tag "${u.name}" already exists on device "${device.name}".`);
      }
      const updated = this.buildTag(device, { ...u, name: u.name ?? t.name } as TagInput, t);
      device.tags![t.id] = updated;
      changed.push(updated);
    }
    await this.client.saveDevice(device);
    return { device, tags: changed };
  }

  async deleteTags(deviceRef: string, refs: string[]): Promise<{ device: Device; removed: string[]; references: string[] }> {
    const project = await this.client.getProject();
    const device = this.findDevice(project, deviceRef);
    const tags = Object.values(device.tags ?? {});
    const ids = new Set<string>();
    for (const r of refs) {
      const t = tags.find((x) => x.id === r) ?? tags.find((x) => x.name.toLowerCase() === r.toLowerCase());
      if (!t) throw new Error(`Tag "${r}" not found on device "${device.name}".`);
      ids.add(t.id);
    }
    const references = this.findReferences(project, ids);
    const removed = [...ids].map((id) => device.tags![id].name);
    for (const id of ids) delete device.tags![id];
    await this.client.saveDevice(device);
    return { device, removed, references };
  }
}

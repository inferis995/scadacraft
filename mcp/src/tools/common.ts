import { z } from 'zod';
import { EVENT_ACTIONS, EVENT_TRIGGERS } from '../fuxa/interaction.js';
import type { ScadaCraftClient } from '../fuxa/client.js';
import type { AdminService } from '../services/admin.js';
import type { AlarmsService } from '../services/alarms.js';
import type { DevicesService } from '../services/devices.js';
import type { PagesService, PlacedItem } from '../services/pages.js';
import type { ProjectService } from '../services/project.js';

export const CHARACTER_LIMIT = 25000;

export interface Ctx {
  client: ScadaCraftClient;
  pages: PagesService;
  devices: DevicesService;
  alarms: AlarmsService;
  project: ProjectService;
  admin: AdminService;
}

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
};

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  if (text.length > CHARACTER_LIMIT) {
    text = `${text.slice(0, CHARACTER_LIMIT)}\n\n[truncated: narrow the request with filters, a smaller time range or pagination]`;
  }
  return { content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) };
}

export function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

export function itemLine(i: PlacedItem): string {
  const b = Object.entries(i.bindings).map(([k, v]) => `${k}=${v}`).join(', ');
  const extra = [...(i.events ?? []).map((e) => `on ${e}`), ...(i.animations ?? [])];
  return `- \`${i.id}\` ${i.widget}${i.name ? ` "${i.name}"` : ''} at node (${i.node.x}, ${i.node.y}), box ${i.box.width}x${i.box.height}${b ? ` — ${b}` : ''}`
    + (extra.length ? `\n    ${extra.join('\n    ')}` : '');
}

export const RELOAD_NOTE = 'If the editor is open, reload it to see the change (the editor keeps its own copy of the project until reloaded).';

export const ViewRef = z.string().min(1).describe('View name or id (see scadacraft_list_views).');
export const DeviceRef = z.string().min(1).describe('Device name or id (see scadacraft_list_devices). "FUXA Server" is the server memory-tag device.');

/** Time: ISO 8601, epoch ms, or relative like "-1h", "-30m", "-7d", "now". */
export const TimeSchema = z.union([z.string(), z.number()]).describe('ISO 8601 ("2026-10-14T08:00:00Z"), epoch ms, or relative: "now", "-15m", "-2h", "-7d".');

export function parseTime(t: string | number | undefined, fallback: number): number {
  if (t === undefined || t === '') return fallback;
  if (typeof t === 'number') return t;
  const s = t.trim().toLowerCase();
  if (s === 'now') return Date.now();
  const rel = s.match(/^-(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/);
  if (rel) {
    const mult = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 }[rel[2] as 's' | 'm' | 'h' | 'd' | 'w'];
    return Date.now() - Number(rel[1]) * mult;
  }
  if (/^\d{10,}$/.test(s)) return Number(s);
  const d = Date.parse(t);
  if (Number.isNaN(d)) throw new Error(`Invalid time "${t}". Use ISO 8601, epoch ms, or relative like "-2h".`);
  return d;
}

export const iso = (ms: number | undefined | null): string => (ms ? new Date(ms).toISOString() : '—');

// ------------------------------------------------------------------ click events (pages, header)
export const EventSchema = z.object({
  on: z.enum(EVENT_TRIGGERS).default('click').describe('Mouse trigger, default click'),
  action: z.enum(EVENT_ACTIONS),
  page: z.string().optional().describe('open_page / open_popup / open_card: page name or id'),
  tag: z.string().optional().describe('set_value / toggle_value: "Device.Tag" (default: the item\'s own tag, for value/button/shape)'),
  value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('set_value: value to write (or amount for add/remove)'),
  mode: z.enum(['set', 'add', 'remove']).optional().describe('set_value: write (default), add to or subtract from the current value'),
  bit: z.number().int().min(0).max(31).optional().describe('toggle_value: toggle only this bit'),
  script: z.string().optional().describe('run_script: script name or id (scadacraft_list_scripts)'),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('run_script: parameter values by name (tagid parameters take "Device.Tag")'),
  url: z.string().optional().describe('open_link: URL'),
  new_tab: z.boolean().optional(),
  x: z.number().optional().describe('open_card: left, px'),
  y: z.number().optional().describe('open_card: top, px'),
  relative_to: z.enum(['window', 'mouse']).optional().describe('open_card: position relative to the window (default) or the mouse'),
  single: z.boolean().optional().describe('open_card: close the other cards first'),
  hide_close: z.boolean().optional().describe('open_popup / open_card: no close button (put a button with action "close" on that page)'),
}).strict();
export const EVENT_HELP = `Each event: {on? (click|dblclick|mousedown|mouseup|mouseover|mouseout, default click), action, ...}
  action "open_page"    {page}                         navigate to another page
  action "open_popup"   {page, hide_close?}            modal popup showing that page
  action "open_card"    {page, x?, y?, relative_to?, single?, hide_close?}   floating, draggable window
  action "close"                                       close the popup/card this item is in
  action "set_value"    {tag?, value, mode? set|add|remove}   write a tag (e.g. setpoint +1, start command)
  action "toggle_value" {tag?, bit?}                   invert a boolean / one bit
  action "run_script"   {script, params?}              run a server/client script
  action "open_link"    {url, new_tab?}`;

import { z } from 'zod';
import type { ScadaCraftClient } from '../fuxa/client.js';
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
  return `- \`${i.id}\` ${i.widget}${i.name ? ` "${i.name}"` : ''} at node (${i.node.x}, ${i.node.y}), box ${i.box.width}x${i.box.height}${b ? ` — ${b}` : ''}`;
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

/** Alarm tools: definitions on tags, active alarms, acknowledge, history. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AlarmLevelName } from '../fuxa/types.js';
import { type LevelInput } from '../services/alarms.js';
import { iso, ok, parseTime, run, TimeSchema, type Ctx } from './common.js';

const LevelSchema = z.object({
  above: z.number().optional().describe('active when value >= above'),
  below: z.number().optional().describe('active when value <= below'),
  min: z.number().optional().describe('active when min <= value <= max (use for bands or digital states: min 1, max 1)'),
  max: z.number().optional(),
  text: z.string().min(1).max(200).describe('Alarm message shown to operators'),
  group: z.string().max(100).optional().describe('Group / area, e.g. "Sollevamento"'),
  delay_s: z.number().min(0).optional().describe('condition must last this long before the alarm is raised (default 0)'),
  check_s: z.number().min(1).optional().describe('evaluation period (default 1 s)'),
  ack: z.enum(['active', 'passive', 'float']).optional()
    .describe('active: must be acknowledged, also while active (default). passive: acknowledge after it returns. float: no acknowledge.'),
  bkcolor: z.string().optional(),
  color: z.string().optional(),
}).strict();

export function registerAlarmTools(server: McpServer, ctx: Ctx): void {
  server.registerTool('scadacraft_list_alarms', {
    title: 'List alarm definitions',
    description: `List the alarms defined in the project: tag, levels (highhigh, high, low, info) with thresholds, text, group, delay, ack mode.

Returns: alarms [{name, tag, levels}].`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const alarms = await ctx.alarms.list();
    const fmt = (min: number, max: number) => (max >= 1e12 ? `>= ${min}` : min <= -1e12 ? `<= ${max}` : `${min}..${max}`);
    const text = alarms.map((a) => `- **${a.name}** on \`${a.tag}\`: ` +
      Object.entries(a.levels).map(([n, l]) => `${n} ${fmt(l.min, l.max)} "${l.text}"${l.group ? ` [${l.group}]` : ''}${l.delay_s ? ` after ${l.delay_s}s` : ''}`).join('; ')).join('\n');
    return ok(text || 'No alarms defined.', { alarms });
  }));

  server.registerTool('scadacraft_set_alarm', {
    title: 'Create or replace alarm',
    description: `Define an alarm on a tag, or replace the alarm with the same name. Levels you do not give are left unchanged on an existing alarm.

Each level is active while the value is in its range: use "above" (value >= x), "below" (value <= x), or min/max.
Severity: highhigh (alarm) > high (warning) > low (caution) > info.

Args:
  - name (string): unique alarm name, e.g. "LT101 level"
  - tag (string): "Device.Tag", unique tag name or id
  - levels: e.g. {"highhigh": {"above": 95, "text": "T-101 level very high", "group": "Sollevamento"},
                  "low": {"below": 10, "text": "T-101 level low", "delay_s": 30}}
    Digital fault: {"highhigh": {"min": 1, "max": 1, "text": "P-101 thermal fault"}}

Returns: the alarm definition.`,
    inputSchema: {
      name: z.string().min(1).max(100),
      tag: z.string().min(1),
      levels: z.object({ highhigh: LevelSchema.optional(), high: LevelSchema.optional(), low: LevelSchema.optional(), info: LevelSchema.optional() }).strict(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ name, tag, levels }) => run(async () => {
    const a = await ctx.alarms.set({ name, tag, levels: levels as Partial<Record<AlarmLevelName, LevelInput>> });
    return ok(`Alarm **${a.name}** on \`${a.tag}\`: ${Object.keys(a.levels).join(', ')}.`, { alarm: a });
  }));

  server.registerTool('scadacraft_delete_alarm', {
    title: 'Delete alarm',
    description: `Delete an alarm definition by name.

Returns: confirmation.`,
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await ctx.alarms.remove(name);
    return ok(`Deleted alarm **${name}**.`, { name });
  }));

  server.registerTool('scadacraft_get_active_alarms', {
    title: 'Get active alarms',
    description: `Alarms currently active or waiting for acknowledge, from the running ScadaCraft server.

Args:
  - group (string, optional): only this group
  - unacknowledged_only (boolean, default false)

Returns: alarms [{alarm, level, status (N active, NF returned, NA acknowledged), text, group, ontime, value, toack}].`,
    inputSchema: { group: z.string().optional(), unacknowledged_only: z.boolean().default(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ group, unacknowledged_only }) => run(async () => {
    let rows = await ctx.alarms.active();
    if (group) rows = rows.filter((r) => (r.group ?? '').toLowerCase() === group.toLowerCase());
    if (unacknowledged_only) rows = rows.filter((r) => r.toack > 0);
    const status = (s: string) => ({ N: 'ACTIVE', NF: 'returned, to ack', NA: 'active, acknowledged' }[s] ?? s);
    const text = rows.map((r) => `- [${r.level}] **${r.alarm}** — ${r.text ?? ''}${r.group ? ` [${r.group}]` : ''}: ${status(r.status)} since ${iso(r.ontime)}` +
      `${r.value !== undefined ? `, value ${r.value}` : ''}${r.toack > 0 ? ' (to acknowledge)' : ''}`).join('\n');
    return ok(text || 'No active alarms.', { count: rows.length, alarms: rows });
  }));

  server.registerTool('scadacraft_ack_alarms', {
    title: 'Acknowledge alarms',
    description: `Acknowledge alarms on the running server, on behalf of the configured ScadaCraft user.
Only acknowledge when the user asked to: acknowledging is an operator decision.

Args:
  - name (string, optional): alarm name; omit to acknowledge all alarms
  - level (optional): highhigh | high | low | info, only this level of the alarm

Returns: number of alarms acknowledged. The runtime shows them as acknowledged at its next check (about 1 s).`,
    inputSchema: { name: z.string().optional(), level: z.enum(['highhigh', 'high', 'low', 'info']).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ name, level }) => run(async () => {
    const n = await ctx.alarms.ack(name, level);
    return ok(`Acknowledged ${n} alarm(s)${name ? ` for "${name}"` : ''}.`, { acknowledged: n });
  }));

  server.registerTool('scadacraft_get_alarm_history', {
    title: 'Get alarm history',
    description: `Alarm events recorded by the server in a time range (newest first).

Args:
  - from (time, default "-24h"), to (time, default "now"): ISO 8601, epoch ms or relative ("-2h", "-7d")
  - name (string, optional): only this alarm
  - limit (1-2000, default 200)

Returns: events [{name, level, text, group, ontime, offtime, acktime, userack, value}].`,
    inputSchema: {
      from: TimeSchema.optional(), to: TimeSchema.optional(),
      name: z.string().optional(),
      limit: z.number().int().min(1).max(2000).default(200),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ from, to, name, limit }) => run(async () => {
    const f = parseTime(from, Date.now() - 864e5);
    const t = parseTime(to, Date.now());
    let rows = await ctx.alarms.history(f, t);
    if (name) rows = rows.filter((r) => r.name === name);
    const total = rows.length;
    rows = rows.slice(0, limit);
    const text = rows.map((r) => `- ${iso(r.ontime)} [${r.level}] **${r.name}** ${r.text ?? ''}${r.group ? ` [${r.group}]` : ''}` +
      `${r.offtime ? `, off ${iso(r.offtime)}` : ''}${r.acktime ? `, ack ${iso(r.acktime)}${r.userack ? ` by ${r.userack}` : ''}` : ''}`).join('\n');
    return ok(`${total} event(s) between ${iso(f)} and ${iso(t)}${total > rows.length ? `, showing ${rows.length}` : ''}.\n${text}`,
      { total, from: f, to: t, events: rows });
  }));
}

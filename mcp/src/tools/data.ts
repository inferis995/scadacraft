/** Live and historical data tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveTag } from '../fuxa/tags.js';
import { writeCsv } from '../services/project.js';
import { iso, ok, parseTime, run, TimeSchema, type Ctx } from './common.js';

export function registerDataTools(server: McpServer, ctx: Ctx): void {
  server.registerTool('scadacraft_read_tags', {
    title: 'Read tag values',
    description: `Read the current values of tags from the running ScadaCraft server.

Args:
  - tags (array of string, 1-200): "Device.Tag", unique tag name, or tag id

Returns: values [{ref, id, value, timestamp}] (null value = no value yet or device not connected).`,
    inputSchema: { tags: z.array(z.string().min(1)).min(1).max(200) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ tags }) => run(async () => {
    const project = await ctx.client.getProject();
    const refs = tags.map((t) => resolveTag(project, t));
    const values = await ctx.client.getTagValues(refs.map((r) => r.id));
    const out = refs.map((r) => {
      const v = values.find((x) => x.id === r.id);
      return { ref: r.ref, id: r.id, value: v?.value ?? null, timestamp: v?.timestamp ?? null };
    });
    return ok(out.map((o) => `- \`${o.ref}\` = ${JSON.stringify(o.value)}${o.timestamp ? ` (${iso(o.timestamp)})` : ''}`).join('\n'), { values: out });
  }));

  server.registerTool('scadacraft_write_tags', {
    title: 'Write tag values',
    description: `Write values to tags on the running ScadaCraft server.

WARNING: values of device tags are sent to the field devices (PLC, RTU, controllers) and can start, stop or move real equipment.
Only write when the user explicitly asked for these values. Server memory tags ("FUXA Server.*") are safe for simulation.

Args:
  - values (array, 1-100): each {tag, value: number | boolean | string}

Returns: written references.`,
    inputSchema: {
      values: z.array(z.object({ tag: z.string().min(1), value: z.union([z.number(), z.boolean(), z.string()]) }).strict()).min(1).max(100),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ values }) => run(async () => {
    const project = await ctx.client.getProject();
    const resolved = values.map((v) => ({ ref: resolveTag(project, v.tag), value: v.value }));
    await ctx.client.setTagValues(resolved.map((r) => ({ id: r.ref.id, value: r.value })));
    return ok(`Wrote ${resolved.length} tag(s): ${resolved.map((r) => `\`${r.ref.ref}\` = ${JSON.stringify(r.value)}`).join(', ')}.`,
      { written: resolved.map((r) => ({ ref: r.ref.ref, id: r.ref.id, value: r.value })) });
  }));

  server.registerTool('scadacraft_get_history', {
    title: 'Get tag history',
    description: `Historical values of tags (tags need history/DAQ enabled: scadacraft_update_tags {history: {enabled: true}}).
Returns statistics per tag and, optionally, the points or a CSV file.

Args:
  - tags (array, 1-20): "Device.Tag", name or id
  - from (time, default "-1h"), to (time, default "now"): ISO 8601, epoch ms or relative ("-15m", "-24h", "-7d")
  - points (boolean, default false): include the raw points in the result (capped at max_points per tag)
  - max_points (default 500)
  - csv_path (string, optional): also write all points to this CSV file (path on the machine running the MCP server)

Returns: per tag {ref, count, first, last, min, max, avg (numeric), points?}; csv path if written.`,
    inputSchema: {
      tags: z.array(z.string().min(1)).min(1).max(20),
      from: TimeSchema.optional(), to: TimeSchema.optional(),
      points: z.boolean().default(false),
      max_points: z.number().int().min(1).max(10000).default(500),
      csv_path: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ tags, from, to, points, max_points, csv_path }) => run(async () => {
    const f = parseTime(from, Date.now() - 36e5);
    const t = parseTime(to, Date.now());
    if (f >= t) throw new Error('"from" must be before "to".');
    const series = await ctx.project.history(tags, f, t);
    const stats = series.map((s) => {
      const nums = s.points.map((p) => Number(p.v)).filter((n) => Number.isFinite(n));
      const step = Math.max(1, Math.ceil(s.points.length / max_points));
      return {
        ref: s.ref, count: s.points.length,
        first: s.points[0] ? { t: s.points[0].t, v: s.points[0].v } : null,
        last: s.points.length ? { t: s.points[s.points.length - 1].t, v: s.points[s.points.length - 1].v } : null,
        min: nums.length ? Math.min(...nums) : null,
        max: nums.length ? Math.max(...nums) : null,
        avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
        ...(points ? { points: s.points.filter((_, i) => i % step === 0), downsampled: step > 1 } : {}),
      };
    });
    const csv = csv_path ? writeCsv(csv_path, series) : undefined;
    const fmt = (n: number | null) => (n === null ? '—' : Number(n.toFixed(4)));
    const text = [`History ${iso(f)} → ${iso(t)}:`,
      ...stats.map((s) => `- \`${s.ref}\`: ${s.count} points, min ${fmt(s.min)}, max ${fmt(s.max)}, avg ${fmt(s.avg)}, last ${s.last ? `${JSON.stringify(s.last.v)} at ${iso(s.last.t)}` : '—'}`),
      ...(csv ? [`CSV written to ${csv}`] : [])].join('\n');
    return ok(text, { from: f, to: t, series: stats, ...(csv ? { csv } : {}) });
  }));
}

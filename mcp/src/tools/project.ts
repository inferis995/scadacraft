/** Whole-project tools: summary, export, import. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ok, RELOAD_NOTE, run, type Ctx } from './common.js';
import type { ProjectSummary } from '../services/project.js';

function summaryText(s: ProjectSummary): string {
  return [
    `Views (${s.views.length}): ${s.views.map((v) => `${v.name} [${v.items}]`).join(', ') || '—'}`,
    `Devices (${s.devices.length}): ${s.devices.map((d) => `${d.name} (${d.type}, ${d.tags} tags${d.enabled ? '' : ', disabled'})`).join(', ') || '—'}`,
    `Alarms: ${s.alarms}, scripts: ${s.scripts}`,
    ...(Object.keys(s.other).length ? [`Other: ${Object.entries(s.other).map(([k, v]) => `${k} ${v}`).join(', ')}`] : []),
  ].join('\n');
}

export function registerProjectTools(server: McpServer, ctx: Ctx): void {
  server.registerTool('scadacraft_get_project_summary', {
    title: 'Project summary',
    description: `Overview of the whole project: views with item counts, devices with type and tag counts, alarms, scripts and other sections.
Start here to understand an existing project.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const s = await ctx.project.summary();
    return ok(summaryText(s), { ...s });
  }));

  server.registerTool('scadacraft_export_project', {
    title: 'Export project',
    description: `Save the whole project to a JSON file (same format as "Save Project As" in the editor; opens there with "Open Project").
Device credentials (OPC UA / MQTT passwords) are not part of the project file.

Args:
  - path (string): file path on the machine running the MCP server, e.g. "backups/plant-2026-10-14.json"

Returns: absolute path, size and a summary of the content.`,
    inputSchema: { path: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ path }) => run(async () => {
    const r = await ctx.project.exportTo(path);
    return ok(`Exported to ${r.path} (${(r.bytes / 1024).toFixed(1)} KB).\n${summaryText(r.summary)}`, { path: r.path, bytes: r.bytes, summary: r.summary });
  }));

  server.registerTool('scadacraft_import_project', {
    title: 'Import project',
    description: `Import a project file (exported by this tool or by the editor's "Save Project As").

Modes:
  - "merge" (default, safe): copy selected views, devices and alarms into the current project. Existing items with the same name are
    skipped unless overwrite=true. Server memory tags used by the imported views/alarms are copied too.
  - "replace": replace the WHOLE current project with the file. A backup of the current project is written first (backup_path).
    The runtime restarts all devices. Only when the user explicitly asked to replace the project.

Args:
  - path (string): project file to import
  - mode: merge | replace
  - views, devices, alarms (merge): list of names, or "all". Include the devices when importing views from another project,
    otherwise their bindings point to tags that do not exist here.
  - overwrite (boolean, default false): merge replaces items with the same name
  - backup_path (string, replace): where to save the current project first (default "scadacraft-backup-<time>.json")

Returns: what was added, replaced or skipped (merge) or the backup path (replace).
${RELOAD_NOTE}`,
    inputSchema: {
      path: z.string().min(1),
      mode: z.enum(['merge', 'replace']).default('merge'),
      views: z.union([z.literal('all'), z.array(z.string())]).optional(),
      devices: z.union([z.literal('all'), z.array(z.string())]).optional(),
      alarms: z.union([z.literal('all'), z.array(z.string())]).optional(),
      overwrite: z.boolean().default(false),
      backup_path: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ path, mode, views, devices, alarms, overwrite, backup_path }) => run(async () => {
    if (mode === 'replace') {
      const backup = backup_path ?? `scadacraft-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const r = await ctx.project.replaceFrom(path, backup);
      return ok(`Project replaced with ${path}. Previous project saved to ${r.backup}.\n${summaryText(r.summary)}\n\n${RELOAD_NOTE}`,
        { backup: r.backup, summary: r.summary });
    }
    if (!views && !devices && !alarms) {
      throw new Error('Merge needs something to import: give views, devices and/or alarms (names or "all").');
    }
    const r = await ctx.project.mergeFrom(path, { views, devices, alarms, overwrite });
    const lines = [
      r.added.length ? `Added: ${r.added.join(', ')}.` : 'Nothing added.',
      ...(r.replaced.length ? [`Replaced: ${r.replaced.join(', ')}.`] : []),
      ...(r.skipped.length ? [`Skipped: ${r.skipped.join('; ')}.`] : []),
      '', RELOAD_NOTE,
    ];
    return ok(lines.join('\n'), { ...r });
  }));
}

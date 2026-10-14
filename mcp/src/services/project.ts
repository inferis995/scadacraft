/**
 * Whole-project operations: summary, export to file, import (replace or merge), tag history.
 *
 * The project file is the same JSON written by the editor's "Save Project As"
 * (GET /api/project without runtime tag values), so files move freely between the
 * editor and the MCP server.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ScadaCraftClient } from '../fuxa/client.js';
import { allDevices, allTags, resolveTag } from '../fuxa/tags.js';
import { SERVER_DEVICE_ID } from '../fuxa/ids.js';
import type { AlarmDefinition, Device, Project, View } from '../fuxa/types.js';

export interface ProjectSummary {
  views: { name: string; items: number }[];
  devices: { name: string; type: string; tags: number; enabled: boolean }[];
  alarms: number;
  scripts: number;
  other: Record<string, number>;
}

function count(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v ? 1 : 0;
}

export function summarize(project: Project): ProjectSummary {
  const known = new Set(['hmi', 'devices', 'alarms', 'scripts', 'server', 'version']);
  const other: Record<string, number> = {};
  for (const [k, v] of Object.entries(project)) if (!known.has(k)) other[k] = count(v);
  return {
    views: (project.hmi?.views ?? []).map((v) => ({ name: v.name, items: Object.keys(v.items ?? {}).length })),
    devices: allDevices(project).map((d) => {
      const real = d.id === SERVER_DEVICE_ID ? project.devices?.[SERVER_DEVICE_ID] ?? d : d;
      return { name: real.name, type: real.type, tags: count(real.tags), enabled: real.enabled !== false };
    }),
    alarms: count(project.alarms),
    scripts: count(project.scripts),
    other,
  };
}

/** Same cleaning as the editor's convertToSave(): runtime tag values are not saved. */
export function cleanForSave(project: Project): Project {
  const p = JSON.parse(JSON.stringify(project)) as Project;
  for (const d of Object.values(p.devices ?? {})) {
    for (const t of Object.values(d.tags ?? {})) {
      delete (t as Record<string, unknown>).value;
      delete (t as Record<string, unknown>).timestamp;
    }
  }
  return p;
}

function readProjectFile(path: string): Project {
  let text: string;
  try {
    text = readFileSync(resolve(path), 'utf8');
  } catch (err) {
    throw new Error(`Cannot read "${path}": ${err instanceof Error ? err.message : String(err)}`);
  }
  let p: Project;
  try {
    p = JSON.parse(text) as Project;
  } catch {
    throw new Error(`"${path}" is not valid JSON. Expected a ScadaCraft/FUXA project file (.json or .fuxap).`);
  }
  if (!p || typeof p !== 'object' || (!p.hmi && !p.devices)) {
    throw new Error(`"${path}" does not look like a ScadaCraft/FUXA project (no "hmi" or "devices").`);
  }
  return p;
}

export interface MergeSelection {
  views?: string[] | 'all';
  devices?: string[] | 'all';
  alarms?: string[] | 'all';
  overwrite?: boolean;
}

export interface MergeResult {
  added: string[];
  replaced: string[];
  skipped: string[];
}

export class ProjectService {
  constructor(readonly client: ScadaCraftClient) {}

  async summary(): Promise<ProjectSummary> {
    return summarize(await this.client.getProject());
  }

  async exportTo(path: string): Promise<{ path: string; bytes: number; summary: ProjectSummary }> {
    const project = cleanForSave(await this.client.getProject());
    const full = resolve(path);
    mkdirSync(dirname(full), { recursive: true });
    const text = JSON.stringify(project, null, 2);
    writeFileSync(full, text, 'utf8');
    return { path: full, bytes: Buffer.byteLength(text), summary: summarize(project) };
  }

  /** Replace the whole project with a file. Writes a backup of the current project first. */
  async replaceFrom(path: string, backupPath: string): Promise<{ backup: string; summary: ProjectSummary }> {
    const incoming = readProjectFile(path);
    const backup = await this.exportTo(backupPath);
    await this.client.replaceProject(incoming);
    return { backup: backup.path, summary: summarize(incoming) };
  }

  /** Copy selected views, devices and alarms from a project file into the current project. */
  async mergeFrom(path: string, sel: MergeSelection): Promise<MergeResult> {
    const incoming = readProjectFile(path);
    const current = await this.client.getProject();
    const res: MergeResult = { added: [], replaced: [], skipped: [] };
    const pick = <T extends { name: string }>(list: T[], wanted: string[] | 'all' | undefined): T[] => {
      if (!wanted) return [];
      if (wanted === 'all') return list;
      const missing = wanted.filter((w) => !list.some((x) => x.name.toLowerCase() === w.toLowerCase()));
      if (missing.length) throw new Error(`Not found in "${path}": ${missing.join(', ')}.`);
      return list.filter((x) => wanted.some((w) => w.toLowerCase() === x.name.toLowerCase()));
    };

    // devices first: views and alarms reference their tag ids
    const devices = pick(Object.values(incoming.devices ?? {}).filter((d) => d.id !== SERVER_DEVICE_ID), sel.devices);
    for (const d of devices) {
      const existing = Object.values(current.devices ?? {}).find((x) => x.name.toLowerCase() === d.name.toLowerCase());
      if (existing && !sel.overwrite) { res.skipped.push(`device "${d.name}" (exists)`); continue; }
      const device: Device = { ...JSON.parse(JSON.stringify(d)), id: existing?.id ?? d.id };
      for (const t of Object.values(device.tags ?? {})) delete (t as Record<string, unknown>).value;
      await this.client.saveDevice(device);
      (existing ? res.replaced : res.added).push(`device "${d.name}"`);
    }
    // server memory tags referenced by the selected views/alarms
    const incomingServer = incoming.devices?.[SERVER_DEVICE_ID];

    const views = pick(incoming.hmi?.views ?? [], sel.views);
    const alarms = pick(incoming.alarms ?? [], sel.alarms);
    if (incomingServer && (views.length || alarms.length)) {
      const used = new Set<string>();
      const text = JSON.stringify(views) + JSON.stringify(alarms);
      for (const id of Object.keys(incomingServer.tags ?? {})) if (text.includes(`"${id}"`)) used.add(id);
      if (used.size) {
        const fresh = await this.client.getProject();
        const server = JSON.parse(JSON.stringify(fresh.devices?.[SERVER_DEVICE_ID] ?? fresh.server ?? { id: SERVER_DEVICE_ID, name: 'FUXA Server', type: 'FuxaServer' })) as Device;
        server.id = SERVER_DEVICE_ID;
        server.tags = server.tags ?? {};
        let addedTags = 0;
        for (const id of used) {
          if (!server.tags[id]) { server.tags[id] = { ...incomingServer.tags![id] }; delete server.tags[id].value; addedTags++; }
        }
        if (addedTags) { await this.client.saveDevice(server); res.added.push(`${addedTags} server tag(s)`); }
      }
    }

    for (const v of views) {
      const existing = (current.hmi?.views ?? []).find((x) => x.name.toLowerCase() === v.name.toLowerCase());
      if (existing && !sel.overwrite) { res.skipped.push(`view "${v.name}" (exists)`); continue; }
      const view: View = { ...JSON.parse(JSON.stringify(v)), id: existing?.id ?? v.id };
      if (!existing && (current.hmi?.views ?? []).some((x) => x.id === view.id)) view.id = `${view.id}_${Date.now().toString(36)}`;
      await this.client.saveView(view);
      (existing ? res.replaced : res.added).push(`view "${v.name}"`);
    }
    for (const a of alarms) {
      const existing = (current.alarms ?? []).find((x) => x.name === a.name);
      if (existing && !sel.overwrite) { res.skipped.push(`alarm "${a.name}" (exists)`); continue; }
      await this.client.saveAlarm(JSON.parse(JSON.stringify(a)) as AlarmDefinition);
      (existing ? res.replaced : res.added).push(`alarm "${a.name}"`);
    }

    // warn about references to tags that do not exist after the merge
    const after = await this.client.getProject();
    const known = new Set(allTags(after).map((t) => t.id));
    const text = JSON.stringify(views) + JSON.stringify(alarms);
    const dangling = [...text.matchAll(/"(t_[0-9a-f]{8}-[0-9a-f]{8})"/g)].map((m) => m[1]).filter((id) => !known.has(id));
    if (dangling.length) {
      res.skipped.push(`${new Set(dangling).size} tag reference(s) point to tags not in this project: import the devices too (devices: "all")`);
    }
    return res;
  }

  // ------------------------------------------------------------ history
  async history(tagRefs: string[], from: number, to: number): Promise<{ ref: string; id: string; points: { t: number; v: unknown }[] }[]> {
    const project = await this.client.getProject();
    const tags = tagRefs.map((r) => resolveTag(project, r));
    const noDaq = tags.filter((t) => {
      const d = project.devices?.[t.deviceId];
      const tag = d?.tags?.[t.id] as { daq?: { enabled?: boolean } } | undefined;
      return !tag?.daq?.enabled;
    });
    const data = await this.client.getHistory(tags.map((t) => t.id), from, to);
    const out = tags.map((t, i) => ({
      ref: t.ref, id: t.id,
      points: (data[i] ?? []).map((p) => ({ t: p.dt, v: p.value })),
    }));
    if (noDaq.length && out.every((o) => !o.points.length)) {
      throw new Error(`No history: logging (DAQ) is not enabled on ${noDaq.map((t) => t.ref).join(', ')}. ` +
        'Enable it with scadacraft_update_tags (history: {enabled: true}).');
    }
    return out;
  }
}

export function writeCsv(path: string, series: { ref: string; points: { t: number; v: unknown }[] }[]): string {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  const lines = ['timestamp,iso_time,tag,value'];
  for (const s of series) {
    for (const p of s.points) lines.push(`${p.t},${new Date(p.t).toISOString()},"${s.ref.replace(/"/g, '""')}",${JSON.stringify(p.v ?? '')}`);
  }
  writeFileSync(full, lines.join('\n') + '\n', 'utf8');
  return full;
}

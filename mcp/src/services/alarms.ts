/**
 * Alarm definitions (project) and alarm runtime (active alarms, acknowledge, history).
 *
 * A ScadaCraft alarm is attached to one tag and has up to four levels:
 * highhigh, high, low, info. Each level is active while the tag value is within [min, max]
 * for at least `timedelay` seconds; it is evaluated every `checkdelay` seconds.
 */
import { ScadaCraftClient, type ActiveAlarm, type AlarmHistoryRow } from '../fuxa/client.js';
import { allTags, resolveTag } from '../fuxa/tags.js';
import type { AlarmDefinition, AlarmLevel, AlarmLevelName, Project } from '../fuxa/types.js';

export const ALARM_LEVELS: AlarmLevelName[] = ['highhigh', 'high', 'low', 'info'];
/** Stored values are the client enum keys, which the server runtime compares against. */
export const ACK_MODES = { float: 'float', active: 'ackactive', passive: 'ackpassive' } as const;
export const ID_SEPARATOR = '^~^';

/** Default colours per level: same as the ScadaCraft alarm editor. */
const DEFAULT_COLORS: Record<AlarmLevelName, { bkcolor: string; color: string }> = {
  highhigh: { bkcolor: '#FF4848', color: '#FFF' },
  high: { bkcolor: '#F9CF59', color: '#000' },
  low: { bkcolor: '#E5E5E5', color: '#000' },
  info: { bkcolor: '#22A7F2', color: '#FFF' },
};

export interface LevelInput {
  /** active when min <= value <= max; use "above" / "below" shortcuts instead if easier */
  min?: number;
  max?: number;
  above?: number;
  below?: number;
  text: string;
  group?: string;
  delay_s?: number;
  check_s?: number;
  ack?: keyof typeof ACK_MODES;
  bkcolor?: string;
  color?: string;
}

const BIG = 1e12;

function buildLevel(name: AlarmLevelName, l: LevelInput): AlarmLevel {
  let min = l.min;
  let max = l.max;
  if (l.above !== undefined) { min = l.above; max = max ?? BIG; }
  if (l.below !== undefined) { max = l.below; min = min ?? -BIG; }
  if (min === undefined || max === undefined) {
    throw new Error(`Alarm level "${name}": give min and max, or "above" / "below".`);
  }
  if (min > max) throw new Error(`Alarm level "${name}": min (${min}) is greater than max (${max}).`);
  return {
    enabled: true,
    checkdelay: l.check_s ?? 1,
    min,
    max,
    timedelay: l.delay_s ?? 0,
    text: l.text,
    group: l.group ?? '',
    ackmode: ACK_MODES[l.ack ?? 'active'],
    bkcolor: l.bkcolor ?? DEFAULT_COLORS[name].bkcolor,
    color: l.color ?? DEFAULT_COLORS[name].color,
  };
}

export interface AlarmSummary {
  name: string;
  tag: string;
  levels: Record<string, { min: number; max: number; text: string; group: string; delay_s: number; ack: string }>;
}

export class AlarmsService {
  constructor(readonly client: ScadaCraftClient) {}

  summarize(project: Project, a: AlarmDefinition): AlarmSummary {
    const tags = new Map(allTags(project).map((t) => [t.id, t.ref]));
    const levels: AlarmSummary['levels'] = {};
    for (const n of ALARM_LEVELS) {
      const l = a[n];
      if (l?.enabled) {
        const ack = Object.entries(ACK_MODES).find(([, v]) => v === l.ackmode)?.[0] ?? l.ackmode;
        levels[n] = { min: l.min, max: l.max, text: l.text, group: l.group, delay_s: l.timedelay, ack };
      }
    }
    return { name: a.name, tag: tags.get(a.property?.variableId) ?? a.property?.variableId, levels };
  }

  async list(): Promise<AlarmSummary[]> {
    const project = await this.client.getProject();
    return (project.alarms ?? []).map((a) => this.summarize(project, a));
  }

  /** Create or replace an alarm definition. */
  async set(input: { name: string; tag: string; levels: Partial<Record<AlarmLevelName, LevelInput>> }): Promise<AlarmSummary> {
    const project = await this.client.getProject();
    const tag = resolveTag(project, input.tag);
    const defined = Object.entries(input.levels).filter(([, v]) => v);
    if (!defined.length) throw new Error('Give at least one level: highhigh, high, low or info.');
    const existing = (project.alarms ?? []).find((a) => a.name === input.name);
    const alarm: AlarmDefinition = {
      ...(existing ?? {}),
      name: input.name,
      property: { ...(existing?.property ?? {}), variableId: tag.id },
    };
    for (const n of ALARM_LEVELS) {
      const l = input.levels[n];
      if (l) alarm[n] = buildLevel(n, l);
      else if (!existing) alarm[n] = undefined;
    }
    for (const n of ALARM_LEVELS) if (alarm[n] === undefined) delete alarm[n];
    if (!alarm.actions) alarm.actions = { enabled: false, values: [] };
    await this.client.saveAlarm(alarm);
    return this.summarize(project, alarm);
  }

  async remove(name: string): Promise<void> {
    const project = await this.client.getProject();
    const alarm = (project.alarms ?? []).find((a) => a.name === name);
    if (!alarm) {
      throw new Error(`Alarm "${name}" not found. Alarms: ${(project.alarms ?? []).map((a) => a.name).join(', ') || '(none)'}.`);
    }
    await this.client.deleteAlarm(alarm);
  }

  async active(): Promise<(ActiveAlarm & { alarm: string; level: string })[]> {
    const rows = await this.client.getActiveAlarms();
    return rows.map((r) => {
      const [alarm, level] = r.name.split(ID_SEPARATOR);
      return { ...r, alarm, level: level ?? r.type };
    });
  }

  /** Acknowledge by alarm name (all its levels), by id "name^~^level", or all (undefined). */
  async ack(name?: string, level?: string): Promise<number> {
    if (!name) {
      const before = (await this.active()).filter((a) => a.toack > 0).length;
      await this.client.ackAlarm(null);
      return before;
    }
    const active = (await this.active()).filter((a) => a.alarm === name && (!level || a.level === level) && a.toack > 0);
    for (const a of active) await this.client.ackAlarm(a.name);
    return active.length;
  }

  async history(from: number, to: number): Promise<(AlarmHistoryRow & { level: string })[]> {
    const rows = await this.client.getAlarmsHistory(from, to);
    return rows.map((r) => ({ ...r, level: r.type }));
  }
}

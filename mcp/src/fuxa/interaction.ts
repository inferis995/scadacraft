/**
 * Interaction on pages, in the format the editor stores:
 *  - events (click → open page / popup / card, write a tag, run a script, open a link)
 *    stored in item.property.events as { type, action, actparam, actoptions } with enum KEYS
 *    (GaugeEventType / GaugeEventActionType in client/src/app/_models/hmi.ts);
 *  - shape animations (colour by value, blink, hide/show, rotate, spin, move)
 *    stored in item.property.ranges / item.property.actions of an "svg-ext-shapes-<tag>" item;
 *  - native controls: value display (svg-ext-value) and button (svg-ext-html_button).
 */
import { DOMParser, XMLSerializer, type Element as XElement } from '@xmldom/xmldom';
import { resolveTag } from './tags.js';
import { shortGuid } from './view.js';
import type { GaugeSettings, Project, View } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ------------------------------------------------------------------ events
export const EVENT_TRIGGERS = ['click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout'] as const;
export const EVENT_ACTIONS = ['open_page', 'open_popup', 'open_card', 'close', 'set_value', 'toggle_value', 'run_script', 'open_link'] as const;

export interface EventSpec {
  on?: typeof EVENT_TRIGGERS[number];
  action: typeof EVENT_ACTIONS[number];
  /** open_page / open_popup / open_card: page name or id */
  page?: string;
  /** set_value / toggle_value: tag "Device.Tag" (default for set/toggle on native controls: the item's own tag) */
  tag?: string;
  /** set_value: value to write, or amount to add/remove */
  value?: string | number | boolean;
  /** set_value: write the value (set), or add / subtract it from the current value */
  mode?: 'set' | 'add' | 'remove';
  /** toggle_value: toggle one bit of the tag (0-31) instead of the whole value */
  bit?: number;
  /** run_script: script name or id */
  script?: string;
  /** run_script: parameter values by name */
  params?: Record<string, string | number | boolean>;
  /** open_link: URL */
  url?: string;
  /** open_link: new browser tab (default true) */
  new_tab?: boolean;
  /** open_card: position in px */
  x?: number;
  y?: number;
  /** open_card: position relative to the window (default) or to the mouse */
  relative_to?: 'window' | 'mouse';
  /** open_card: close other cards first */
  single?: boolean;
  /** open_popup / open_card: hide the close button */
  hide_close?: boolean;
}

export interface GaugeEvent { type: string; action: string; actparam: string; actoptions: Record<string, unknown> }

interface ScriptRec { id: string; name: string; parameters?: { name: string; type: string; value?: unknown }[] }

function findPage(project: Project, ref: string | undefined, action: string): View {
  if (!ref) throw new Error(`${action}: "page" is required.`);
  const views = project.hmi?.views ?? [];
  const v = views.find((x) => x.id === ref) ?? views.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!v) throw new Error(`${action}: page "${ref}" not found. Pages: ${views.map((x) => x.name).join(', ') || '(none)'}.`);
  return v;
}

export function buildEvents(project: Project, specs: EventSpec[], ownTag?: string): GaugeEvent[] {
  return specs.map((s) => {
    const type = s.on ?? 'click';
    if (!EVENT_TRIGGERS.includes(type)) throw new Error(`Unknown trigger "${type}". Use: ${EVENT_TRIGGERS.join(', ')}.`);
    const ev = (action: string, actparam = '', actoptions: Record<string, unknown> = {}): GaugeEvent => ({ type, action, actparam, actoptions });
    switch (s.action) {
      case 'open_page':
        return ev('onpage', findPage(project, s.page, s.action).id);
      case 'open_popup':
        return ev('ondialog', findPage(project, s.page, s.action).id, { variablesMapping: [], ...(s.hide_close ? { hideClose: true } : {}) });
      case 'open_card':
        return ev('onwindow', findPage(project, s.page, s.action).id, {
          variablesMapping: [], left: s.x ?? 0, top: s.y ?? 0, relativeFrom: s.relative_to ?? 'window',
          ...(s.single ? { singleCard: true } : {}), ...(s.hide_close ? { hideClose: true } : {}),
        });
      case 'close':
        return ev('onclose');
      case 'set_value': {
        if (s.value === undefined) throw new Error('set_value: "value" is required.');
        const tag = s.tag ?? ownTag;
        if (!tag) throw new Error('set_value: "tag" is required.');
        const mode = s.mode ?? 'set';
        if (!['set', 'add', 'remove'].includes(mode)) throw new Error('set_value: mode must be set, add or remove.');
        return ev('onSetValue', String(s.value), { variable: { variableId: resolveTag(project, tag).id }, function: mode });
      }
      case 'toggle_value': {
        const tag = s.tag ?? ownTag;
        if (!tag) throw new Error('toggle_value: "tag" is required.');
        const variable: Record<string, unknown> = { variableId: resolveTag(project, tag).id };
        if (s.bit !== undefined) {
          if (!Number.isInteger(s.bit) || s.bit < 0 || s.bit > 31) throw new Error('toggle_value: bit must be 0-31.');
          variable.bitmask = 2 ** s.bit;
        }
        return ev('onToggleValue', '', { variable });
      }
      case 'run_script': {
        if (!s.script) throw new Error('run_script: "script" is required.');
        const scripts = ((project as unknown as { scripts?: ScriptRec[] }).scripts ?? []);
        const sc = scripts.find((x) => x.id === s.script) ?? scripts.find((x) => x.name.toLowerCase() === s.script!.toLowerCase());
        if (!sc) throw new Error(`run_script: script "${s.script}" not found. Scripts: ${scripts.map((x) => x.name).join(', ') || '(none)'}.`);
        const defs = sc.parameters ?? [];
        for (const k of Object.keys(s.params ?? {})) {
          if (!defs.some((d) => d.name === k)) throw new Error(`run_script: script "${sc.name}" has no parameter "${k}". Parameters: ${defs.map((d) => d.name).join(', ') || '(none)'}.`);
        }
        const params = defs.map((d) => {
          const v = s.params?.[d.name];
          if (v === undefined) return { ...d };
          // tagid parameters take a tag reference
          return { ...d, value: d.type === 'tagid' ? resolveTag(project, String(v)).id : String(v) };
        });
        return ev('onRunScript', sc.id, { params });
      }
      case 'open_link':
        if (!s.url) throw new Error('open_link: "url" is required.');
        return ev('onOpenTab', s.url, { newTab: s.new_tab ?? true, addressType: 'address' });
      default:
        throw new Error(`Unknown action "${(s as { action: string }).action}". Use: ${EVENT_ACTIONS.join(', ')}.`);
    }
  });
}

/** Human-readable summary of stored events (for get_view / tool results). */
export function describeEvents(project: Project, events: GaugeEvent[] | undefined): string[] {
  const views = new Map((project.hmi?.views ?? []).map((v) => [v.id, v.name]));
  const scripts = new Map(((project as unknown as { scripts?: ScriptRec[] }).scripts ?? []).map((s) => [s.id, s.name]));
  const tagRef = (id: unknown) => { try { return resolveTag(project, String(id)).ref; } catch { return String(id); } };
  return (events ?? []).map((e) => {
    const vid = (e.actoptions?.variable as { variableId?: string } | undefined)?.variableId;
    switch (e.action) {
      case 'onpage': return `${e.type}: open page ${views.get(e.actparam) ?? e.actparam}`;
      case 'ondialog': return `${e.type}: open popup ${views.get(e.actparam) ?? e.actparam}`;
      case 'onwindow': return `${e.type}: open card ${views.get(e.actparam) ?? e.actparam}`;
      case 'onclose': return `${e.type}: close`;
      case 'onSetValue': return `${e.type}: ${e.actoptions?.function && e.actoptions.function !== 'set' ? e.actoptions.function : 'set'} ${e.actparam} → ${vid ? tagRef(vid) : 'own tag'}`;
      case 'onToggleValue': return `${e.type}: toggle ${vid ? tagRef(vid) : 'own tag'}`;
      case 'onRunScript': return `${e.type}: run script ${scripts.get(e.actparam) ?? e.actparam}`;
      case 'onOpenTab': return `${e.type}: open link ${e.actparam}`;
      default: return `${e.type}: ${e.action} ${e.actparam ?? ''}`.trim();
    }
  });
}

// ------------------------------------------------------------------ svg helpers
function parse(view: View) {
  const doc = new DOMParser().parseFromString(view.svgcontent, 'image/svg+xml');
  return doc;
}
function save(view: View, doc: ReturnType<typeof parse>) {
  view.svgcontent = new XMLSerializer().serializeToString(doc);
}
function byId(doc: ReturnType<typeof parse>, id: string): XElement | undefined {
  const walk = (el: XElement): XElement | undefined => {
    if (el.getAttribute && el.getAttribute('id') === id) return el;
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1) { const r = walk(c as unknown as XElement); if (r) return r; }
    }
    return undefined;
  };
  return walk(doc.documentElement as unknown as XElement);
}
function activeLayer(doc: ReturnType<typeof parse>): XElement {
  const root = doc.documentElement as unknown as XElement;
  const layers = Array.from(root.childNodes).filter((n) => n.nodeType === 1 && n.nodeName === 'g') as unknown as XElement[];
  if (layers.length) return layers[layers.length - 1];
  const g = doc.createElementNS(SVG_NS, 'g') as unknown as XElement;
  root.appendChild(g as never);
  return g;
}

export const SHAPE_TAGS = ['rect', 'line', 'path', 'circle', 'ellipse', 'text'];

/**
 * Item for an element of the page: an existing gauge item, or (for a plain shape drawn with draw_shapes or
 * in the editor) a new "svg-ext-shapes-<tag>" item, as the editor creates when you open its properties.
 */
export function ensureItem(view: View, id: string): GaugeSettings {
  if (view.items[id]) return view.items[id];
  const doc = parse(view);
  const el = byId(doc, id);
  if (!el) throw new Error(`Item or shape "${id}" not found on page "${view.name}". Use scadacraft_get_view to list ids.`);
  const tag = el.nodeName.toLowerCase();
  if (!SHAPE_TAGS.includes(tag)) throw new Error(`"${id}" is a <${tag}>: only ${SHAPE_TAGS.join(', ')} elements can get events or animations.`);
  const item: GaugeSettings = { id, type: `svg-ext-shapes-${tag}`, name: '', label: 'Shapes', hide: false, lock: false, property: { events: [], actions: [] } };
  view.items[id] = item;
  return item;
}

// ------------------------------------------------------------------ shape animations
export interface ColorRange { min: number; max: number; fill?: string; stroke?: string }
export interface AnimationSpec {
  type: 'blink' | 'hide' | 'show' | 'rotate' | 'spin_clockwise' | 'spin_anticlockwise' | 'stop' | 'move';
  /** tag driving this action (default: the shape's colour tag) */
  tag?: string;
  /** value range that activates the action (default 1..1, i.e. a true boolean) */
  min?: number;
  max?: number;
  /** only look at one bit of the value (0-31) */
  bit?: number;
  /** blink: the two colours alternated (fill and/or stroke) */
  fill_a?: string; fill_b?: string; stroke_a?: string; stroke_b?: string;
  /** blink: ms */
  interval?: number;
  /** rotate: angle at min and at max of the range, degrees */
  min_angle?: number; max_angle?: number;
  /** move: target position (px) and duration (ms) */
  x?: number; y?: number; duration?: number;
}

const ACTION_TYPE: Record<AnimationSpec['type'], string> = {
  blink: 'blink', hide: 'hide', show: 'show', rotate: 'rotate', spin_clockwise: 'clockwise', spin_anticlockwise: 'anticlockwise', stop: 'stop', move: 'move',
};

function solid(c: string | undefined, what: string): string | undefined {
  if (c && c.startsWith('ob:')) throw new Error(`${what}: animated colours must be fixed colours (#hex or rgb), not OpenBridge tokens ("${c}"): the runtime writes them as SVG attributes.`);
  return c;
}

/**
 * Colour ranges and actions on a plain shape. Colours set by the runtime are SVG attributes, which a CSS
 * fill/stroke (OpenBridge "ob:" token) would override: those style declarations are removed from the
 * shape, and its base colour becomes an attribute.
 */
export function applyShapeAnimation(project: Project, view: View, id: string, input: { tag?: string | null; colors?: ColorRange[]; actions?: AnimationSpec[]; base_fill?: string; base_stroke?: string }): GaugeSettings {
  const item = ensureItem(view, id);
  if (!item.type.startsWith('svg-ext-shapes-')) throw new Error(`"${id}" is a ${item.type}: animations apply to plain shapes (rect, circle, path, text, line).`);
  const p = item.property as Record<string, unknown>;
  if (input.tag === null) delete p.variableId;
  else if (input.tag) p.variableId = resolveTag(project, input.tag).id;
  if (input.colors) {
    if (input.colors.length && !p.variableId) throw new Error('colors need a "tag".');
    p.ranges = input.colors.map((r, i) => ({ min: r.min, max: r.max, color: solid(r.fill, `colors[${i}].fill`) ?? null, stroke: solid(r.stroke, `colors[${i}].stroke`) ?? null }));
  }
  const doc = parse(view);
  const el = byId(doc, id)!;
  const current = (prop: 'fill' | 'stroke') => el.getAttribute(prop) || null;
  if (input.actions) {
    p.actions = input.actions.map((a, i) => {
      const type = ACTION_TYPE[a.type];
      if (!type) throw new Error(`actions[${i}]: unknown type "${a.type}". Use: ${Object.keys(ACTION_TYPE).join(', ')}.`);
      const variableId = a.tag ? resolveTag(project, a.tag).id : (p.variableId as string | undefined);
      if (!variableId) throw new Error(`actions[${i}] (${a.type}): "tag" is required (or set the shape tag).`);
      const min = a.min ?? 1;
      const max = a.max ?? min;
      let options: Record<string, unknown> = {};
      if (a.type === 'blink') {
        if (!a.fill_a && !a.fill_b && !a.stroke_a && !a.stroke_b) throw new Error(`actions[${i}] (blink): give fill_a/fill_b and/or stroke_a/stroke_b.`);
        // the runtime writes all four values: keep the current colour where one is not given
        options = {
          fillA: solid(a.fill_a, 'fill_a') ?? current('fill'), fillB: solid(a.fill_b, 'fill_b') ?? current('fill'),
          strokeA: solid(a.stroke_a, 'stroke_a') ?? current('stroke'), strokeB: solid(a.stroke_b, 'stroke_b') ?? current('stroke'),
          interval: a.interval ?? 1000,
        };
      } else if (a.type === 'rotate') {
        options = { minAngle: a.min_angle ?? 0, maxAngle: a.max_angle ?? 90, delay: 0 };
      } else if (a.type === 'move') {
        if (a.x === undefined || a.y === undefined) throw new Error(`actions[${i}] (move): x and y are required.`);
        options = { toX: a.x, toY: a.y, duration: a.duration ?? 500 };
      }
      return { variableId, bitmask: a.bit !== undefined ? 2 ** a.bit : 0, range: { min, max }, type, options };
    });
  }
  // colours animated → move CSS colours to attributes
  const ranges = (p.ranges as { color: string | null; stroke: string | null }[] | undefined) ?? [];
  const acts = (p.actions as { type: string }[] | undefined) ?? [];
  // a colour left out of a blink stays on its CSS token: the runtime writes the attribute, the style wins
  const blinks = acts.filter((a) => a.type === 'blink') as unknown as { options: { fillA?: string; fillB?: string; strokeA?: string; strokeB?: string } }[];
  const given = (v: string | null | undefined, cur: string | null) => !!v && v !== cur;
  const animFill = ranges.some((r) => r.color) || blinks.some((b) => given(b.options.fillA, current('fill')) || given(b.options.fillB, current('fill')));
  const animStroke = ranges.some((r) => r.stroke) || blinks.some((b) => given(b.options.strokeA, current('stroke')) || given(b.options.strokeB, current('stroke')));
  const style = el.getAttribute('style') ?? '';
  if ((animFill || animStroke) && style) {
    const decls = style.split(';').map((d) => d.trim()).filter(Boolean);
    const keep = decls.filter((d) => !((animFill && /^fill\s*:/.test(d)) || (animStroke && /^stroke\s*:/.test(d))));
    if (keep.length !== decls.length) {
      if (keep.length) el.setAttribute('style', keep.join(';')); else el.removeAttribute('style');
    }
  }
  const baseFill = solid(input.base_fill, 'base_fill') ?? (animFill && (!el.getAttribute('fill') || /var\(/.test(style)) ? ranges.find((r) => r.color)?.color : undefined);
  const baseStroke = solid(input.base_stroke, 'base_stroke') ?? (animStroke && !el.getAttribute('stroke') ? ranges.find((r) => r.stroke)?.stroke : undefined);
  if (baseFill) el.setAttribute('fill', baseFill);
  if (baseStroke) el.setAttribute('stroke', baseStroke);
  save(view, doc);
  return item;
}

export function describeAnimation(project: Project, item: GaugeSettings): string[] {
  const p = item.property as { variableId?: string; ranges?: { min: number; max: number; color?: string; stroke?: string }[]; actions?: { variableId: string; type: string; range: { min: number; max: number } }[] };
  const ref = (id?: string) => { if (!id) return '?'; try { return resolveTag(project, id).ref; } catch { return id; } };
  const out: string[] = [];
  if (p.variableId && p.ranges?.length) {
    out.push(`colour by ${ref(p.variableId)}: ` + p.ranges.map((r) => `${r.min}..${r.max} ${[r.color, r.stroke].filter(Boolean).join('/')}`).join(', '));
  }
  for (const a of p.actions ?? []) out.push(`${a.type} when ${ref(a.variableId)} in ${a.range.min}..${a.range.max}`);
  return out;
}

// ------------------------------------------------------------------ native controls
export interface ValueSpec {
  x: number; y: number;
  tag: string;
  unit?: string;
  decimals?: number;
  size?: number;
  color?: string;
  anchor?: 'start' | 'middle' | 'end';
  weight?: 'normal' | 'bold';
  font?: string;
  name?: string;
}

/** Value display (svg-ext-value): a text that shows the tag value, with unit and decimals. */
export function addValueControl(project: Project, view: View, s: ValueSpec): GaugeSettings {
  const tag = resolveTag(project, s.tag);
  const doc = parse(view);
  const layer = activeLayer(doc);
  const id = shortGuid('VAL_');
  const color = s.color ?? 'ob:element-active';
  const token = color.startsWith('ob:');
  const common: Record<string, string> = {
    'font-size': String(s.size ?? 14), 'font-family': s.font ?? 'Noto Sans, sans-serif', 'text-anchor': s.anchor ?? 'middle', 'stroke-width': '0', 'xml:space': 'preserve',
  };
  const g = doc.createElementNS(SVG_NS, 'g') as unknown as XElement;
  for (const [k, v] of Object.entries({ ...common, x: String(s.x), y: String(s.y), style: 'pointer-events:inherit', fill: token ? 'none' : color, type: 'svg-ext-value', id })) g.setAttribute(k, v);
  const t = doc.createElementNS(SVG_NS, 'text') as unknown as XElement;
  for (const [k, v] of Object.entries({ ...common, x: String(s.x), y: String(s.y), id: shortGuid('VAL_') })) t.setAttribute(k, v);
  if (token) t.setAttribute('style', `fill:var(--${color.slice(3).replace(/-color$/, '')}-color)`); else t.setAttribute('fill', color);
  if (s.weight === 'bold') t.setAttribute('font-weight', 'bold');
  t.appendChild(doc.createTextNode('##.##') as never);
  g.appendChild(t as never);
  layer.appendChild(g as never);
  save(view, doc);
  const ranges: Record<string, unknown>[] = [];
  if (s.unit !== undefined || s.decimals !== undefined) {
    ranges.push({ type: 1, min: 0, max: 0, text: s.unit ?? '', ...(s.decimals !== undefined ? { fractionDigits: s.decimals } : {}) });
  }
  const item: GaugeSettings = {
    id, type: 'svg-ext-value', name: s.name ?? tag.name, label: 'Value', hide: false, lock: false,
    property: { variableId: tag.id, events: [], actions: [], ...(ranges.length ? { ranges } : {}) },
  };
  view.items[id] = item;
  return item;
}

export interface ButtonSpec {
  x: number; y: number; width: number; height: number;
  text: string;
  /** Material icon or OpenBridge "ob:<name>" shown before the text */
  icon?: string;
  background?: string;
  color?: string;
  font_size?: number;
  /** tag whose value colours the button (with colors) and default target of set/toggle events */
  tag?: string;
  /** background (fill) / text colour (stroke) by tag value */
  colors?: ColorRange[];
  name?: string;
}

const cssColor = (c: string) => (c.startsWith('ob:') ? `var(--${c.slice(3).replace(/-color$/, '')}-color)` : c);

/** Button (svg-ext-html_button), as drawn by the editor. */
export function addButtonControl(project: Project, view: View, s: ButtonSpec): GaugeSettings {
  const doc = parse(view);
  const layer = activeLayer(doc);
  const id = shortGuid('HXB_');
  const host = shortGuid('HXB_');
  const g = doc.createElementNS(SVG_NS, 'g') as unknown as XElement;
  for (const [k, v] of Object.entries({ type: 'svg-ext-html_button', style: 'pointer-events:inherit', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', 'xml:space': 'preserve', id })) g.setAttribute(k, v);
  const rect = doc.createElementNS(SVG_NS, 'rect') as unknown as XElement;
  for (const [k, v] of Object.entries({ x: s.x, y: s.y, width: s.width, height: s.height, 'stroke-width': 0, id: shortGuid('svg_') })) rect.setAttribute(k, String(v));
  const fo = doc.createElementNS(SVG_NS, 'foreignObject') as unknown as XElement;
  for (const [k, v] of Object.entries({ x: s.x, y: s.y, width: s.width, height: s.height, id: `H-${host}` })) fo.setAttribute(k, String(v));
  const btn = doc.createElementNS(SVG_NS, 'BUTTON') as unknown as XElement;
  btn.setAttribute('id', `B-${host}`);
  btn.setAttribute('class', 'md-btn  md-btn-raised');
  btn.setAttribute('style', `width:calc(100% - 6px);height:calc(100% - 6px);text-align:center;background-color:${cssColor(s.background ?? 'ob:raised-enabled-background')};color:${cssColor(s.color ?? 'ob:on-raised-active')};font-size:${s.font_size ?? 14}px;font-family:Noto Sans, sans-serif;`);
  btn.appendChild(doc.createTextNode(s.text) as never);
  fo.appendChild(btn as never);
  g.appendChild(rect as never);
  g.appendChild(fo as never);
  layer.appendChild(g as never);
  save(view, doc);
  const property: Record<string, unknown> = { text: s.text, events: [], actions: [], ...(s.icon ? { icon: s.icon } : {}) };
  if (s.tag) property.variableId = resolveTag(project, s.tag).id;
  if (s.colors?.length) {
    if (!s.tag) throw new Error('button colors need a "tag".');
    property.ranges = s.colors.map((r) => ({ min: r.min, max: r.max, color: r.fill ? cssColor(r.fill) : null, stroke: r.stroke ? cssColor(r.stroke) : null }));
  }
  const item: GaugeSettings = { id, type: 'svg-ext-html_button', name: s.name ?? s.text, label: 'HtmlButton', hide: false, lock: false, property };
  view.items[id] = item;
  return item;
}

/** Remove any element (group or shape) with this id from svgcontent. */
export function removeElement(view: View, id: string): boolean {
  const doc = parse(view);
  const el = byId(doc, id);
  if (!el) return false;
  el.parentNode?.removeChild(el as never);
  save(view, doc);
  return true;
}

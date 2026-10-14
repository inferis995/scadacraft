/**
 * ScadaCraft page-building operations on top of the REST client.
 * Placement follows the OpenBridge P&ID anchor model (docs/openbridge.md):
 * a widget is placed so that its anchor lies on grid node (x, y) = pixel (x*24, y*24).
 * Non-P&ID widgets (instruments, charts, controls, alerts) are anchored at their top-left corner
 * and can be given any box size in whole cells.
 */
import { ScadaCraftClient } from '../fuxa/client.js';
import { allTags, resolveTag } from '../fuxa/tags.js';
import { DOMParser } from '@xmldom/xmldom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import {
  addShapes, addWidgetGroup, buildWidgetItem, CHART_GAUGE_TYPE, elementBoxes, removeShapes, type ShapeSpec, itemBoxes, newView, removeGroup, shortGuid, widgetNameFromAddress, WIDGET_GAUGE_TYPE,
} from '../fuxa/view.js';
import { processWidget } from '../fuxa/widget-script.js';
import {
  addButtonControl, addValueControl, applyShapeAnimation, buildEvents, describeAnimation, describeEvents, ensureItem, removeElement,
  type AnimationSpec, type ButtonSpec, type ColorRange, type EventSpec, type GaugeEvent, type ValueSpec,
} from '../fuxa/interaction.js';
import type { Catalog, CatalogWidget, GaugeSettings, Project, View, WidgetProperty } from '../fuxa/types.js';

/** folder of the catalog (widgets.json); the widgets themselves live in one folder per library */
export const WIDGET_GROUP_PATH = '/_widgets/openbridge';

export interface Node { x: number; y: number }

/** Property value: a fixed value, or a tag binding { tag: "Device.Tag" } (tag: null removes the binding). */
export type PropertyValue = string | number | boolean | { tag: string | null };

export interface PlaceSpec {
  widget: string;
  node: Node;
  length?: number;
  /** box size in grid cells, for resizable (non-P&ID) widgets */
  size?: { width: number; height: number };
  name?: string;
  properties?: Record<string, PropertyValue>;
}

export interface LibraryItem { path: string; name: string; label?: string }
export interface LibraryGroup { name: string; label?: string; items: LibraryItem[] }

/** Folders of the built-in OpenBridge libraries (generated, not edited through the MCP). */
const BUILTIN_GROUP = /^openbridge(-|$)/;

export interface ChartSpec {
  /** chart definition name or id (scadacraft_set_chart) */
  chart: string;
  node: Node;
  /** box in grid cells, default 16 x 10 */
  size?: { width: number; height: number };
  /** realtime: rolling window fed by live values; history: time-range toolbar on DAQ data */
  mode?: 'realtime' | 'history';
  title?: string;
  /** realtime window, minutes */
  minutes?: number;
  /** realtime: fill the window from the history at page open */
  load_history?: boolean;
  legend?: 'always' | 'follow' | 'bottom' | 'never';
  decimals?: number;
  background?: string;
  text_color?: string;
  grid_color?: string;
  name?: string;
}

export interface PlacedItem {
  id: string;
  widget: string;
  name: string;
  node: Node;
  box: { x: number; y: number; width: number; height: number };
  bindings: Record<string, string>;
  /** click/mouse events, readable */
  events?: string[];
  /** shape animations, readable */
  animations?: string[];
}

export class PagesService {
  private catalog?: Catalog;
  private svgCache = new Map<string, string>();

  constructor(readonly client: ScadaCraftClient) {}

  // ---------------------------------------------------------------- catalog
  async getCatalog(): Promise<Catalog> {
    if (!this.catalog) {
      const text = await this.client.getText(`${WIDGET_GROUP_PATH}/widgets.json`);
      this.catalog = JSON.parse(text) as Catalog;
    }
    return this.catalog;
  }

  /** A widget by catalog name (OpenBridge) or by library reference ("group/file", "file" or "_widgets/group/file.svg"). */
  async getWidget(name: string): Promise<CatalogWidget> {
    const cat = await this.getCatalog();
    const key = name.replace(/^.*?_widgets\//, '').replace(/\.svg$/, '');
    const w = cat.widgets.find((x) => x.widget === key || `_widgets/${key}.svg` === x.file);
    if (w) return w;
    const lib = await this.findLibraryItem(key);
    if (!lib) {
      throw new Error(`Unknown widget "${name}". OpenBridge widgets: see scadacraft_list_widgets; imported widgets: scadacraft_list_library_widgets.`);
    }
    return this.libraryWidget(lib.group, lib.item);
  }

  // ---------------------------------------------------------------- widget library (any FUXA SVG widget)
  async library(): Promise<LibraryGroup[]> {
    const res = await this.client.getJson<{ groups: LibraryGroup[] }>('/api/resources/widgets');
    return res?.groups ?? [];
  }

  private async findLibraryItem(key: string): Promise<{ group: LibraryGroup; item: LibraryItem } | undefined> {
    const groups = await this.library();
    const hits: { group: LibraryGroup; item: LibraryItem }[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        const rel = item.path.replace(/^_widgets\//, '').replace(/\.svg$/, '');
        const file = rel.slice(rel.indexOf('/') + 1);
        if (rel === key || file === key || basename(rel) === key) hits.push({ group, item });
      }
    }
    const exact = hits.filter((h) => h.item.path.replace(/^_widgets\//, '').replace(/\.svg$/, '') === key);
    if (exact.length === 1) return exact[0];
    if (hits.length > 1) {
      throw new Error(`Widget "${key}" exists in several groups: ${hits.map((h) => h.item.path.replace(/^_widgets\//, '').replace(/\.svg$/, '')).join(', ')}. Use "group/file".`);
    }
    return hits[0];
  }

  /** Catalog-like description of an imported widget: top-left anchor, size from the SVG, properties from its script. */
  private async libraryWidget(group: LibraryGroup, item: LibraryItem): Promise<CatalogWidget> {
    const key = item.path.replace(/^_widgets\//, '').replace(/\.svg$/, '');
    let svg = this.svgCache.get(key);
    if (!svg) {
      svg = await this.client.getText(`/${item.path}`);
      this.svgCache.set(key, svg);
    }
    const info = inspectWidgetSvg(svg, key);
    return {
      widget: key, file: item.path, title: item.label ?? basename(key), category: `library:${group.name}`, group: group.name,
      element: 'svg', layout: 'fill', size: info.size, anchor: { x: 0, y: 0 }, stretch: null,
      properties: info.vars.map((v) => ({ name: v.name, type: v.type, default: v.default, dir: 'read' as const, write: false, description: '' })),
    };
  }

  async describeLibraryWidget(ref: string): Promise<CatalogWidget> {
    return this.getWidget(ref);
  }

  /** Import SVG widgets (FUXA format) into a library group of the editor. */
  async importWidgets(input: { group: string; paths?: string[]; svg?: string; name?: string; overwrite?: boolean }): Promise<{ imported: { path: string; size: { width: number; height: number }; properties: string[] }[]; warnings: string[] }> {
    const group = input.group.trim();
    if (!/^[\w .-]+$/.test(group)) throw new Error('Group name may contain letters, digits, space, "-", "_" and "." only.');
    if (BUILTIN_GROUP.test(group)) throw new Error(`"${group}" is a built-in OpenBridge library; import into another group.`);
    const files: { name: string; svg: string }[] = [];
    if (input.svg) {
      if (!input.name) throw new Error('"name" is required with "svg".');
      files.push({ name: input.name, svg: input.svg });
    }
    for (const p of input.paths ?? []) {
      const full = resolve(p);
      const list = statSync(full).isDirectory()
        ? readdirSync(full).filter((f) => extname(f).toLowerCase() === '.svg').map((f) => join(full, f))
        : [full];
      for (const f of list) files.push({ name: basename(f), svg: readFileSync(f, 'utf8') });
    }
    if (!files.length) throw new Error('Nothing to import: pass "paths" (files or folders of .svg) or "svg" with "name".');
    const existing = new Set((await this.library()).flatMap((g) => g.items.map((i) => i.path)));
    const imported: { path: string; size: { width: number; height: number }; properties: string[] }[] = [];
    const warnings: string[] = [];
    for (const f of files) {
      const file = f.name.toLowerCase().endsWith('.svg') ? f.name : `${f.name}.svg`;
      if (!/^[\w .-]+\.svg$/i.test(file)) throw new Error(`Invalid file name "${file}".`);
      const path = `_widgets/${group}/${file}`;
      const info = inspectWidgetSvg(f.svg, file);
      if (!info.hasScript) warnings.push(`${file}: no <script>, it will be a static picture (no bindable properties).`);
      else if (!info.vars.length) warnings.push(`${file}: no //!export-start ... //!export-end variables (_pb_/_pn_/_ps_/_pc_), nothing to bind.`);
      if (existing.has(path) && !input.overwrite) {
        warnings.push(`${file}: already in "${group}", skipped (overwrite: true replaces it).`);
        continue;
      }
      await this.client.postJson('/api/upload', { resource: { type: 'svg', name: file, fullPath: `${group}/${file}`, data: f.svg }, destination: 'widgets' });
      this.svgCache.delete(`${group}/${file.replace(/\.svg$/i, '')}`);
      imported.push({ path, size: info.size, properties: info.vars.map((v) => `${v.name} (${v.type})`) });
    }
    return { imported, warnings };
  }

  async removeLibraryWidgets(refs: string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const ref of refs) {
      const hit = await this.findLibraryItem(ref.replace(/^\/?_widgets\//, '').replace(/\.svg$/, ''));
      if (!hit) throw new Error(`Library widget "${ref}" not found.`);
      if (BUILTIN_GROUP.test(hit.group.name)) throw new Error(`"${hit.item.path}" belongs to a built-in OpenBridge library and cannot be removed here.`);
      await this.client.postJson('/api/resources/removeWidget', { path: hit.item.path });
      removed.push(hit.item.path);
    }
    return removed;
  }

  private async widgetSvg(w: CatalogWidget): Promise<string> {
    let svg = this.svgCache.get(w.widget);
    if (!svg) {
      svg = await this.client.getText(`/${w.file}`);
      this.svgCache.set(w.widget, svg);
    }
    return svg;
  }

  // ---------------------------------------------------------------- views
  async getProject(): Promise<Project> {
    return this.client.getProject();
  }

  views(project: Project): View[] {
    return project.hmi?.views ?? [];
  }

  findView(project: Project, ref: string): View {
    const views = this.views(project);
    const v = views.find((x) => x.id === ref) ?? views.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!v) {
      throw new Error(`View "${ref}" not found. Existing views: ${views.map((x) => x.name).join(', ') || '(none)'}.`);
    }
    return v;
  }

  async createView(name: string, width: number, height: number, background: string): Promise<View> {
    const project = await this.getProject();
    if (this.views(project).some((v) => v.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A view named "${name}" already exists. Choose another name or edit the existing view.`);
    }
    const view = newView(name, width, height, background);
    await this.client.saveView(view);
    return view;
  }

  async updateView(ref: string, changes: { name?: string; width?: number; height?: number; background?: string }): Promise<View> {
    const project = await this.getProject();
    const view = this.findView(project, ref);
    if (changes.name && changes.name.toLowerCase() !== view.name.toLowerCase()
      && this.views(project).some((v) => v.name.toLowerCase() === changes.name!.toLowerCase())) {
      throw new Error(`A view named "${changes.name}" already exists.`);
    }
    if (changes.name) view.name = changes.name;
    if (changes.width) view.profile.width = changes.width;
    if (changes.height) view.profile.height = changes.height;
    if (changes.background) view.profile.bkcolor = changes.background;
    if (changes.width || changes.height) {
      view.svgcontent = view.svgcontent.replace(/^(<svg[^>]*?)\swidth="[^"]*"/, `$1 width="${view.profile.width}"`)
        .replace(/^(<svg[^>]*?)\sheight="[^"]*"/, `$1 height="${view.profile.height}"`);
    }
    await this.client.saveView(view);
    return view;
  }

  /** Copy a view with new item ids (same procedure as the editor's "clone view"). */
  async duplicateView(ref: string, newName: string): Promise<View> {
    const project = await this.getProject();
    const view = this.findView(project, ref);
    if (this.views(project).some((v) => v.name.toLowerCase() === newName.toLowerCase())) {
      throw new Error(`A view named "${newName}" already exists.`);
    }
    let content = JSON.stringify(view);
    for (const id of Object.keys(view.items ?? {})) {
      const prefix = id.includes('_') ? id.slice(0, id.indexOf('_') + 1) : '';
      content = content.split(id).join(shortGuid(prefix));
    }
    // widget host elements (H-/D- ids) are renamed too, so both views can be shown together
    const hosts = new Set([...content.matchAll(/[HD]-(OXC_[0-9a-f]{8}-[0-9a-f]{8})/g)].map((m) => m[1]));
    for (const h of hosts) content = content.split(h).join(shortGuid('OXC_'));
    const copy = JSON.parse(content) as View;
    copy.id = `v_${shortGuid()}`;
    copy.name = newName;
    await this.client.saveView(copy);
    return copy;
  }

  async deleteView(ref: string): Promise<View> {
    const project = await this.getProject();
    const view = this.findView(project, ref);
    await this.client.deleteView(view);
    return view;
  }

  // ---------------------------------------------------------------- items
  async describeItems(view: View): Promise<PlacedItem[]> {
    const cat = await this.getCatalog();
    const project = await this.getProject();
    const tagsById = new Map(allTags(project).map((t) => [t.id, t.ref]));
    const boxes = itemBoxes(view);
    const shapeBoxes = elementBoxes(view);
    const out: PlacedItem[] = [];
    for (const [id, item] of Object.entries(view.items)) {
      const box = boxes[id];
      const prop = item.property as Partial<WidgetProperty>;
      if (item.type === CHART_GAUGE_TYPE) {
        const cp = item.property as { id?: string; type?: string; options?: { realtime?: number } };
        const chart = ((project as unknown as { charts?: { id: string; name: string }[] }).charts ?? []).find((c) => c.id === cp.id);
        const node = box ? { x: box.x / cat.grid, y: box.y / cat.grid } : { x: NaN, y: NaN };
        out.push({ id, widget: 'chart', name: item.name, node, box: box ?? { x: NaN, y: NaN, width: NaN, height: NaN },
          bindings: { chart: chart ? chart.name : `missing (${cp.id})`, mode: cp.type === 'history' ? 'history' : `realtime ${cp.options?.realtime ?? ''} min` },
          ...(((item.property as { events?: GaugeEvent[] }).events ?? []).length ? { events: describeEvents(project, (item.property as { events?: GaugeEvent[] }).events) } : {}) });
        continue;
      }
      if (item.type !== WIDGET_GAUGE_TYPE) {
        const p = item.property as { variableId?: string; text?: string; events?: GaugeEvent[]; ranges?: { text?: string; fractionDigits?: number }[] };
        const b = box ?? shapeBoxes[id] ?? { x: NaN, y: NaN, width: NaN, height: NaN };
        const bindings: Record<string, string> = {};
        if (p.variableId) bindings.tag = `tag ${tagsById.get(p.variableId) ?? p.variableId}`;
        if (item.type === 'svg-ext-value' && p.ranges?.[0]) {
          if (p.ranges[0].text) bindings.unit = p.ranges[0].text;
          if (p.ranges[0].fractionDigits !== undefined) bindings.decimals = String(p.ranges[0].fractionDigits);
        }
        if (item.type === 'svg-ext-html_button' && p.text) bindings.text = p.text;
        const kind = item.type === 'svg-ext-value' ? 'value' : item.type === 'svg-ext-html_button' ? 'button'
          : item.type.startsWith('svg-ext-shapes-') ? `shape-${item.type.slice('svg-ext-shapes-'.length)}` : item.type;
        const events = describeEvents(project, p.events);
        const animations = item.type.startsWith('svg-ext-shapes-') ? describeAnimation(project, item) : [];
        out.push({ id, widget: kind, name: item.name, node: { x: b.x / cat.grid, y: b.y / cat.grid }, box: b, bindings,
          ...(events.length ? { events } : {}), ...(animations.length ? { animations } : {}) });
        continue;
      }
      let wname = widgetNameFromAddress(prop.address);
      let w = cat.widgets.find((x) => x.widget === wname);
      if (!w && typeof prop.address === 'string') {
        wname = prop.address.replace(/^.*?_widgets\//, '').replace(/\.svg$/, '');
      }
      // bindings: tags, plus fixed values that differ from the widget default
      const defaults = new Map((w?.properties ?? []).map((p) => [p.name, p.default]));
      const bindings: Record<string, string> = {};
      for (const v of prop.varsToBind ?? []) {
        if (v.variableId) bindings[v.name] = `tag ${tagsById.get(v.variableId) ?? v.variableId}`;
        else if (v.variableValue !== undefined && v.variableValue !== '' && v.variableValue !== defaults.get(v.name)) {
          bindings[v.name] = `value ${v.variableValue}`;
        }
      }
      const anchor = w?.anchor ?? { x: 0, y: 0 };
      const node = box ? { x: (box.x + anchor.x) / cat.grid, y: (box.y + anchor.y) / cat.grid } : { x: NaN, y: NaN };
      const events = describeEvents(project, prop.events as GaugeEvent[] | undefined);
      out.push({ id, widget: wname ?? item.type, name: item.name, node, box: box ?? { x: NaN, y: NaN, width: NaN, height: NaN }, bindings, ...(events.length ? { events } : {}) });
    }
    return out;
  }

  /** Place widgets on a view (one save for the whole batch). */
  async placeWidgets(viewRef: string, specs: PlaceSpec[]): Promise<{ view: View; placed: PlacedItem[]; warnings: string[] }> {
    const cat = await this.getCatalog();
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const placed: PlacedItem[] = [];
    const warnings: string[] = [];
    for (const spec of specs) {
      const w = await this.getWidget(spec.widget);
      const g = cat.grid;
      let width = w.size.width;
      let height = w.size.height;
      if (spec.length !== undefined) {
        if (!w.stretch) {
          warnings.push(`${w.widget}: "length" ignored (only straight pipes stretch).`);
        } else if (w.stretch === 'x') width = spec.length * g;
        else height = spec.length * g;
      }
      if (spec.size !== undefined) {
        if (w.layout === 'anchor') {
          warnings.push(`${w.widget}: "size" ignored (P&ID symbols keep their OpenBridge size; use "length" for straight pipes).`);
        } else {
          width = spec.size.width * g;
          height = spec.size.height * g;
        }
      }
      const x = spec.node.x * g - w.anchor.x;
      const y = spec.node.y * g - w.anchor.y;
      const ax = spec.node.x * g;
      const ay = spec.node.y * g;
      if (ax < 0 || ay < 0 || ax > view.profile.width || ay > view.profile.height) {
        throw new Error(
          `${w.widget} at node (${spec.node.x}, ${spec.node.y}) is outside the view (${view.profile.width / g} x ${view.profile.height / g} nodes).`,
        );
      }
      if (x < 0 || y < 0 || x + width > view.profile.width || y + height > view.profile.height) {
        warnings.push(`${w.widget} at node (${spec.node.x}, ${spec.node.y}): part of its box is outside the view and may be clipped.`);
      }
      const { id, item } = buildWidgetItem({
        widget: w, svgSource: await this.widgetSvg(w), address: w.file,
        x, y, width, height, name: spec.name,
      });
      if (spec.properties) this.applyProperties(project, item, w, spec.properties);
      view.items[id] = item;
      addWidgetGroup(view, id, x, y, width, height);
      placed.push({ id, widget: w.widget, name: item.name, node: spec.node, box: { x, y, width, height }, bindings: this.bindingSummary(project, item, w) });
    }
    await this.client.saveView(view);
    return { view, placed, warnings };
  }

  /** Expand an orthogonal path of nodes into straight pipes and elbows. */
  async pipeSpecs(path: Node[], props: Record<string, PropertyValue>): Promise<PlaceSpec[]> {
    if (path.length < 2) throw new Error('A pipe path needs at least 2 nodes.');
    const specs: PlaceSpec[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (a.x !== b.x && a.y !== b.y) {
        throw new Error(`Pipe segment (${a.x},${a.y}) -> (${b.x},${b.y}) is diagonal. Add an intermediate node so every segment is horizontal or vertical.`);
      }
      if (a.x === b.x && a.y === b.y) continue;
      if (a.y === b.y) {
        specs.push({ widget: 'ob-line-horizontal', node: { x: Math.min(a.x, b.x), y: a.y }, length: Math.abs(b.x - a.x), properties: props });
      } else {
        specs.push({ widget: 'ob-line-vertical', node: { x: a.x, y: Math.min(a.y, b.y) }, length: Math.abs(b.y - a.y), properties: props });
      }
    }
    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i];
      const dirs = [path[i - 1], path[i + 1]].map((q) =>
        q.x < p.x ? 'left' : q.x > p.x ? 'right' : q.y < p.y ? 'top' : 'bottom',
      );
      const vertical = dirs.find((d) => d === 'top' || d === 'bottom');
      const horizontal = dirs.find((d) => d === 'left' || d === 'right');
      if (vertical && horizontal) {
        specs.push({ widget: 'ob-line-elbow', node: p, properties: { ...props, _ps_direction: `${vertical}-${horizontal}` } });
      }
    }
    return specs;
  }

  async setProperties(viewRef: string, itemId: string, props: Record<string, PropertyValue>): Promise<PlacedItem> {
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const item = view.items[itemId];
    if (!item) throw new Error(`Item "${itemId}" not found on view "${view.name}". Use scadacraft_get_view to list item ids.`);
    if (item.type !== WIDGET_GAUGE_TYPE || (item.property as Partial<WidgetProperty>).type !== 'widget') {
      throw new Error(`Item "${itemId}" is not a widget; only widget properties can be set with this tool.`);
    }
    const w = await this.getWidget(String((item.property as WidgetProperty).address ?? ''));
    this.applyProperties(project, item, w, props);
    await this.client.saveView(view);
    return (await this.describeItems(view)).find((x) => x.id === itemId)!;
  }

  /** Plain shapes (cards, labels, separators). Coordinates in grid cells (fractions allowed) or px. */
  async drawShapes(viewRef: string, shapes: ShapeSpec[], unit: 'cell' | 'px' = 'cell'): Promise<{ view: View; ids: string[] }> {
    const cat = await this.getCatalog();
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const k = unit === 'cell' ? cat.grid : 1;
    const px = shapes.map((sh) => {
      if (sh.type === 'rect') return { ...sh, x: sh.x * k, y: sh.y * k, width: sh.width * k, height: sh.height * k };
      if (sh.type === 'text') return { ...sh, x: sh.x * k, y: sh.y * k };
      return { ...sh, x1: sh.x1 * k, y1: sh.y1 * k, x2: sh.x2 * k, y2: sh.y2 * k };
    }) as ShapeSpec[];
    const ids = addShapes(view, px);
    await this.client.saveView(view);
    return { view, ids };
  }

  async removeItems(viewRef: string, ids: string[]): Promise<{ removed: string[]; missing: string[] }> {
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const removed: string[] = [];
    const missing: string[] = [];
    const shapeIds: string[] = [];
    for (const id of ids) {
      if (view.items[id]) {
        delete view.items[id];
        if (!removeGroup(view, id)) removeElement(view, id);
        removed.push(id);
      } else shapeIds.push(id);
    }
    if (shapeIds.length) {
      const gone = removeShapes(view, shapeIds);
      removed.push(...gone);
      missing.push(...shapeIds.filter((i) => !gone.includes(i)));
    }
    if (removed.length) await this.client.saveView(view);
    return { removed, missing };
  }

  // ---------------------------------------------------------------- events, animations, native controls
  /** Set (replace or append) the mouse events of any item: widget, chart, value, button or plain shape. */
  async setEvents(viewRef: string, itemId: string, specs: EventSpec[], append = false): Promise<PlacedItem> {
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const item = ensureItem(view, itemId);
    const p = item.property as Record<string, unknown>;
    const ownTag = typeof p.variableId === 'string' ? p.variableId : undefined;
    const events = buildEvents(project, specs, ownTag);
    p.events = append ? [...((p.events as GaugeEvent[] | undefined) ?? []), ...events] : events;
    await this.client.saveView(view);
    return (await this.describeItems(view)).find((x) => x.id === itemId)!;
  }

  /** Colour by value, blink, hide/show, rotate, spin, move on a plain shape. */
  async animateShape(viewRef: string, shapeId: string, input: { tag?: string | null; colors?: ColorRange[]; actions?: AnimationSpec[]; base_fill?: string; base_stroke?: string }): Promise<PlacedItem> {
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    applyShapeAnimation(project, view, shapeId, input);
    await this.client.saveView(view);
    return (await this.describeItems(view)).find((x) => x.id === shapeId)!;
  }

  /** Native value display. x/y: text anchor point in cells (or px). */
  async placeValue(viewRef: string, spec: ValueSpec & { events?: EventSpec[] }, unit: 'cell' | 'px' = 'cell'): Promise<PlacedItem> {
    const cat = await this.getCatalog();
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const k = unit === 'cell' ? cat.grid : 1;
    const item = addValueControl(project, view, { ...spec, x: spec.x * k, y: spec.y * k });
    if (spec.events?.length) (item.property as Record<string, unknown>).events = buildEvents(project, spec.events, spec.tag);
    await this.client.saveView(view);
    return (await this.describeItems(view)).find((x) => x.id === item.id)!;
  }

  /** Native button, optionally with events (default trigger: click) and colours by tag value. */
  async placeButton(viewRef: string, spec: ButtonSpec & { events?: EventSpec[] }, unit: 'cell' | 'px' = 'cell'): Promise<PlacedItem> {
    const cat = await this.getCatalog();
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const k = unit === 'cell' ? cat.grid : 1;
    const item = addButtonControl(project, view, { ...spec, x: spec.x * k, y: spec.y * k, width: spec.width * k, height: spec.height * k });
    if (spec.events?.length) (item.property as Record<string, unknown>).events = buildEvents(project, spec.events, spec.tag);
    await this.client.saveView(view);
    return (await this.describeItems(view)).find((x) => x.id === item.id)!;
  }

  // ---------------------------------------------------------------- native trend charts
  /** Place ScadaCraft's own chart control (uPlot trend) bound to a chart definition. */
  async placeChart(viewRef: string, spec: ChartSpec): Promise<{ view: View; placed: PlacedItem; warnings: string[] }> {
    const cat = await this.getCatalog();
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const chart = this.findChart(project, spec.chart);
    const g = cat.grid;
    const width = (spec.size?.width ?? 16) * g;
    const height = (spec.size?.height ?? 10) * g;
    const x = spec.node.x * g;
    const y = spec.node.y * g;
    const warnings: string[] = [];
    if (x + width > view.profile.width || y + height > view.profile.height) {
      warnings.push(`chart at node (${spec.node.x}, ${spec.node.y}): part of its box is outside the view and may be clipped.`);
    }
    const id = shortGuid('HXC_');
    const mode = spec.mode ?? 'realtime';
    const options: Record<string, unknown> = {
      title: spec.title ?? chart.name, fontFamily: 'Roboto-Regular', legendFontSize: 12,
      colorBackground: spec.background ?? 'rgba(255,255,255,0)', legendBackground: 'rgba(255,255,255,0)',
      titleHeight: 18, axisLabelFontSize: 12, labelsDivWidth: 0,
      axisLineColor: spec.text_color ?? 'rgba(0,0,0,1)', axisLabelColor: spec.text_color ?? 'rgba(0,0,0,1)',
      ...(spec.grid_color ? { gridLineColor: spec.grid_color } : {}),
      legendMode: spec.legend ?? 'always', series: [], width, height, decimalsPrecision: spec.decimals ?? 2,
      realtime: spec.minutes ?? 60, loadOldValues: spec.load_history ?? true,
      mouseWheelScroll: false, mouseWheelZoom: mode === 'history', staticChart: false,
      dateFormat: 'DD_MM_YYYY', timeFormat: 'hh_mm_ss',
    };
    const item: GaugeSettings = {
      id, type: CHART_GAUGE_TYPE, name: spec.name ?? chart.name, label: 'HtmlChart', hide: false, lock: false,
      property: { id: chart.id, type: mode === 'history' ? 'history' : 'realtime1', options, events: [] },
    };
    view.items[id] = item;
    addWidgetGroup(view, id, x, y, width, height, {
      type: CHART_GAUGE_TYPE, hostPrefix: 'HXC_', attrs: { style: 'pointer-events:inherit', stroke: '#000000', 'stroke-width': '1' },
    });
    await this.client.saveView(view);
    const placed = (await this.describeItems(view)).find((i) => i.id === id)!;
    const tagless = (chart.lines ?? []).length === 0;
    if (tagless) warnings.push(`chart "${chart.name}" has no pens; add tags with scadacraft_set_chart.`);
    return { view, placed, warnings };
  }

  private findChart(project: Project, ref: string): { id: string; name: string; lines?: unknown[] } {
    const charts = (project as unknown as { charts?: { id: string; name: string; lines?: unknown[] }[] }).charts ?? [];
    const c = charts.find((x) => x.id === ref) ?? charts.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!c) {
      throw new Error(`Chart "${ref}" not found. Charts: ${charts.map((x) => x.name).join(', ') || '(none)'}. Create it with scadacraft_set_chart.`);
    }
    return c;
  }

  // ---------------------------------------------------------------- properties
  private applyProperties(project: Project, item: GaugeSettings, w: CatalogWidget, props: Record<string, PropertyValue>): void {
    const vars = (item.property as WidgetProperty).varsToBind;
    for (const [key, value] of Object.entries(props)) {
      const v = vars.find((x) => x.name === key || x.originalName === key)
        ?? vars.find((x) => x.name.replace(/^_p[bnsc]_/, '').toLowerCase() === key.toLowerCase());
      if (!v) {
        throw new Error(`Widget ${w.widget} has no property "${key}". Properties: ${vars.map((x) => x.name).join(', ')}.`);
      }
      if (value !== null && typeof value === 'object') {
        if (value.tag === null) {
          delete v.variableId;
        } else {
          v.variableId = resolveTag(project, value.tag).id;
        }
      } else {
        const s = String(value);
        if (v.type === 'number' && Number.isNaN(Number(s))) throw new Error(`${w.widget}.${v.name} expects a number, got "${s}".`);
        if (v.type === 'boolean' && !['true', 'false', '1', '0'].includes(s.toLowerCase())) {
          throw new Error(`${w.widget}.${v.name} expects true/false, got "${s}".`);
        }
        v.variableValue = s;
      }
    }
  }

  private bindingSummary(project: Project, item: GaugeSettings, w: CatalogWidget): Record<string, string> {
    const tagsById = new Map(allTags(project).map((t) => [t.id, t.ref]));
    const defaults = new Map(w.properties.map((p) => [p.name, p.default]));
    const out: Record<string, string> = {};
    for (const v of (item.property as WidgetProperty).varsToBind) {
      if (v.variableId) out[v.name] = `tag ${tagsById.get(v.variableId) ?? v.variableId}`;
      else if (v.variableValue !== undefined && v.variableValue !== '' && v.variableValue !== defaults.get(v.name)) {
        out[v.name] = `value ${v.variableValue}`;
      }
    }
    return out;
  }
}

/** Size and bindable variables of a FUXA SVG widget. */
export function inspectWidgetSvg(svg: string, label: string): { size: { width: number; height: number }; hasScript: boolean; vars: { name: string; type: string; default: string }[] } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') throw new Error(`${label}: not an SVG document.`);
  const num = (v: string | null) => (v && !v.trim().endsWith('%') ? parseFloat(v) : NaN);
  let width = num(root.getAttribute('width'));
  let height = num(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if ((Number.isNaN(width) || Number.isNaN(height)) && vb.length === 4 && vb.every((n) => !Number.isNaN(n))) {
    width = Number.isNaN(width) ? vb[2] : width;
    height = Number.isNaN(height) ? vb[3] : height;
  }
  if (Number.isNaN(width) || Number.isNaN(height)) { width = 100; height = 100; }
  const scripts = Array.from(root.getElementsByTagName('script'));
  const vars: { name: string; type: string; default: string }[] = [];
  for (const sc of scripts) {
    for (const v of processWidget(sc.textContent ?? '', 'wModule_probe', {}).vars) {
      vars.push({ name: v.name, type: v.type, default: String(v.variableValue ?? '') });
    }
  }
  return { size: { width: Math.round(width), height: Math.round(height) }, hasScript: scripts.length > 0, vars };
}

/**
 * ScadaCraft page-building operations on top of the REST client.
 * Placement follows the OpenBridge P&ID anchor model (docs/openbridge.md):
 * a widget is placed so that its anchor lies on grid node (x, y) = pixel (x*24, y*24).
 */
import { ScadaCraftClient } from './fuxa/client.js';
import { allTags, resolveTag } from './fuxa/tags.js';
import {
  addWidgetGroup, buildWidgetItem, itemBoxes, newView, removeGroup, widgetNameFromAddress, WIDGET_GAUGE_TYPE,
} from './fuxa/view.js';
import type { Catalog, CatalogWidget, Device, GaugeSettings, Project, Tag, View, WidgetProperty } from './fuxa/types.js';
import { randomBytes } from 'node:crypto';

export const WIDGET_GROUP_PATH = '/_widgets/openbridge';

export interface Node { x: number; y: number }

/** Property value: a fixed value, or a tag binding { tag: "Device.Tag" } (tag: null removes the binding). */
export type PropertyValue = string | number | boolean | { tag: string | null };

export interface PlaceSpec {
  widget: string;
  node: Node;
  length?: number;
  name?: string;
  properties?: Record<string, PropertyValue>;
}

export interface PlacedItem {
  id: string;
  widget: string;
  name: string;
  node: Node;
  box: { x: number; y: number; width: number; height: number };
  bindings: Record<string, string>;
}

export class ScadaCraftService {
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

  async getWidget(name: string): Promise<CatalogWidget> {
    const cat = await this.getCatalog();
    const key = name.replace(/\.svg$/, '');
    const w = cat.widgets.find((x) => x.widget === key);
    if (!w) {
      throw new Error(`Unknown widget "${name}". Available: ${cat.widgets.map((x) => x.widget).join(', ')}.`);
    }
    return w;
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
    const out: PlacedItem[] = [];
    for (const [id, item] of Object.entries(view.items)) {
      const box = boxes[id];
      const prop = item.property as Partial<WidgetProperty>;
      const wname = widgetNameFromAddress(prop.address);
      const w = cat.widgets.find((x) => x.widget === wname);
      // bindings: tags, plus fixed values that differ from the widget default
      const defaults = new Map((w?.properties ?? []).map((p) => [p.name, p.default]));
      const bindings: Record<string, string> = {};
      for (const v of prop.varsToBind ?? []) {
        if (v.variableId) bindings[v.name] = `tag ${tagsById.get(v.variableId) ?? v.variableId}`;
        else if (v.variableValue !== undefined && v.variableValue !== '' && v.variableValue !== defaults.get(v.name)) {
          bindings[v.name] = `value ${v.variableValue}`;
        }
      }
      const node = box && w
        ? { x: (box.x + w.anchor.x) / cat.grid, y: (box.y + w.anchor.y) / cat.grid }
        : { x: NaN, y: NaN };
      out.push({ id, widget: wname ?? item.type, name: item.name, node, box: box ?? { x: NaN, y: NaN, width: NaN, height: NaN }, bindings });
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
        widget: w, svgSource: await this.widgetSvg(w), address: `${WIDGET_GROUP_PATH.slice(1)}/${w.widget}.svg`,
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
    const w = await this.getWidget(widgetNameFromAddress((item.property as WidgetProperty).address) ?? '');
    this.applyProperties(project, item, w, props);
    await this.client.saveView(view);
    return (await this.describeItems(view)).find((x) => x.id === itemId)!;
  }

  async removeItems(viewRef: string, ids: string[]): Promise<{ removed: string[]; missing: string[] }> {
    const project = await this.getProject();
    const view = this.findView(project, viewRef);
    const removed: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      if (view.items[id]) {
        delete view.items[id];
        removeGroup(view, id);
        removed.push(id);
      } else missing.push(id);
    }
    if (removed.length) await this.client.saveView(view);
    return { removed, missing };
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

  // ---------------------------------------------------------------- tags
  async createServerTags(tags: { name: string; type: 'number' | 'boolean' | 'string'; init?: string }[]): Promise<Tag[]> {
    const project = await this.getProject();
    // server memory tags live in devices['0']; project.server is only the template of that device
    const template = project.devices?.['0'] ?? project.server;
    if (!template) throw new Error('This project has no ScadaCraft server device.');
    const server: Device = JSON.parse(JSON.stringify(template)) as Device;
    server.id = '0';
    server.enabled = true;
    server.tags = server.tags ?? {};
    const existing = new Set(Object.values(server.tags).map((t) => t.name.toLowerCase()));
    const created: Tag[] = [];
    for (const t of tags) {
      if (existing.has(t.name.toLowerCase())) throw new Error(`Server tag "${t.name}" already exists.`);
      const id = `t_${randomBytes(4).toString('hex')}-${randomBytes(4).toString('hex')}`;
      const tag: Tag = { id, name: t.name, label: t.name, type: t.type, init: t.init ?? '', value: undefined };
      server.tags[id] = tag;
      existing.add(t.name.toLowerCase());
      created.push(tag);
    }
    await this.client.saveDevice(server);
    return created;
  }
}

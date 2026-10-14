/**
 * Build and edit ScadaCraft views (pages) in the exact format saved by the editor.
 *
 * A widget on a page is stored twice:
 *  - in view.svgcontent, as an editor group:
 *      <g type="svg-ext-own_ctrl-image" id="OXC_…">
 *        <rect …/> <foreignObject id="H-OXC_…"><div id="D-OXC_…"/></foreignObject>
 *      </g>
 *  - in view.items[id], as GaugeSettings with property.type = 'widget', the widget SVG
 *    (ids renamed with the instance guid), the processed script and varsToBind.
 * At load time the client injects property.svgContent into the D- div and runs the script.
 */
import { DOMParser, XMLSerializer, type Element as XElement } from '@xmldom/xmldom';
import { randomBytes } from 'node:crypto';
import { processWidget, type WidgetPropertyVariable } from './widget-script.js';
import type { CatalogWidget, GaugeSettings, View, WidgetProperty } from './types.js';

export const WIDGET_GAUGE_TYPE = 'svg-ext-own_ctrl-image';
export const CHART_GAUGE_TYPE = 'svg-ext-html_chart';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
/** Same shape as Utils.getShortGUID(prefix, '-'): 8 + 8 hex chars */
export const shortGuid = (prefix = '', splitter = '-'): string => `${prefix}${hex(4)}${splitter}${hex(4)}`;

export function emptySvgContent(width: number, height: number): string {
  return `<svg width="${width}" height="${height}" xmlns="${SVG_NS}" xmlns:svg="${SVG_NS}" xmlns:html="${XHTML_NS}">
 <filter height="200" width="200" y="-3" x="-3" id="blur-filter">
  <feGaussianBlur stdDeviation="3"/>
 </filter>
 <g>
  <title>Layer 1</title>
 </g>
</svg>`;
}

export function newView(name: string, width: number, height: number, background: string): View {
  return {
    id: `v_${hex(6)}-${hex(3)}`,
    name,
    profile: { width, height, bkcolor: background, margin: 10, align: 'topCenter', gridType: 'fixed', viewRenderDelay: 0 },
    items: {},
    variables: {},
    svgcontent: emptySvgContent(width, height),
    type: 'svg',
  };
}

function parseSvg(svgcontent: string) {
  const doc = new DOMParser().parseFromString(svgcontent, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') {
    throw new Error('The view has no valid SVG content.');
  }
  return { doc, root };
}

/** The editor draws into the last top-level <g> (the active layer). */
function activeLayer(root: XElement): XElement {
  const layers = Array.from(root.childNodes).filter((n) => n.nodeType === 1 && n.nodeName === 'g') as unknown as XElement[];
  if (layers.length) return layers[layers.length - 1];
  const g = root.ownerDocument!.createElementNS(SVG_NS, 'g');
  const title = root.ownerDocument!.createElementNS(SVG_NS, 'title');
  title.appendChild(root.ownerDocument!.createTextNode('Layer 1'));
  g.appendChild(title);
  root.appendChild(g);
  return g;
}

export interface WidgetInstanceInput {
  widget: CatalogWidget;
  svgSource: string;
  address: string;
  /** top-left of the widget box, px */
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}

/** Create the GaugeSettings for one widget instance (what the editor stores in view.items). */
export function buildWidgetItem(input: WidgetInstanceInput): { id: string; item: GaugeSettings } {
  const svgGuid = `${hex(4)}${hex(1)}_${hex(2)}`;
  const doc = new DOMParser().parseFromString(input.svgSource, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName !== 'svg') throw new Error(`Widget ${input.widget.widget}: invalid SVG.`);

  // rename every id with the instance guid (SvgUtils.renameIdsInSvg)
  const idMap: Record<string, string> = {};
  const walk = (el: XElement) => {
    const id = el.getAttribute('id');
    if (id) {
      const newId = `${id}_${svgGuid}`;
      el.setAttribute('id', newId);
      idMap[id] = newId;
    }
    Array.from(el.childNodes).forEach((c) => { if (c.nodeType === 1) walk(c as unknown as XElement); });
  };
  walk(svg as unknown as XElement);

  const moduleId = `wModule_${svgGuid}`;
  let processed: { content: string; vars: WidgetPropertyVariable[] } | undefined;
  Array.from(svg.getElementsByTagName('script')).forEach((script) => {
    processed = processWidget(script.textContent ?? '', moduleId, idMap);
    script.parentNode?.removeChild(script);
  });
  if (!processed) throw new Error(`Widget ${input.widget.widget}: no script found.`);

  // stretched widgets keep their size in the stored SVG (as the editor does after a resize)
  svg.setAttribute('width', String(input.width));
  svg.setAttribute('height', String(input.height));

  const id = shortGuid('OXC_');
  const property: WidgetProperty = {
    events: [],
    actions: [],
    address: input.address,
    type: 'widget',
    svgGuid,
    svgContent: new XMLSerializer().serializeToString(svg),
    scriptContent: { moduleId, content: processed.content },
    varsToBind: processed.vars,
  };
  return {
    id,
    item: { id, type: WIDGET_GAUGE_TYPE, name: input.name ?? '', label: 'HtmlImage', hide: false, lock: false, property },
  };
}

export interface GroupOptions {
  /** gauge type stored on the group (default: widget) */
  type?: string;
  /** prefix of the host ids H-/D- (the runtime finds the host by "D-" + prefix) */
  hostPrefix?: string;
  /** extra attributes for the group */
  attrs?: Record<string, string>;
}

/** Add the editor group for an item hosted in a foreignObject (widgets, charts) to view.svgcontent. */
export function addWidgetGroup(view: View, id: string, x: number, y: number, width: number, height: number, opts: GroupOptions = {}): void {
  const type = opts.type ?? WIDGET_GAUGE_TYPE;
  const { doc, root } = parseSvg(view.svgcontent);
  const layer = activeLayer(root as unknown as XElement);
  const g = doc.createElementNS(SVG_NS, 'g');
  for (const [k, v] of Object.entries({
    'xml:space': 'preserve', 'text-anchor': 'right', 'font-family': 'sans-serif', 'font-size': '14',
    fill: '#FFFFFF', ...(opts.attrs ?? {}), type, id,
  })) g.setAttribute(k, v);
  const rect = doc.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ fill: 'transparent', id: shortGuid('svg_'), height, width, y, x, 'stroke-width': 0 })) rect.setAttribute(k, String(v));
  const hostId = shortGuid(opts.hostPrefix ?? 'OXC_');
  const fo = doc.createElementNS(SVG_NS, 'foreignObject');
  for (const [k, v] of Object.entries({ id: `H-${hostId}`, width, height, y, x })) fo.setAttribute(k, String(v));
  // the editor stores the host as a plain <DIV> (no XHTML prefix): its SVG sanitizer drops
  // namespaced html:div elements, which would make the widget disappear from the editor
  const div = doc.createElementNS(SVG_NS, 'DIV');
  div.setAttribute('style', 'width:100%;height:100%;');
  div.setAttribute('id', `D-${hostId}`);
  // explicit closing tag: the runtime parses svgcontent as HTML, where <DIV/> would not close
  div.appendChild(doc.createTextNode(' '));
  fo.appendChild(div);
  g.appendChild(rect);
  g.appendChild(fo);
  layer.appendChild(g);
  view.svgcontent = new XMLSerializer().serializeToString(doc);
}

export type ShapeSpec =
  | { type: 'rect'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; stroke_width?: number; radius?: number; opacity?: number }
  | { type: 'text'; x: number; y: number; text: string; size?: number; weight?: 'normal' | 'bold' | number; color?: string; anchor?: 'start' | 'middle' | 'end'; font?: string; uppercase?: boolean }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; stroke_width?: number };

/**
 * Colour: hex/rgb, or an OpenBridge palette token "ob:<name>" (e.g. "ob:container-global") that follows the
 * day/dusk/night/bright palette. Tokens are written as CSS (style) because SVG presentation attributes do not
 * resolve CSS variables.
 */
function paint(el: XElement, prop: 'fill' | 'stroke', value: string | undefined, styles: string[]): void {
  if (!value) return;
  if (value.startsWith('ob:')) styles.push(`${prop}:var(--${value.slice(3).replace(/-color$/, '')}-color)`);
  else el.setAttribute(prop, value);
}

/** Plain editor shapes (cards, labels, separators): SVG elements in the active layer, no gauge item. */
export function addShapes(view: View, shapes: ShapeSpec[]): string[] {
  const { doc, root } = parseSvg(view.svgcontent);
  const layer = activeLayer(root as unknown as XElement);
  const ids: string[] = [];
  for (const sh of shapes) {
    const id = shortGuid('svg_');
    const styles: string[] = [];
    let el: XElement;
    if (sh.type === 'rect') {
      el = doc.createElementNS(SVG_NS, 'rect') as unknown as XElement;
      for (const [k, v] of Object.entries({ x: sh.x, y: sh.y, width: sh.width, height: sh.height, rx: sh.radius ?? 0, ry: sh.radius ?? 0 })) el.setAttribute(k, String(v));
      paint(el, 'fill', sh.fill ?? 'ob:container-global', styles);
      paint(el, 'stroke', sh.stroke ?? 'ob:border-outline', styles);
      el.setAttribute('stroke-width', String(sh.stroke_width ?? 1));
      if (sh.opacity !== undefined) el.setAttribute('opacity', String(sh.opacity));
    } else if (sh.type === 'text') {
      el = doc.createElementNS(SVG_NS, 'text') as unknown as XElement;
      for (const [k, v] of Object.entries({
        x: sh.x, y: sh.y, 'font-size': sh.size ?? 14, 'font-family': sh.font ?? 'Noto Sans, sans-serif',
        'font-weight': sh.weight ?? 'normal', 'text-anchor': sh.anchor ?? 'start', 'stroke-width': 0, 'xml:space': 'preserve',
      })) el.setAttribute(k, String(v));
      paint(el, 'fill', sh.color ?? 'ob:element-active', styles);
      el.appendChild(doc.createTextNode(sh.uppercase ? sh.text.toUpperCase() : sh.text));
    } else {
      el = doc.createElementNS(SVG_NS, 'line') as unknown as XElement;
      for (const [k, v] of Object.entries({ x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2 })) el.setAttribute(k, String(v));
      paint(el, 'stroke', sh.stroke ?? 'ob:border-divider', styles);
      el.setAttribute('stroke-width', String(sh.stroke_width ?? 1));
      el.setAttribute('fill', 'none');
    }
    el.setAttribute('id', id);
    if (styles.length) el.setAttribute('style', styles.join(';'));
    layer.appendChild(el);
    ids.push(id);
  }
  view.svgcontent = new XMLSerializer().serializeToString(doc);
  return ids;
}

/** Remove plain shapes (rect/text/line/…) by element id. Returns the ids removed. */
export function removeShapes(view: View, ids: string[]): string[] {
  const { doc } = parseSvg(view.svgcontent);
  const removed: string[] = [];
  for (const tag of ['rect', 'text', 'line', 'path', 'ellipse', 'circle', 'polyline', 'polygon', 'image']) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const id = el.getAttribute('id');
      if (id && ids.includes(id)) {
        el.parentNode?.removeChild(el);
        removed.push(id);
      }
    }
  }
  if (removed.length) view.svgcontent = new XMLSerializer().serializeToString(doc);
  return removed;
}

/** Remove the editor group with the given id. Returns false if not found. */
export function removeGroup(view: View, id: string): boolean {
  const { doc } = parseSvg(view.svgcontent);
  const all = Array.from(doc.getElementsByTagName('g'));
  const g = all.find((el) => el.getAttribute('id') === id);
  if (!g) return false;
  g.parentNode?.removeChild(g);
  view.svgcontent = new XMLSerializer().serializeToString(doc);
  return true;
}

export interface Box { x: number; y: number; width: number; height: number }

/** Position and size of an item, read from its group in svgcontent. */
export function itemBoxes(view: View): Record<string, Box> {
  const { doc } = parseSvg(view.svgcontent);
  const boxes: Record<string, Box> = {};
  for (const g of Array.from(doc.getElementsByTagName('g'))) {
    const id = g.getAttribute('id');
    if (!id || !view.items[id]) continue;
    const shape = Array.from(g.childNodes).find((n) => n.nodeType === 1 && (n.nodeName === 'foreignObject' || n.nodeName === 'rect')) as XElement | undefined;
    if (!shape) continue;
    boxes[id] = {
      x: Number(shape.getAttribute('x')), y: Number(shape.getAttribute('y')),
      width: Number(shape.getAttribute('width')), height: Number(shape.getAttribute('height')),
    };
  }
  return boxes;
}

/** Widget catalog name from a stored address (…/_widgets/openbridge/ob-pump.svg -> ob-pump). */
export function widgetNameFromAddress(address: unknown): string | undefined {
  if (typeof address !== 'string') return undefined;
  const m = address.match(/([^/]+)\.svg$/);
  return m ? m[1] : undefined;
}

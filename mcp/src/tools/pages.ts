/** Page (view) tools: OpenBridge widgets on the P&ID grid. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlaceSpec, PropertyValue } from '../services/pages.js';
import type { ShapeSpec } from '../fuxa/view.js';
import { EVENT_ACTIONS, EVENT_TRIGGERS, type AnimationSpec, type EventSpec } from '../fuxa/interaction.js';
import { itemLine, ok, RELOAD_NOTE, run, ViewRef, type Ctx } from './common.js';

const NodeSchema = z.object({
  x: z.number().int().min(0).describe('Grid column (node x). Pixel = x * 24.'),
  y: z.number().int().min(0).describe('Grid row (node y). Pixel = y * 24.'),
}).strict();

const PropertyValueSchema = z.union([
  z.string(), z.number(), z.boolean(),
  z.object({ tag: z.string().nullable().describe('Tag reference: "Device.Tag", a unique tag name or a tag id. null removes the binding.') }).strict(),
]);

const PropertiesSchema = z.record(z.string(), PropertyValueSchema).describe(
  'Widget properties by name, with or without prefix (e.g. "_pb_running" or "running"). ' +
  'Fixed value: "down", 50, true. Tag binding: {"tag": "P101.Run"}. See scadacraft_list_widgets for each widget\'s properties.',
);

export function registerPageTools(server: McpServer, ctx: Ctx): void {
  server.registerTool('scadacraft_list_widgets', {
    title: 'List OpenBridge widgets',
    description: `List the OpenBridge widgets available in ScadaCraft, grouped in libraries like the OpenBridge design system:
  automation (P&ID equipment and pipes), instruments (gauges, instrument field, trend), charts (live line/area, pie, donut, radial bars),
  controls (command button, start/stop and toggle switches, setpoint slider, number input, mode selector, check button, OK/NOK),
  alerts (alert icon, alert button with counter, alert frame, status indicator, badge, tag label, clock).

  Placement model (read once before placing widgets): the page uses a 24 px grid of nodes (x, y).
  - automation widgets (layout "anchor") put their anchor on a node: devices = centre of the icon; tank = top-centre of the body;
    readout = end of its tick; straight pipes and flow arrow = start of the axis (left/top); elbow/tee/cross/end = centre of the fitting.
    Device icons are one cell in radius: a pipe that reaches a device stops one node before its anchor, the next pipe starts one node after.
  - every other widget is anchored at its top-left corner and can be given any size in cells (scadacraft_place_widgets "size").
  Property direction: read = tag -> widget; write = command written by the widget; rw = shown and written by the operator
  (bind the setpoint/state tag once, e.g. slider _pn_value, toggle switch _pb_value).

  Args:
    - widget (string, optional): return only this widget (e.g. "ob-pump")
    - category (string, optional): automation | instruments | charts | controls | alerts
    - response_format ('markdown' | 'json'): default markdown

  Returns: grid size, OpenBridge version, libraries and, per widget: name, title, category, layout, anchor {x,y} px,
  default size {width,height} px, stretch axis (pipes), properties [{name, type, default, dir, description}].`,
    inputSchema: {
      widget: z.string().optional().describe('Widget name, e.g. "ob-pump"'),
      category: z.enum(['automation', 'instruments', 'charts', 'controls', 'alerts']).optional().describe('Only widgets of this library'),
      response_format: z.enum(['markdown', 'json']).default('markdown'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ widget, category, response_format }) => run(async () => {
    const cat = await ctx.pages.getCatalog();
    let widgets = widget ? [await ctx.pages.getWidget(widget)] : cat.widgets;
    if (category) widgets = widgets.filter((w) => w.category === category);
    const structured = { grid: cat.grid, openbridge: cat.openbridge, categories: cat.categories, widgets };
    if (response_format === 'json') return ok(JSON.stringify(structured, null, 2), structured);
    const lines = [`# OpenBridge widgets (grid ${cat.grid} px, OpenBridge ${cat.openbridge})`, ''];
    for (const c of cat.categories ?? []) {
      const ws = widgets.filter((w) => w.category === c.key);
      if (!ws.length) continue;
      lines.push(`# ${c.title}`, c.description, '');
      for (const w of ws) {
        lines.push(`## ${w.widget} — ${w.title}${w.category === 'automation' ? ` (${w.group})` : ''}`);
        lines.push(w.layout === 'anchor'
          ? `anchor (${w.anchor.x}, ${w.anchor.y}) px, box ${w.size.width}x${w.size.height} px${w.stretch ? `, length along ${w.stretch} in cells` : ''}`
          : `top-left anchored, default box ${w.size.width / cat.grid}x${w.size.height / cat.grid} cells (${w.size.width}x${w.size.height} px), resizable`);
        for (const p of w.properties) {
          const dir = p.dir === 'rw' ? ' (read/write)' : p.dir === 'write' || (!p.dir && p.write) ? ' (write)' : '';
          lines.push(`- \`${p.name}\` ${p.type}${dir}, default ${p.default || '—'}: ${p.description}`);
        }
        lines.push('');
      }
    }
    return ok(lines.join('\n'), structured);
  }));

  server.registerTool('scadacraft_list_views', {
    title: 'List views',
    description: `List the pages (views) of the ScadaCraft project.

  Returns: for each view its id, name, size in px and in grid nodes, and number of items.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const project = await ctx.pages.getProject();
    const views = ctx.pages.views(project).map((v) => ({
      id: v.id, name: v.name, width: v.profile.width, height: v.profile.height,
      nodes: { x: Math.floor(v.profile.width / 24), y: Math.floor(v.profile.height / 24) }, items: Object.keys(v.items ?? {}).length,
    }));
    const text = views.length
      ? views.map((v) => `- **${v.name}** (\`${v.id}\`): ${v.width}x${v.height} px = ${v.nodes.x}x${v.nodes.y} nodes, ${v.items} items`).join('\n')
      : 'The project has no views.';
    return ok(text, { views });
  }));

  server.registerTool('scadacraft_get_view', {
    title: 'Get view',
    description: `Show the items placed on a view: id, widget, anchor node, box and bindings (tags or fixed values).
  Use it to check a layout, find item ids for scadacraft_set_properties / scadacraft_remove_items, or continue a drawing.

  Args:
    - view (string): view name or id

  Returns: view size and the list of items. Items that are not OpenBridge widgets are listed with their type.`,
    inputSchema: { view: ViewRef },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ view }) => run(async () => {
    const project = await ctx.pages.getProject();
    const v = ctx.pages.findView(project, view);
    const items = await ctx.pages.describeItems(v);
    const header = `# ${v.name} (\`${v.id}\`) — ${v.profile.width}x${v.profile.height} px, ${items.length} items`;
    return ok([header, '', ...items.map(itemLine)].join('\n'), { id: v.id, name: v.name, profile: v.profile, items });
  }));

  server.registerTool('scadacraft_create_view', {
    title: 'Create view',
    description: `Create a new empty page (view). For P&ID pages use sizes that are multiples of 24 px.

  Args:
    - name (string): unique view name
    - width, height (number): size in px (default 1152 x 768 = 48 x 32 nodes)
    - background (string): background colour, e.g. "#ffffffff"

  Returns: the new view id and size. Error if the name already exists.`,
    inputSchema: {
      name: z.string().min(1).max(100),
      width: z.number().int().min(240).max(7680).default(1152),
      height: z.number().int().min(240).max(4320).default(768),
      background: z.string().default('#ffffffff'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, width, height, background }) => run(async () => {
    const v = await ctx.pages.createView(name, width, height, background);
    return ok(`Created view **${v.name}** (\`${v.id}\`), ${width}x${height} px = ${Math.floor(width / 24)}x${Math.floor(height / 24)} nodes.`,
      { id: v.id, name: v.name, width, height });
  }));

  server.registerTool('scadacraft_place_widgets', {
    title: 'Place widgets',
    description: `Place one or more OpenBridge widgets on a view, each with its anchor on a grid node, and optionally bind their properties.
  All widgets are added in a single save. Use scadacraft_draw_pipe for pipe runs with bends.

  Args:
    - view (string): view name or id
    - widgets (array, 1-200): each item
        - widget (string): catalog name, e.g. "ob-pump", "ob-tank", "ob-valve-analog", "ob-line-tee"
        - node {x, y}: grid node for the widget's anchor (top-left corner for non-P&ID widgets)
        - length (number, optional): straight pipes only, length in cells
        - size {width, height} (optional): box in cells, for instruments/charts/controls/alerts
        - name (string, optional): item name shown in the editor
        - properties (object, optional): fixed values or {"tag": "Device.Tag"} bindings

  Example: pump P-101 on node (12,6), running feedback and command bound to tags, readout below:
    {"widget":"ob-pump","node":{"x":12,"y":6},"name":"P-101",
     "properties":{"running":{"tag":"P101.Run"},"command":{"tag":"P101.Cmd"},"tag":"101","labelDirection":"down"}}
  Imported library widgets (scadacraft_import_widgets) are placed the same way with "group/file" as widget name.
  Example: setpoint slider 12x2 cells at node (2,20) writing the speed setpoint:
    {"widget":"ob-slider","node":{"x":2,"y":20},"size":{"width":12,"height":2},"properties":{"value":{"tag":"P101.SpeedSP"},"max":1500}}

  Returns: the created items (id, node, box, bindings) and warnings (e.g. box partly outside the view).
  ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      widgets: z.array(z.object({
        widget: z.string().min(1),
        node: NodeSchema,
        length: z.number().int().min(1).max(200).optional(),
        size: z.object({ width: z.number().int().min(1).max(200), height: z.number().int().min(1).max(200) }).strict().optional()
          .describe('Box size in grid cells (non-P&ID widgets only)'),
        name: z.string().max(100).optional(),
        properties: PropertiesSchema.optional(),
      }).strict()).min(1).max(200),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, widgets }) => run(async () => {
    const res = await ctx.pages.placeWidgets(view, widgets as PlaceSpec[]);
    const lines = [`Placed ${res.placed.length} widget(s) on **${res.view.name}**:`, ...res.placed.map(itemLine)];
    if (res.warnings.length) lines.push('', 'Warnings:', ...res.warnings.map((w) => `- ${w}`));
    lines.push('', RELOAD_NOTE);
    return ok(lines.join('\n'), { view: res.view.name, placed: res.placed, warnings: res.warnings });
  }));

  server.registerTool('scadacraft_draw_pipe', {
    title: 'Draw pipe',
    description: `Draw a pipe along an orthogonal path of grid nodes: straight pipes between consecutive nodes and elbows at every bend.

  Rules: consecutive nodes must share x or y (no diagonals). End the path one node before a device anchor and start the
  next path one node after it (the device icon fills the gap). Use scadacraft_place_widgets for tees, crosses, crossovers,
  pipe ends and flow arrows.

  Args:
    - view (string): view name or id
    - path (array of {x, y}, 2-100): nodes in order, e.g. [{"x":4,"y":4},{"x":4,"y":2},{"x":10,"y":2}]
    - medium: normal | water | air | empty (default water)
    - fluid (optional): colour from the OpenBridge palette for water/air pipes: fresh-water, sea-water, waste, masses, fuel, oil,
      steam, hot, cold, air-ventilation, acid-alkalis, fire-fighting, flammable-gas, non-flammable-gas
    - line_type: fluid | electric | air | connector (default fluid)
    - bindings (optional): bind medium/fluid to tags, e.g. {"medium": {"tag": "P101.FlowMedium"}}

  Returns: the created pipe items.
  ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      path: z.array(NodeSchema).min(2).max(100),
      medium: z.enum(['normal', 'water', 'air', 'empty']).default('water'),
      fluid: z.enum(['fresh-water', 'sea-water', 'waste', 'masses', 'fuel', 'oil', 'steam', 'hot', 'cold', 'air-ventilation',
        'acid-alkalis', 'fire-fighting', 'flammable-gas', 'non-flammable-gas']).optional(),
      line_type: z.enum(['fluid', 'electric', 'air', 'connector']).default('fluid'),
      bindings: PropertiesSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, path, medium, fluid, line_type, bindings }) => run(async () => {
    const props: Record<string, PropertyValue> = { _ps_medium: medium, _ps_lineType: line_type, ...(fluid ? { _ps_fluid: fluid } : {}), ...(bindings as Record<string, PropertyValue> ?? {}) };
    const specs = await ctx.pages.pipeSpecs(path, props);
    const res = await ctx.pages.placeWidgets(view, specs);
    const lines = [`Drew a pipe of ${path.length} nodes on **${res.view.name}** (${res.placed.length} items):`, ...res.placed.map(itemLine)];
    if (res.warnings.length) lines.push('', 'Warnings:', ...res.warnings.map((w) => `- ${w}`));
    lines.push('', RELOAD_NOTE);
    return ok(lines.join('\n'), { view: res.view.name, placed: res.placed, warnings: res.warnings });
  }));

  server.registerTool('scadacraft_set_properties', {
    title: 'Set widget properties',
    description: `Set fixed values or tag bindings on a widget already placed on a view.

  Args:
    - view (string): view name or id
    - item_id (string): item id from scadacraft_get_view
    - properties (object): e.g. {"running": {"tag": "P101.Run"}, "alarm": {"tag": "P101.Fault"}, "labelDirection": "right"}
      Use {"tag": null} to remove a binding.

  Returns: the item with its updated bindings.
  ${RELOAD_NOTE}`,
    inputSchema: { view: ViewRef, item_id: z.string().min(1), properties: PropertiesSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ view, item_id, properties }) => run(async () => {
    const item = await ctx.pages.setProperties(view, item_id, properties as Record<string, PropertyValue>);
    return ok(`Updated:\n${itemLine(item)}\n\n${RELOAD_NOTE}`, { item });
  }));

  server.registerTool('scadacraft_remove_items', {
    title: 'Remove items',
    description: `Remove items from a view by id (see scadacraft_get_view).

  Args:
    - view (string): view name or id
    - item_ids (array of string): ids to remove

  Returns: removed ids and ids that were not found.`,
    inputSchema: { view: ViewRef, item_ids: z.array(z.string().min(1)).min(1).max(500) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ view, item_ids }) => run(async () => {
    const res = await ctx.pages.removeItems(view, item_ids);
    return ok(`Removed ${res.removed.length} item(s).${res.missing.length ? ` Not found: ${res.missing.join(', ')}.` : ''}`, res);
  }));

  server.registerTool('scadacraft_delete_view', {
    title: 'Delete view',
    description: `Delete a whole view and everything on it. This cannot be undone from here.

  Args:
    - view (string): view name or id

  Returns: the deleted view id and name.`,
    inputSchema: { view: ViewRef },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ view }) => run(async () => {
    const v = await ctx.pages.deleteView(view);
    return ok(`Deleted view **${v.name}** (\`${v.id}\`).`, { id: v.id, name: v.name });
  }));

  server.registerTool('scadacraft_update_view', {
    title: 'Update view',
    description: `Rename a view or change its size or background.

Args:
  - view (string): view name or id
  - name (string, optional): new unique name
  - width, height (number, optional): new size in px (multiples of 24 for P&ID pages)
  - background (string, optional): background colour, e.g. "#ffffffff"

Returns: the updated view.
${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      name: z.string().min(1).max(100).optional(),
      width: z.number().int().min(240).max(7680).optional(),
      height: z.number().int().min(240).max(4320).optional(),
      background: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ view, name, width, height, background }) => run(async () => {
    const v = await ctx.pages.updateView(view, { name, width, height, background });
    return ok(`View **${v.name}** (\`${v.id}\`): ${v.profile.width}x${v.profile.height} px, background ${v.profile.bkcolor}.`,
      { id: v.id, name: v.name, profile: v.profile });
  }));

  server.registerTool('scadacraft_duplicate_view', {
    title: 'Duplicate view',
    description: `Copy a view, with all its items and bindings, under a new name (same as "clone view" in the editor).
Useful to create a page per plant or station from a template, then rebind its tags with scadacraft_set_properties.

Args:
  - view (string): source view name or id
  - new_name (string): name of the copy

Returns: the new view id and name.`,
    inputSchema: { view: ViewRef, new_name: z.string().min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, new_name }) => run(async () => {
    const v = await ctx.pages.duplicateView(view, new_name);
    return ok(`Created **${v.name}** (\`${v.id}\`) with ${Object.keys(v.items).length} items.`, { id: v.id, name: v.name });
  }));

  // ---------------------------------------------------------------- widget library (import)
  server.registerTool('scadacraft_list_library_widgets', {
    title: 'List editor widget library',
    description: `List the widget library of the editor (Widgets panel): every group and its SVG widgets, the built-in
  OpenBridge libraries and the widgets imported by users. With "widget", describe one widget: size and bindable properties.

  Args:
    - group (string, optional): only this group (folder name)
    - widget (string, optional): "group/file" (or file name when unique) to describe

  Returns: groups [{name, label, items [{path, name, label}]}], or the widget description.
  Imported widgets are placed with scadacraft_place_widgets using "group/file" as widget name (top-left on the node).`,
    inputSchema: {
      group: z.string().optional(),
      widget: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ group, widget }) => run(async () => {
    if (widget) {
      const w = await ctx.pages.describeLibraryWidget(widget);
      const lines = [`## ${w.widget} — ${w.title}`, `file ${w.file}, box ${w.size.width}x${w.size.height} px, ${w.layout === 'anchor' ? `anchor (${w.anchor.x}, ${w.anchor.y})` : 'top-left anchored'}`];
      for (const p of w.properties) lines.push(`- \`${p.name}\` ${p.type}, default ${p.default || '—'}${p.description ? `: ${p.description}` : ''}`);
      if (!w.properties.length) lines.push('(no bindable properties)');
      return ok(lines.join('\n'), { widget: w });
    }
    let groups = await ctx.pages.library();
    if (group) groups = groups.filter((g) => g.name.toLowerCase() === group.toLowerCase());
    const lines: string[] = [];
    for (const g of groups) {
      lines.push(`## ${g.label ?? g.name} (\`${g.name}\`, ${g.items.length})`);
      for (const i of g.items) lines.push(`- \`${i.path.replace(/^_widgets\//, '').replace(/\.svg$/, '')}\`${i.label ? ` ${i.label}` : ''}`);
    }
    return ok(lines.join('\n') || '(no widgets)', { groups });
  }));

  server.registerTool('scadacraft_import_widgets', {
    title: 'Import widgets into the library',
    description: `Import SVG widgets in the native FUXA/ScadaCraft format into a group of the editor's widget library
  (same as the Widgets panel import). A widget is an SVG with a <script> whose //!export-start ... //!export-end section declares
  bindable variables: _pb_ boolean, _pn_ number, _ps_ string, _pc_ colour; putValue(id, value) receives tag values and
  postValue(id, value) writes to the bound tag. The import reports each widget's properties.

  Args:
    - group (string): library group (folder), e.g. "Impianto" — created if missing; OpenBridge groups are reserved
    - paths (string[], optional): .svg files or folders of .svg files on the machine running the MCP server
    - svg (string, optional) + name (string): widget content given inline
    - overwrite (boolean, default false): replace widgets with the same name

  Returns: imported widgets (path, size, properties) and warnings (no script, no variables, skipped).
  Then place them with scadacraft_place_widgets {"widget": "group/file", "node": {...}, "size": {...}, "properties": {...}}.`,
    inputSchema: {
      group: z.string().min(1).max(64),
      paths: z.array(z.string().min(1)).max(200).optional(),
      svg: z.string().max(5_000_000).optional(),
      name: z.string().max(100).optional(),
      overwrite: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const r = await ctx.pages.importWidgets(input);
    const lines = [`Imported ${r.imported.length} widget(s) into **${input.group}**:`,
      ...r.imported.map((i) => `- \`${i.path.replace(/^_widgets\//, '').replace(/\.svg$/, '')}\` ${i.size.width}x${i.size.height} px — ${i.properties.join(', ') || 'no properties'}`)];
    if (r.warnings.length) lines.push('', 'Warnings:', ...r.warnings.map((w) => `- ${w}`));
    lines.push('', 'Reload the editor to see them in the Widgets panel.');
    return ok(lines.join('\n'), r);
  }));

  server.registerTool('scadacraft_remove_library_widgets', {
    title: 'Remove widgets from the library',
    description: `Delete imported widgets from the editor library ("group/file"). Pages that already use them keep working
  (a placed widget stores its own copy). Built-in OpenBridge widgets cannot be removed.`,
    inputSchema: { widgets: z.array(z.string().min(1)).min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ widgets }) => run(async () => {
    const removed = await ctx.pages.removeLibraryWidgets(widgets);
    return ok(`Removed ${removed.length} widget(s): ${removed.join(', ')}`, { removed });
  }));

  // ---------------------------------------------------------------- native charts and trend pages
  const ChartOptionsSchema = {
    mode: z.enum(['realtime', 'history']).default('realtime')
      .describe('realtime: rolling window of live values (filled from history at open); history: time-range toolbar and zoom on stored data'),
    minutes: z.number().int().min(1).max(10080).optional().describe('realtime window in minutes (default 60)'),
    load_history: z.boolean().optional().describe('realtime: fill the window from the history when the page opens (default true)'),
    title: z.string().max(100).optional(),
    legend: z.enum(['always', 'follow', 'bottom', 'never']).optional(),
    decimals: z.number().int().min(0).max(6).optional(),
    background: z.string().optional().describe('chart background, e.g. "#FFFFFF" or "rgba(0,0,0,0)"'),
    text_color: z.string().optional().describe('axis and label colour'),
    grid_color: z.string().optional(),
  };

  server.registerTool('scadacraft_place_chart', {
    title: 'Place trend chart',
    description: `Place ScadaCraft's trend chart control on a view, showing the pens of a chart definition
  (create or change pens with scadacraft_set_chart: tags, labels, colours, Y axes). Tags need history (DAQ) enabled for past data.

  Args:
    - view (string), chart (string): chart definition name or id
    - node {x, y}: top-left grid node; size {width, height} in cells (default 16 x 10)
    - mode realtime | history, minutes, load_history, title, legend, decimals, background, text_color, grid_color, name

  Returns: the created item. ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      chart: z.string().min(1),
      node: NodeSchema,
      size: z.object({ width: z.number().int().min(4).max(200), height: z.number().int().min(3).max(200) }).strict().optional(),
      name: z.string().max(100).optional(),
      ...ChartOptionsSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, ...spec }) => run(async () => {
    const r = await ctx.pages.placeChart(view, spec);
    const lines = [`Placed chart on **${r.view.name}**:`, itemLine(r.placed)];
    if (r.warnings.length) lines.push('', 'Warnings:', ...r.warnings.map((w) => `- ${w}`));
    lines.push('', RELOAD_NOTE);
    return ok(lines.join('\n'), { view: r.view.name, placed: r.placed, warnings: r.warnings });
  }));

  server.registerTool('scadacraft_create_trend_page', {
    title: 'Create trend page',
    description: `One step trend page: chart definition with the given tags, a new view with the chart filling it, and
  (optionally) a menu entry. Tags without history are reported (enable it with scadacraft_update_tags {history:{enabled:true}}).

  Args:
    - name (string): page name (also the chart definition name unless "chart" is given)
    - tags (array, optional): pens [{tag: "Device.Tag", label?, color?, yaxis? 1-4}] — required unless "chart" names an existing definition
    - chart (string, optional): use this existing chart definition
    - width, height (px, default 1440 x 840), background (default "#FFFFFF")
    - menu (object | false, default {}): {text?, icon?} adds a menu entry to the page ("show_chart" icon); false = no entry
    - mode, minutes, load_history, title, legend, decimals, text_color, grid_color: chart options (see scadacraft_place_chart)

  Returns: view, chart definition, chart item, warnings.`,
    inputSchema: {
      name: z.string().min(1).max(80),
      tags: z.array(z.object({
        tag: z.string().min(1), label: z.string().optional(), color: z.string().optional(), yaxis: z.number().int().min(1).max(4).optional(),
      }).strict()).max(20).optional(),
      chart: z.string().optional(),
      width: z.number().int().min(480).max(7680).default(1440),
      height: z.number().int().min(320).max(4320).default(840),
      menu: z.union([z.literal(false), z.object({ text: z.string().optional(), icon: z.string().optional() }).strict()]).default({}),
      ...ChartOptionsSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => run(async () => {
    const warnings: string[] = [];
    let chartName = input.chart;
    if (input.tags?.length) {
      const c = await ctx.admin.setChart({ name: input.chart ?? input.name, lines: input.tags });
      chartName = String(c.name);
    }
    if (!chartName) throw new Error('Give "tags" (pens of a new chart) or "chart" (an existing chart definition).');
    const project = await ctx.pages.getProject();
    const chartDef = ((project as unknown as { charts?: { name: string; lines: { id: string; name: string }[] }[] }).charts ?? [])
      .find((c) => c.name.toLowerCase() === chartName!.toLowerCase());
    if (chartDef) {
      const tagsById = new Map<string, { daq?: { enabled?: boolean } }>();
      for (const d of Object.values(project.devices ?? {})) for (const t of Object.values((d as { tags?: Record<string, { id: string; daq?: { enabled?: boolean } }> }).tags ?? {})) tagsById.set(t.id, t);
      const noHistory = chartDef.lines.filter((l) => !tagsById.get(l.id)?.daq?.enabled).map((l) => l.name);
      if (noHistory.length) warnings.push(`No history on ${noHistory.join(', ')}: the chart shows only live values from page open.`);
    }
    const view = await ctx.pages.createView(input.name, input.width, input.height, input.background ?? '#FFFFFF');
    const g = 24;
    const r = await ctx.pages.placeChart(view.id, {
      chart: chartName, node: { x: 0, y: 0 },
      size: { width: Math.floor(input.width / g), height: Math.floor(input.height / g) },
      mode: input.mode, minutes: input.minutes, load_history: input.load_history, title: input.title ?? input.name,
      legend: input.legend, decimals: input.decimals, background: input.background ?? '#FFFFFF', text_color: input.text_color, grid_color: input.grid_color,
    });
    warnings.push(...r.warnings);
    let menu = 'no menu entry';
    if (input.menu !== false) {
      const m = await ctx.admin.addMenuItem({ text: input.menu.text ?? input.name, view: input.name, icon: input.menu.icon ?? 'show_chart' });
      menu = m.added ? 'menu entry added' : 'menu entry already present';
    }
    const lines = [`Created trend page **${input.name}** (\`${view.id}\`) with chart "${chartName}" (${input.mode}), ${menu}.`];
    if (warnings.length) lines.push('', 'Warnings:', ...warnings.map((w) => `- ${w}`));
    lines.push('', `Open it at /home?viewName=${encodeURIComponent(input.name)}. ${RELOAD_NOTE}`);
    return ok(lines.join('\n'), { view: { id: view.id, name: input.name }, chart: chartName, item: r.placed, warnings });
  }));

  const Color = z.string().describe('"#RRGGBB", "rgb(...)" or an OpenBridge palette token that follows day/dusk/night: "ob:container-global" (card), "ob:container-section", "ob:container-background", "ob:border-outline", "ob:border-divider", "ob:element-active" (main text), "ob:element-neutral" (secondary text)');
  server.registerTool('scadacraft_draw_shapes', {
    title: 'Draw shapes and labels',
    description: `Draw plain editor shapes on a view: rectangles (cards, panels), texts (titles, labels, units) and lines (separators).
  They are the same elements the editor's drawing tools create, editable by hand afterwards. Use them to lay out
  a page around the widgets: a card is a rounded rect, its title a small uppercase text.

  Args:
    - view (string)
    - unit: "cell" (default, 24 px grid, fractions allowed) | "px"
    - shapes (array, 1-500), each one of:
        {type:"rect", x, y, width, height, radius? (px), fill?, stroke?, stroke_width?, opacity?}   (default card colours)
        {type:"text", x, y (baseline), text, size? (px, default 14), weight? normal|bold|600, color?, anchor? start|middle|end, uppercase?}
        {type:"line", x1, y1, x2, y2, stroke?, stroke_width?}
  Colours accept OpenBridge palette tokens ("ob:container-global", "ob:element-neutral", ...) so the page follows the theme.

  Returns: the element ids (remove them with scadacraft_remove_items). Draw the cards before placing the widgets on them.
  ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      unit: z.enum(['cell', 'px']).default('cell'),
      shapes: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('rect'), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
          radius: z.number().min(0).optional(), fill: Color.optional(), stroke: Color.optional(), stroke_width: z.number().min(0).optional(),
          opacity: z.number().min(0).max(1).optional() }).strict(),
        z.object({ type: z.literal('text'), x: z.number(), y: z.number(), text: z.string().min(1).max(500),
          size: z.number().min(4).max(200).optional(), weight: z.union([z.enum(['normal', 'bold']), z.number().int().min(100).max(900)]).optional(),
          color: Color.optional(), anchor: z.enum(['start', 'middle', 'end']).optional(), font: z.string().optional(),
          uppercase: z.boolean().optional() }).strict(),
        z.object({ type: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
          stroke: Color.optional(), stroke_width: z.number().min(0).optional() }).strict(),
      ])).min(1).max(500),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, unit, shapes }) => run(async () => {
    const r = await ctx.pages.drawShapes(view, shapes as ShapeSpec[], unit);
    return ok(`Drew ${r.ids.length} shape(s) on **${r.view.name}**: ${r.ids.join(', ')}\n\n${RELOAD_NOTE}`, { view: r.view.name, ids: r.ids });
  }));

  // ------------------------------------------------------------------ events, animations, native controls
  const EventSchema = z.object({
    on: z.enum(EVENT_TRIGGERS).default('click').describe('Mouse trigger, default click'),
    action: z.enum(EVENT_ACTIONS),
    page: z.string().optional().describe('open_page / open_popup / open_card: page name or id'),
    tag: z.string().optional().describe('set_value / toggle_value: "Device.Tag" (default: the item\'s own tag, for value/button/shape)'),
    value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('set_value: value to write (or amount for add/remove)'),
    mode: z.enum(['set', 'add', 'remove']).optional().describe('set_value: write (default), add to or subtract from the current value'),
    bit: z.number().int().min(0).max(31).optional().describe('toggle_value: toggle only this bit'),
    script: z.string().optional().describe('run_script: script name or id (scadacraft_list_scripts)'),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('run_script: parameter values by name (tagid parameters take "Device.Tag")'),
    url: z.string().optional().describe('open_link: URL'),
    new_tab: z.boolean().optional(),
    x: z.number().optional().describe('open_card: left, px'),
    y: z.number().optional().describe('open_card: top, px'),
    relative_to: z.enum(['window', 'mouse']).optional().describe('open_card: position relative to the window (default) or the mouse'),
    single: z.boolean().optional().describe('open_card: close the other cards first'),
    hide_close: z.boolean().optional().describe('open_popup / open_card: no close button (put a button with action "close" on that page)'),
  }).strict();
  const EVENT_HELP = `Each event: {on? (click|dblclick|mousedown|mouseup|mouseover|mouseout, default click), action, ...}
    action "open_page"    {page}                         navigate to another page
    action "open_popup"   {page, hide_close?}            modal popup showing that page
    action "open_card"    {page, x?, y?, relative_to?, single?, hide_close?}   floating, draggable window
    action "close"                                       close the popup/card this item is in
    action "set_value"    {tag?, value, mode? set|add|remove}   write a tag (e.g. setpoint +1, start command)
    action "toggle_value" {tag?, bit?}                   invert a boolean / one bit
    action "run_script"   {script, params?}              run a server/client script
    action "open_link"    {url, new_tab?}`;

  server.registerTool('scadacraft_set_events', {
    title: 'Set click events',
    description: `Make any item on a page interactive, like the editor's "Events" tab: OpenBridge widgets, charts, value displays,
  buttons and plain shapes (rect/text/circle/path/line drawn with scadacraft_draw_shapes or in the editor).
  Typical: click on a pump → open its faceplate popup; click on a card → go to the detail page; button → write a tag.

  Args:
    - view, item_id (from scadacraft_get_view, or a shape id from scadacraft_draw_shapes)
    - events (array, 0-20; [] removes all events)
    - append (default false: replace the existing events)
  ${EVENT_HELP}

  Events work in the runtime (/home); in the editor they are only stored. ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      item_id: z.string().min(1),
      events: z.array(EventSchema).max(20),
      append: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ view, item_id, events, append }) => run(async () => {
    const item = await ctx.pages.setEvents(view, item_id, events as EventSpec[], append);
    return ok(`Events of \`${item_id}\`:\n${itemLine(item)}\n\n${RELOAD_NOTE}`, { item });
  }));

  const AnimColor = z.string().describe('Fixed colour "#RRGGBB" / "rgb(...)" (animated colours cannot be ob: tokens)');
  server.registerTool('scadacraft_animate_shape', {
    title: 'Animate a shape',
    description: `Animate a plain shape (rect, circle, ellipse, path, line, text) with tag values, like the editor's shape properties:
  colour by value ranges, blink, hide/show, rotate by value, continuous spin, move. Good for status lamps, level bars,
  tank fill colours, fans, simple indicators drawn with scadacraft_draw_shapes. (OpenBridge widgets animate through their own properties.)

  Args:
    - view, shape_id
    - tag: "Device.Tag" for the colours (and default for actions); null removes it
    - colors: [{min, max, fill?, stroke?}] — first matching range wins (later ones override). E.g. 0..0 grey, 1..1 green
    - actions: [{type, tag?, min? (default 1), max? (default = min), bit?, ...}]
        blink {fill_a?, fill_b?, stroke_a?, stroke_b?, interval? ms}   while the value is in range
        hide / show                                                     while in range
        rotate {min_angle, max_angle}                                   angle proportional to the value
        spin_clockwise / spin_anticlockwise / stop                      continuous rotation while in range
        move {x, y, duration?}                                          translate to x, y px while in range
    - base_fill / base_stroke: colour before the first value arrives
  Omitted colors/actions are kept. Colour animation replaces the shape's ob: token colours with fixed ones.
  ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      shape_id: z.string().min(1),
      tag: z.string().nullable().optional(),
      colors: z.array(z.object({ min: z.number(), max: z.number(), fill: AnimColor.optional(), stroke: AnimColor.optional() }).strict()).max(20).optional(),
      actions: z.array(z.object({
        type: z.enum(['blink', 'hide', 'show', 'rotate', 'spin_clockwise', 'spin_anticlockwise', 'stop', 'move']),
        tag: z.string().optional(), min: z.number().optional(), max: z.number().optional(), bit: z.number().int().min(0).max(31).optional(),
        fill_a: AnimColor.optional(), fill_b: AnimColor.optional(), stroke_a: AnimColor.optional(), stroke_b: AnimColor.optional(),
        interval: z.number().int().min(100).max(10000).optional(),
        min_angle: z.number().optional(), max_angle: z.number().optional(),
        x: z.number().optional(), y: z.number().optional(), duration: z.number().int().min(0).optional(),
      }).strict()).max(10).optional(),
      base_fill: AnimColor.optional(),
      base_stroke: AnimColor.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ view, shape_id, ...input }) => run(async () => {
    const item = await ctx.pages.animateShape(view, shape_id, { ...input, actions: input.actions as AnimationSpec[] | undefined });
    return ok(`Animation of \`${shape_id}\`:\n${itemLine(item)}\n\n${RELOAD_NOTE}`, { item });
  }));

  server.registerTool('scadacraft_place_value', {
    title: 'Place a value display',
    description: `Place the native value display (editor "Value" control): a text showing a tag value with unit and decimals,
  e.g. "12.4 bar". Lighter than an OpenBridge instrument; good inside tables and cards.

  Args:
    - view, x, y (text anchor point; with anchor "middle" the centre of the text baseline), unit: "cell" (default) | "px"
    - tag, value_unit? (text after the value), decimals?, size? (px, default 14), color? (hex or ob: token), anchor? start|middle|end (default middle), weight?
    - events? (same as scadacraft_set_events)
  ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      x: z.number(), y: z.number(),
      unit: z.enum(['cell', 'px']).default('cell'),
      tag: z.string().min(1),
      value_unit: z.string().max(20).optional(),
      decimals: z.number().int().min(0).max(10).optional(),
      size: z.number().min(4).max(200).optional(),
      color: z.string().optional(),
      anchor: z.enum(['start', 'middle', 'end']).optional(),
      weight: z.enum(['normal', 'bold']).optional(),
      name: z.string().optional(),
      events: z.array(EventSchema).max(20).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, unit, value_unit, ...spec }) => run(async () => {
    const item = await ctx.pages.placeValue(view, { ...spec, unit: value_unit, events: spec.events as EventSpec[] | undefined }, unit);
    return ok(`Placed value display:\n${itemLine(item)}\n\n${RELOAD_NOTE}`, { item });
  }));

  server.registerTool('scadacraft_place_button', {
    title: 'Place a button',
    description: `Place the native button (editor "Button" control) with its click events: navigation, popups, tag writes, scripts.
  For an OpenBridge-styled command button with state feedback use the "ob-command-button" widget instead.

  Args:
    - view, x, y, width?, height? (default 4 x 1.5 cells), unit: "cell" (default) | "px"
    - text, background?, color? (hex or ob: token; default OpenBridge raised button), font_size?
    - tag? (own tag: target of set_value/toggle_value without "tag", and source of colors)
    - colors? [{min, max, fill? (background), stroke? (text colour)}] by the tag value
    - events (same as scadacraft_set_events; usually [{action:"set_value", value:1}] or [{action:"open_page", page:"Trend"}])
  ${EVENT_HELP}
  ${RELOAD_NOTE}`,
    inputSchema: {
      view: ViewRef,
      x: z.number(), y: z.number(),
      width: z.number().positive().default(4), height: z.number().positive().default(1.5),
      unit: z.enum(['cell', 'px']).default('cell'),
      text: z.string().min(1).max(100),
      background: z.string().optional(), color: z.string().optional(),
      font_size: z.number().min(6).max(100).optional(),
      tag: z.string().optional(),
      colors: z.array(z.object({ min: z.number(), max: z.number(), fill: z.string().optional(), stroke: z.string().optional() }).strict()).max(20).optional(),
      name: z.string().optional(),
      events: z.array(EventSchema).max(20).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ view, unit, ...spec }) => run(async () => {
    const item = await ctx.pages.placeButton(view, { ...spec, events: spec.events as EventSpec[] | undefined }, unit);
    return ok(`Placed button:\n${itemLine(item)}\n\n${RELOAD_NOTE}`, { item });
  }));
}

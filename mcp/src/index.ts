#!/usr/bin/env node
/**
 * scadacraft-mcp-server
 *
 * MCP server for ScadaCraft: build HMI pages (P&ID process graphics with OpenBridge
 * components) on a running ScadaCraft server, bind them to tags, and manage server tags.
 *
 * Configuration (environment):
 *   SCADACRAFT_URL       ScadaCraft base URL (default http://127.0.0.1:1881)
 *   SCADACRAFT_USERNAME  admin user, only when ScadaCraft security is enabled
 *   SCADACRAFT_PASSWORD
 *   TRANSPORT            stdio (default) | http
 *   PORT                 HTTP port when TRANSPORT=http (default 3001)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScadaCraftClient } from './fuxa/client.js';
import { allTags, resolveTag } from './fuxa/tags.js';
import { ScadaCraftService, type PlacedItem, type PropertyValue } from './service.js';

const VERSION = '0.1.0';
const CHARACTER_LIMIT = 25000;
const HERE = dirname(fileURLToPath(import.meta.url));

const client = new ScadaCraftClient({
  url: process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881',
  username: process.env.SCADACRAFT_USERNAME,
  password: process.env.SCADACRAFT_PASSWORD,
});
const svc = new ScadaCraftService(client);

// ------------------------------------------------------------------ helpers
type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  if (text.length > CHARACTER_LIMIT) {
    text = `${text.slice(0, CHARACTER_LIMIT)}\n\n[truncated: use filters or pagination to narrow the result]`;
  }
  return { content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

function itemLine(i: PlacedItem): string {
  const b = Object.entries(i.bindings).map(([k, v]) => `${k}=${v}`).join(', ');
  return `- \`${i.id}\` ${i.widget}${i.name ? ` "${i.name}"` : ''} at node (${i.node.x}, ${i.node.y}), box ${i.box.width}x${i.box.height}${b ? ` — ${b}` : ''}`;
}

const RELOAD_NOTE = 'If the editor is open on this view, reload it to see the change (the editor keeps its own copy until reloaded).';

// ------------------------------------------------------------------ schemas
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

const ViewRef = z.string().min(1).describe('View name or id (see scadacraft_list_views).');

// ------------------------------------------------------------------ server
const server = new McpServer({ name: 'scadacraft-mcp-server', version: VERSION });

server.registerTool('scadacraft_list_widgets', {
  title: 'List OpenBridge widgets',
  description: `List the OpenBridge process-graphic widgets available in ScadaCraft, with their anchor, size and bindable properties.

Placement model (read once before placing widgets): the page uses a 24 px grid; every pipe connection is a grid node (x, y).
Each widget has an anchor that is put on a node: devices (pump, motor, fan, valves) = centre of the icon; tank = top-centre of the body;
readout = end of its tick; straight pipes and flow arrow = start of the axis (left/top); elbow/tee/cross/end = centre of the fitting.
Device icons are one cell in radius: a pipe that reaches a device stops one node before its anchor, the next pipe starts one node after.

Args:
  - widget (string, optional): return only this widget (e.g. "ob-pump")
  - response_format ('markdown' | 'json'): default markdown

Returns: grid size, OpenBridge version and, per widget: name, title, group (device|pipe), anchor {x,y} px, size {width,height} px,
stretch axis (pipes), properties [{name, type, default, write, description}]. Properties with write=true are commands written by the widget.`,
  inputSchema: {
    widget: z.string().optional().describe('Widget name, e.g. "ob-pump"'),
    response_format: z.enum(['markdown', 'json']).default('markdown'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ widget, response_format }) => run(async () => {
  const cat = await svc.getCatalog();
  const widgets = widget ? [await svc.getWidget(widget)] : cat.widgets;
  const structured = { grid: cat.grid, openbridge: cat.openbridge, widgets };
  if (response_format === 'json') return ok(JSON.stringify(structured, null, 2), structured);
  const lines = [`# OpenBridge widgets (grid ${cat.grid} px, OpenBridge ${cat.openbridge})`, ''];
  for (const w of widgets) {
    lines.push(`## ${w.widget} — ${w.title} (${w.group})`);
    lines.push(`anchor (${w.anchor.x}, ${w.anchor.y}) px, box ${w.size.width}x${w.size.height} px${w.stretch ? `, length along ${w.stretch} in cells` : ''}`);
    for (const p of w.properties) lines.push(`- \`${p.name}\` ${p.type}${p.write ? ' (write)' : ''}, default ${p.default || '—'}: ${p.description}`);
    lines.push('');
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
  const project = await svc.getProject();
  const views = svc.views(project).map((v) => ({
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
  const project = await svc.getProject();
  const v = svc.findView(project, view);
  const items = await svc.describeItems(v);
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
  const v = await svc.createView(name, width, height, background);
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
      - node {x, y}: grid node for the widget's anchor
      - length (number, optional): straight pipes only, length in cells
      - name (string, optional): item name shown in the editor
      - properties (object, optional): fixed values or {"tag": "Device.Tag"} bindings

Example: pump P-101 on node (12,6), running feedback and command bound to tags, readout below:
  {"widget":"ob-pump","node":{"x":12,"y":6},"name":"P-101",
   "properties":{"running":{"tag":"P101.Run"},"command":{"tag":"P101.Cmd"},"tag":"101","labelDirection":"down"}}

Returns: the created items (id, node, box, bindings) and warnings (e.g. box partly outside the view).
${RELOAD_NOTE}`,
  inputSchema: {
    view: ViewRef,
    widgets: z.array(z.object({
      widget: z.string().min(1),
      node: NodeSchema,
      length: z.number().int().min(1).max(200).optional(),
      name: z.string().max(100).optional(),
      properties: PropertiesSchema.optional(),
    }).strict()).min(1).max(200),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ view, widgets }) => run(async () => {
  const res = await svc.placeWidgets(view, widgets as { widget: string; node: { x: number; y: number }; length?: number; name?: string; properties?: Record<string, PropertyValue> }[]);
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
  const specs = await svc.pipeSpecs(path, props);
  const res = await svc.placeWidgets(view, specs);
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
  const item = await svc.setProperties(view, item_id, properties as Record<string, PropertyValue>);
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
  const res = await svc.removeItems(view, item_ids);
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
  const v = await svc.deleteView(view);
  return ok(`Deleted view **${v.name}** (\`${v.id}\`).`, { id: v.id, name: v.name });
}));

server.registerTool('scadacraft_list_tags', {
  title: 'List tags',
  description: `List the tags of the project (all devices, including ScadaCraft server memory tags) to find references for bindings.

Args:
  - query (string, optional): case-insensitive filter on "Device.Tag" and address
  - device (string, optional): only this device (name or id)
  - limit (1-500, default 100), offset (default 0)

Returns: total, and tags with ref ("Device.Tag", the value to use in {"tag": ...}), id, type, address, device type.`,
  inputSchema: {
    query: z.string().optional(),
    device: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ query, device, limit, offset }) => run(async () => {
  const project = await svc.getProject();
  let tags = allTags(project);
  if (device) tags = tags.filter((t) => t.device.toLowerCase() === device.toLowerCase() || t.deviceId === device);
  if (query) {
    const q = query.toLowerCase();
    tags = tags.filter((t) => t.ref.toLowerCase().includes(q) || (t.address ?? '').toLowerCase().includes(q));
  }
  const page = tags.slice(offset, offset + limit);
  const hasMore = tags.length > offset + page.length;
  const text = page.length
    ? [`${tags.length} tag(s)${hasMore ? `, showing ${offset + 1}-${offset + page.length}` : ''}:`,
      ...page.map((t) => `- \`${t.ref}\` (${t.type ?? '?'}${t.address ? `, ${t.address}` : ''}) [${t.deviceType}]`),
      ...(hasMore ? [`More: offset=${offset + page.length}`] : [])].join('\n')
    : 'No tags found.' + (project.devices && Object.keys(project.devices).length ? '' : ' The project has no devices yet.');
  return ok(text, { total: tags.length, count: page.length, offset, has_more: hasMore, tags: page });
}));

server.registerTool('scadacraft_create_server_tags', {
  title: 'Create server tags',
  description: `Create memory tags on the ScadaCraft server device ("FUXA Server"). Useful for simulation, setpoints and internal states.
Widgets can bind to them like any other tag (reference "FUXA Server.<name>").

Args:
  - tags (array, 1-200): each {name, type: number|boolean|string, init (optional initial value as text)}

Returns: created tags with ids. Error if a name already exists on the server device.`,
  inputSchema: {
    tags: z.array(z.object({
      name: z.string().min(1).max(100),
      type: z.enum(['number', 'boolean', 'string']),
      init: z.string().optional(),
    }).strict()).min(1).max(200),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ tags }) => run(async () => {
  const created = await svc.createServerTags(tags);
  return ok(`Created ${created.length} server tag(s): ${created.map((t) => `\`${t.name}\``).join(', ')}.`,
    { created: created.map((t) => ({ id: t.id, name: t.name, type: t.type })) });
}));

server.registerTool('scadacraft_read_tags', {
  title: 'Read tag values',
  description: `Read the current values of tags from the running ScadaCraft server.

Args:
  - tags (array of string, 1-200): references ("Device.Tag", unique tag name, or tag id)

Returns: for each tag its reference, value and timestamp (null value = no value yet or device not connected).`,
  inputSchema: { tags: z.array(z.string().min(1)).min(1).max(200) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ tags }) => run(async () => {
  const project = await svc.getProject();
  const refs = tags.map((t) => resolveTag(project, t));
  const values = await client.getTagValues(refs.map((r) => r.id));
  const out = refs.map((r) => {
    const v = values.find((x) => x.id === r.id);
    return { ref: r.ref, id: r.id, value: v?.value ?? null, timestamp: v?.timestamp ?? null };
  });
  return ok(out.map((o) => `- \`${o.ref}\` = ${JSON.stringify(o.value)}${o.timestamp ? ` (${new Date(o.timestamp).toISOString()})` : ''}`).join('\n'), { values: out });
}));

server.registerTool('scadacraft_write_tags', {
  title: 'Write tag values',
  description: `Write values to tags on the running ScadaCraft server.

WARNING: values of device tags are sent to the field devices (PLC, RTU, controllers) and can start, stop or move real equipment.
Only write when the user explicitly asked for these values. Server memory tags ("FUXA Server.*") are safe for simulation.

Args:
  - values (array, 1-100): each {tag: "Device.Tag" | name | id, value: number | boolean | string}

Returns: the written references. Error if a tag is not found or the server rejects the write.`,
  inputSchema: {
    values: z.array(z.object({ tag: z.string().min(1), value: z.union([z.number(), z.boolean(), z.string()]) }).strict()).min(1).max(100),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
}, async ({ values }) => run(async () => {
  const project = await svc.getProject();
  const resolved = values.map((v) => ({ ref: resolveTag(project, v.tag), value: v.value }));
  await client.setTagValues(resolved.map((r) => ({ id: r.ref.id, value: r.value })));
  return ok(`Wrote ${resolved.length} tag(s): ${resolved.map((r) => `\`${r.ref.ref}\` = ${JSON.stringify(r.value)}`).join(', ')}.`,
    { written: resolved.map((r) => ({ ref: r.ref.ref, id: r.ref.id, value: r.value })) });
}));

// ------------------------------------------------------------------ resources
function bundledDoc(file: string): string {
  return readFileSync(join(HERE, '..', 'docs', file), 'utf8');
}

server.registerResource('openbridge-guide', 'scadacraft://docs/openbridge', {
  title: 'OpenBridge design and usage guide',
  description: 'Grid and anchor model, P&ID composition rules, tag binding, fluids, themes.',
  mimeType: 'text/markdown',
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: bundledDoc('openbridge.md') }] }));

server.registerResource('openbridge-widgets', 'scadacraft://docs/openbridge-widgets', {
  title: 'OpenBridge widget reference',
  description: 'Every widget with box, anchor and properties.',
  mimeType: 'text/markdown',
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: bundledDoc('openbridge-widgets.md') }] }));

// ------------------------------------------------------------------ transports
async function runStdio(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error(`scadacraft-mcp-server ${VERSION} on stdio, ScadaCraft at ${client.baseUrl}`);
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';
  app.listen(port, host, () => console.error(`scadacraft-mcp-server ${VERSION} on http://${host}:${port}/mcp, ScadaCraft at ${client.baseUrl}`));
}

const mode = process.env.TRANSPORT ?? 'stdio';
(mode === 'http' ? runHttp() : runStdio()).catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});

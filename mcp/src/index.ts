#!/usr/bin/env node
/**
 * scadacraft-mcp-server
 *
 * MCP server for ScadaCraft: the whole project from an AI assistant.
 *   - pages: OpenBridge widgets bound to tags: P&ID process graphics on the 24 px grid, instruments,
 *     live charts, operator controls (buttons, switches, slider, inputs) and alerts/status;
 *     imported SVG widgets (editor library); trend charts and trend pages
 *   - devices and tags: Modbus TCP/RTU, Siemens S7, OPC UA, MQTT and the other drivers; server memory tags
 *   - alarms: definitions, active alarms, acknowledge, history
 *   - data: live read/write, history (DAQ) with statistics and CSV export
 *   - project: summary, export to file, import (merge or replace)
 *   - app: layout (menu, header, logo, colours), settings and history database, users and roles, scripts,
 *     notifications, languages and texts, charts, reports, API keys, logs, backups (scheduled, restore)
 *
 * Configuration (environment):
 *   SCADACRAFT_URL       ScadaCraft base URL (default http://127.0.0.1:1881)
 *   SCADACRAFT_USERNAME  admin user, only when ScadaCraft security is enabled
 *   SCADACRAFT_PASSWORD
 *   TRANSPORT            stdio (default) | http
 *   HOST, PORT           listen address when TRANSPORT=http (default 127.0.0.1:3001)
 *   SCADACRAFT_MCP_TOKEN bearer token required by TRANSPORT=http (mandatory when HOST is not localhost)
 *   MCP_ALLOWED_HOSTS    comma-separated Host header names accepted (DNS-rebinding protection)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScadaCraftClient } from './fuxa/client.js';
import { AdminService } from './services/admin.js';
import { AlarmsService } from './services/alarms.js';
import { DevicesService } from './services/devices.js';
import { PagesService } from './services/pages.js';
import { ProjectService } from './services/project.js';
import { registerAdminTools } from './tools/admin.js';
import { registerAlarmTools } from './tools/alarms.js';
import type { Ctx } from './tools/common.js';
import { registerDataTools } from './tools/data.js';
import { registerDeviceTools } from './tools/devices.js';
import { registerPageTools } from './tools/pages.js';
import { registerProjectTools } from './tools/project.js';

const VERSION = '0.5.0';
const HERE = dirname(fileURLToPath(import.meta.url));

const client = new ScadaCraftClient({
  url: process.env.SCADACRAFT_URL ?? 'http://127.0.0.1:1881',
  username: process.env.SCADACRAFT_USERNAME,
  password: process.env.SCADACRAFT_PASSWORD,
});
const ctx: Ctx = {
  client,
  pages: new PagesService(client),
  devices: new DevicesService(client),
  alarms: new AlarmsService(client),
  project: new ProjectService(client),
  admin: new AdminService(client),
};

const INSTRUCTIONS = `ScadaCraft is a web SCADA/HMI. This server edits the project of a running ScadaCraft and reads its live data.
Typical flow for a new plant: scadacraft_get_project_summary → scadacraft_create_device → scadacraft_add_tags → scadacraft_update_device {enabled:true}
→ scadacraft_read_tags to check communication → scadacraft_create_view → scadacraft_list_widgets (read the placement model once)
→ scadacraft_place_widgets / scadacraft_draw_pipe with tag bindings → scadacraft_set_alarm → scadacraft_get_view to verify.
Widgets come in five OpenBridge libraries: automation (P&ID symbols, anchor on a node), instruments, charts, controls, alerts
(top-left on a node, "size" in cells). Controls are read/write: bind the setpoint/state tag once.
Own widgets: scadacraft_import_widgets (native SVG widget format) then place them as "group/file".
Trends: scadacraft_set_chart (pens) → scadacraft_place_chart, or scadacraft_create_trend_page for a whole page with menu entry.
App setup: scadacraft_set_layout (menu, header, logo, colours, start page), users/roles, settings, scripts, reports, backups.
Safety: scadacraft_write_tags and enabling devices act on real equipment; scadacraft_import_project mode "replace" and the delete tools
change or remove project data. Do these only when the user asked for them. Export the project before large changes.`;

function createServer(): McpServer {
  const server = new McpServer({ name: 'scadacraft-mcp-server', version: VERSION }, { instructions: INSTRUCTIONS });
  registerProjectTools(server, ctx);
  registerDeviceTools(server, ctx);
  registerDataTools(server, ctx);
  registerAlarmTools(server, ctx);
  registerPageTools(server, ctx);
  registerAdminTools(server, ctx);

  const doc = (file: string) => readFileSync(join(HERE, '..', 'docs', file), 'utf8');
  server.registerResource('openbridge-guide', 'scadacraft://docs/openbridge', {
    title: 'OpenBridge design and usage guide',
    description: 'Grid and anchor model, P&ID composition rules, tag binding, fluids, themes.',
    mimeType: 'text/markdown',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: doc('openbridge.md') }] }));
  server.registerResource('openbridge-widgets', 'scadacraft://docs/openbridge-widgets', {
    title: 'OpenBridge widget reference',
    description: 'Every widget with box, anchor and properties.',
    mimeType: 'text/markdown',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: doc('openbridge-widgets.md') }] }));
  return server;
}

async function runStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
  console.error(`scadacraft-mcp-server ${VERSION} on stdio, ScadaCraft at ${client.baseUrl}`);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** Bearer-token check in constant time. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const a = createHash('sha256').update(m[1].trim()).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

async function runHttp(): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';
  const token = process.env.SCADACRAFT_MCP_TOKEN?.trim();
  // The MCP server can write to field devices: on the network it must require a token.
  if (!LOOPBACK.has(host) && !token) {
    console.error(`Refusing to listen on ${host}: set SCADACRAFT_MCP_TOKEN (clients send "Authorization: Bearer <token>"), or listen on 127.0.0.1.`);
    process.exit(1);
  }
  if (token && token.length < 24) {
    console.error('SCADACRAFT_MCP_TOKEN is too short: use at least 24 random characters (e.g. openssl rand -hex 32).');
    process.exit(1);
  }
  const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
  // localhost binding: DNS-rebinding protection (Host header must be localhost)
  const app = createMcpExpressApp({ host, ...(allowedHosts?.length ? { allowedHosts } : {}) });
  app.use(express.json({ limit: '5mb' }));
  if (token) {
    app.use('/mcp', (req, res, next) => {
      if (tokenMatches(req.headers.authorization, token)) return next();
      res.setHeader('WWW-Authenticate', 'Bearer realm="scadacraft-mcp"');
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: missing or wrong bearer token' }, id: null });
    });
  }
  app.post('/mcp', async (req, res) => {
    // stateless: a fresh server and transport per request
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }); });
  app.listen(port, host, () => console.error(
    `scadacraft-mcp-server ${VERSION} on http://${host}:${port}/mcp (${token ? 'bearer token required' : 'localhost only'}), ScadaCraft at ${client.baseUrl}`));
}

const mode = process.env.TRANSPORT ?? 'stdio';
(mode === 'http' ? runHttp() : runStdio()).catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});

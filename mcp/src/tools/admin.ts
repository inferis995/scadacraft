/**
 * Tools for everything else configured in the ScadaCraft editor: layout (menu, header, logo, colours),
 * server settings and history database, users and roles, scripts, notifications, languages and texts,
 * chart definitions, reports, API keys, logs, backups, and raw access to any project section.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ALARM_RETENTIONS, DB_TYPES, groupsToNames, INPUT_MODES, NAV_MODES, NAV_TYPES, NOTIFY_MODES, RETENTIONS, USER_GROUPS, ZOOM_MODES,
  type LayoutInput, type MenuItemInput, type SettingsInput,
} from '../services/admin.js';
import { iso, ok, RELOAD_NOTE, run, type Ctx } from './common.js';

const MenuItemSchema: z.ZodType<MenuItemInput> = z.lazy(() => z.object({
  text: z.string().min(1).max(100),
  view: z.string().optional().describe('view name to open'),
  link: z.string().optional().describe('external URL'),
  alarms: z.boolean().optional().describe('open the alarm list'),
  icon: z.string().optional().describe('Material icon name, e.g. "home", "water_drop", "warning", "trending_up", "settings"'),
  image: z.string().optional().describe('image URL from scadacraft_upload_image'),
  children: z.array(MenuItemSchema).optional().describe('sub-menu'),
}).strict());

const Retention = z.enum(RETENTIONS);

export function registerAdminTools(server: McpServer, ctx: Ctx): void {
  const admin = ctx.admin;

  // ---------------------------------------------------------------- layout
  server.registerTool('scadacraft_get_layout', {
    title: 'Get app layout',
    description: `The operator app layout: start page, side menu (mode, style, colours, logo, items), header (title, colours,
alarm/info indicators, login info, date/time, language), zoom, login, custom CSS.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const l = await admin.getLayout();
    return ok(JSON.stringify(l.readable, null, 2), { layout: l.readable });
  }));

  server.registerTool('scadacraft_set_layout', {
    title: 'Set app layout',
    description: `Configure the operator app: start page, side menu with items, logo, colours, header bar. Only the fields given change.
"menu.items" replaces the whole menu.

Args (all optional):
  - start_view: view shown at start
  - menu: {mode: ${NAV_MODES.join('|')} (void = no menu, fix = always open), type: ${NAV_TYPES.join('|')} (item style),
           background, color, logo (URL from scadacraft_upload_image, or null), items: [{text, view | link | alarms: true, icon, children}]}
  - header: {title, background, color, height, font_family, font_size, alarms: ${NOTIFY_MODES.join('|')}, infos: ${NOTIFY_MODES.join('|')},
             login_info: nothing|username|fullname|both, date_time (Angular date format, e.g. "dd/MM/yyyy HH:mm:ss"), language: nothing|simple|key|fullname}
  - zoom: ${ZOOM_MODES.join('|')}; input_dialog: ${INPUT_MODES.join('|')}; hide_navigation; show_dev_button; login_on_start;
    login_overlay: none|black|white; show_connection_error; custom_css;
    openbridge_theme: day | dusk | night (control room) | bright (sunlight) — palette of all OpenBridge widgets;
      page_background (default true): pages with a white/palette background take the palette background

Example: {"start_view": "Overview", "menu": {"mode": "fix", "type": "block", "background": "#0B1F33", "color": "#FFFFFF",
  "items": [{"text": "Overview", "view": "Overview", "icon": "home"}, {"text": "Alarms", "alarms": true, "icon": "warning"}]},
  "header": {"title": "Impianto Cariati", "background": "#0B1F33", "color": "#FFFFFF", "alarms": "fix", "date_time": "dd/MM/yyyy HH:mm"}}

Returns: the resulting layout.
${RELOAD_NOTE}`,
    inputSchema: {
      start_view: z.string().optional(),
      show_dev_button: z.boolean().optional(),
      zoom: z.enum(ZOOM_MODES).optional(),
      input_dialog: z.enum(INPUT_MODES).optional(),
      hide_navigation: z.boolean().optional(),
      login_on_start: z.boolean().optional(),
      login_overlay: z.enum(['none', 'black', 'white']).optional(),
      show_connection_error: z.boolean().optional(),
      custom_css: z.string().optional(),
      openbridge_theme: z.enum(['day', 'dusk', 'night', 'bright']).optional(),
      page_background: z.boolean().optional().describe('with openbridge_theme: page backgrounds follow the palette (default true; custom colours are kept)'),
      menu: z.object({
        mode: z.enum(NAV_MODES).optional(), type: z.enum(NAV_TYPES).optional(),
        background: z.string().optional(), color: z.string().optional(), logo: z.string().nullable().optional(),
        items: z.array(MenuItemSchema).optional(),
      }).strict().optional(),
      header: z.object({
        title: z.string().optional(), background: z.string().optional(), color: z.string().optional(),
        height: z.number().int().min(20).max(200).optional(), font_family: z.string().optional(), font_size: z.number().int().min(8).max(48).optional(),
        alarms: z.enum(NOTIFY_MODES).optional(), infos: z.enum(NOTIFY_MODES).optional(),
        login_info: z.enum(['nothing', 'username', 'fullname', 'both']).optional(), date_time: z.string().optional(),
        language: z.enum(['nothing', 'simple', 'key', 'fullname']).optional(), items_anchor: z.enum(['left', 'center', 'right']).optional(),
      }).strict().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const layout = await admin.setLayout(input as LayoutInput);
    return ok(`Layout updated.\n${JSON.stringify(layout, null, 2)}\n\n${RELOAD_NOTE}`, { layout });
  }));

  server.registerTool('scadacraft_upload_image', {
    title: 'Upload image',
    description: `Upload an image (logo, menu icon, background, picture for pages) from a file on the machine running the MCP server
to the ScadaCraft resources. Use the returned URL for menu.logo, menu item images, etc.

Args:
  - path (string): svg, png, jpg, gif, webp, ico or bmp file
  - name (string, optional): file name on the server

Returns: the image URL (e.g. "resources/logo.png").`,
    inputSchema: { path: z.string().min(1), name: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ path, name }) => run(async () => {
    const url = await admin.uploadImage(path, name);
    return ok(`Uploaded: ${url}`, { url });
  }));

  // ---------------------------------------------------------------- settings
  server.registerTool('scadacraft_get_settings', {
    title: 'Get server settings',
    description: `Server settings: language, port, security, history database (type, retention), alarm and log retention, SMTP, Node-RED, Swagger.
Secrets (passwords, tokens) are never returned.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const s = await admin.getSettings();
    const pick = {
      language: s.language, uiPort: s.uiPort, secureEnabled: s.secureEnabled, secureOnlyEditor: s.secureOnlyEditor,
      tokenExpiresIn: s.tokenExpiresIn, userRole: s.userRole, daqstore: s.daqstore, alarms: s.alarms, logs: s.logs,
      smtp: s.smtp, broadcastAll: s.broadcastAll, lazyViewLoading: s.lazyViewLoading, nodeRedEnabled: s.nodeRedEnabled, swaggerEnabled: s.swaggerEnabled,
    };
    return ok(JSON.stringify(pick, null, 2), { settings: pick });
  }));

  server.registerTool('scadacraft_set_settings', {
    title: 'Set server settings',
    description: `Change server settings. Only given fields change. Saving restarts the ScadaCraft runtime (devices reconnect).

Args (all optional):
  - history_db: database for tag history {type: ${DB_TYPES.join(' | ')}, retention: ${RETENTIONS.join('|')},
      url (InfluxDB/TDengine), host, organization, bucket (InfluxDB 2), database, table, config_string (QuestDB),
      token | username + password (stored on the server, never returned)}
  - alarms_retention: ${ALARM_RETENTIONS.join('|')}; logs_retention
  - smtp: {host, port, sender, username, password} for e-mail notifications and reports
  - security: {enabled, only_editor, token_expires (e.g. "1h"), refresh_cookie, refresh_expires, user_roles}
    Enabling security requires an admin user: create it first with scadacraft_set_user, and set SCADACRAFT_USERNAME/PASSWORD for this MCP server.
  - language (editor language code), ui_port (takes effect after a server restart), log_full, broadcast_all, lazy_view_loading, node_red, swagger

Returns: the saved settings (without secrets).`,
    inputSchema: {
      language: z.string().optional(),
      ui_port: z.number().int().min(1).max(65535).optional(),
      security: z.object({
        enabled: z.boolean().optional(), only_editor: z.boolean().optional(), token_expires: z.string().optional(),
        refresh_cookie: z.boolean().optional(), refresh_expires: z.string().optional(), user_roles: z.boolean().optional(),
      }).strict().optional(),
      history_db: z.object({
        type: z.enum(DB_TYPES).optional(), retention: Retention.optional(), url: z.string().optional(), host: z.string().optional(),
        organization: z.string().optional(), bucket: z.string().optional(), database: z.string().optional(), table: z.string().optional(),
        config_string: z.string().optional(), token: z.string().optional(), username: z.string().optional(), password: z.string().optional(),
      }).strict().optional(),
      alarms_retention: z.enum(ALARM_RETENTIONS).optional(),
      logs_retention: Retention.optional(),
      log_full: z.boolean().optional(),
      smtp: z.object({ host: z.string().optional(), port: z.number().int().optional(), sender: z.string().optional(), username: z.string().optional(), password: z.string().optional() }).strict().optional(),
      broadcast_all: z.boolean().optional(),
      lazy_view_loading: z.boolean().optional(),
      node_red: z.boolean().optional(),
      swagger: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const s = await admin.setSettings(input as SettingsInput);
    const pick = { daqstore: s.daqstore, alarms: s.alarms, logs: s.logs, smtp: s.smtp, secureEnabled: s.secureEnabled, language: s.language };
    return ok(`Settings saved (runtime restarted).\n${JSON.stringify(pick, null, 2)}`, { settings: pick });
  }));

  server.registerTool('scadacraft_send_test_mail', {
    title: 'Send test e-mail',
    description: 'Send an e-mail with the configured SMTP settings, to check them.',
    inputSchema: { to: z.string().min(3), subject: z.string().default('ScadaCraft test'), text: z.string().default('SMTP settings work.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ to, subject, text }) => run(async () => {
    await admin.sendTestMail(to, subject, text);
    return ok(`Mail sent to ${to}.`, { to });
  }));

  server.registerTool('scadacraft_clear_alarm_history', {
    title: 'Clear alarms',
    description: `Clear active alarms (all=false) or also the whole alarm history (all=true). Cannot be undone; only when the user asked.`,
    inputSchema: { all: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ all }) => run(async () => {
    await admin.clearAlarms(all);
    return ok(all ? 'Active alarms and alarm history cleared.' : 'Active alarms cleared.', { all });
  }));

  // ---------------------------------------------------------------- users and roles
  server.registerTool('scadacraft_list_users', {
    title: 'List users',
    description: 'Users with groups (viewer, operator, engineer, supervisor, manager, administrator), roles and start page. Passwords are never returned.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const users = (await admin.listUsers()).map((u) => {
      let info: Record<string, unknown> = {};
      try { info = JSON.parse(String(u.info ?? '{}')); } catch { /* ignore */ }
      return { username: u.username, fullname: u.fullname, groups: groupsToNames(Number(u.groups)), roles: info.roles, start: info.start };
    });
    return ok(users.map((u) => `- **${u.username}**${u.fullname ? ` (${u.fullname})` : ''}: ${u.groups.join(', ')}`).join('\n') || 'No users.', { users });
  }));

  server.registerTool('scadacraft_set_user', {
    title: 'Create or update user',
    description: `Create a user or update an existing one (only given fields change; password only when given).

Args:
  - username (string)
  - password (string): required for a new user
  - fullname (string, optional)
  - groups (array): ${Object.keys(USER_GROUPS).join(', ')}. "administrator" can edit the project.
  - roles (array, optional): role names, when role-based permissions are enabled (settings security.user_roles)
  - start_view (string, optional): page opened after login
  - language (string, optional): language id

Returns: the user.`,
    inputSchema: {
      username: z.string().min(2).max(64),
      password: z.string().min(4).optional(),
      fullname: z.string().optional(),
      groups: z.array(z.string()).optional(),
      roles: z.array(z.string()).optional(),
      start_view: z.string().optional(),
      language: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const u = await admin.setUser(input);
    return ok(`User **${u.username}** saved: ${(u.groups as string[]).join(', ')}.`, { user: u });
  }));

  server.registerTool('scadacraft_delete_user', {
    title: 'Delete user',
    description: 'Delete a user.',
    inputSchema: { username: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ username }) => run(async () => {
    await admin.deleteUser(username);
    return ok(`Deleted user ${username}.`, { username });
  }));

  server.registerTool('scadacraft_list_roles', {
    title: 'List roles',
    description: 'Roles used for role-based permissions on pages, menu items, alarms and tags.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const roles = await admin.listRoles();
    return ok(roles.map((r) => `- **${r.name}** (\`${r.id}\`)${r.description ? `: ${r.description}` : ''}`).join('\n') || 'No roles.', { roles });
  }));

  server.registerTool('scadacraft_set_role', {
    title: 'Create or update role',
    description: 'Create a role, or update the role with the same name.',
    inputSchema: { name: z.string().min(1).max(100), description: z.string().optional(), index: z.number().int().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const r = await admin.setRole(input);
    return ok(`Role **${r.name}** saved.`, { role: r });
  }));

  server.registerTool('scadacraft_delete_role', {
    title: 'Delete role',
    description: 'Delete a role by name or id.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteRole(name);
    return ok(`Deleted role ${name}.`, { name });
  }));

  // ---------------------------------------------------------------- scripts
  server.registerTool('scadacraft_list_scripts', {
    title: 'List scripts',
    description: 'Scripts with mode (SERVER/CLIENT), parameters and scheduling. Set include_code to see the code.',
    inputSchema: { include_code: z.boolean().default(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ include_code }) => run(async () => {
    const scripts = (await admin.list('scripts')).map((s) => ({
      id: s.id, name: s.name, mode: s.mode, parameters: s.parameters, scheduling: s.scheduling, ...(include_code ? { code: s.code } : {}),
    }));
    const text = scripts.map((s) => `- **${s.name}** (${s.mode})${(s.parameters as unknown[])?.length ? ` params ${JSON.stringify(s.parameters)}` : ''}` +
      `${s.scheduling ? ` schedule ${JSON.stringify(s.scheduling)}` : ''}${include_code ? `\n\`\`\`js\n${s.code}\n\`\`\`` : ''}`).join('\n');
    return ok(text || 'No scripts.', { scripts });
  }));

  server.registerTool('scadacraft_set_script', {
    title: 'Create or update script',
    description: `Create a script, or replace the one with the same name. Scripts are JavaScript function bodies run by the server (SERVER)
or in the operator's browser (CLIENT). Inside, ScadaCraft functions are available, e.g.:
  $getTag(tagId) -> value, $setTag(tagId, value), $getTagId('TagName', 'DeviceName') -> tagId (tag name first),
  $getAlarms(), $getAlarmsHistory(from, to), $enableDevice(name, enabled), $sendMessage(address, subject, text).
Parameters arrive as variables with the given names; "tagid" parameters receive a tag id. Use "return" to give a result.
The server loads the new code within about 2 seconds.

Args:
  - name (string): valid JavaScript identifier
  - code (string): function body, e.g. "const lvl = $getTag($getTagId('LT101', 'PLC1')); if (lvl > 90) $setTag($getTagId('P101_Cmd', 'PLC1'), 0);"
  - mode: SERVER (default) | CLIENT
  - parameters: [{name, type: tagid|value}]
  - interval_s (run every N seconds) | run_at_start | daily_at "HH:MM" (one of them, optional)

Returns: the script.`,
    inputSchema: {
      name: z.string().min(1).max(100),
      code: z.string(),
      mode: z.enum(['SERVER', 'CLIENT']).optional(),
      parameters: z.array(z.object({ name: z.string(), type: z.enum(['tagid', 'value']) }).strict()).optional(),
      interval_s: z.number().int().min(1).optional(),
      run_at_start: z.boolean().optional(),
      daily_at: z.string().optional(),
      sync: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const s = await admin.setScript(input);
    return ok(`Script **${s.name}** saved (${s.mode}${s.scheduling ? `, ${JSON.stringify(s.scheduling)}` : ''}).`, { script: { id: s.id, name: s.name, mode: s.mode } });
  }));

  server.registerTool('scadacraft_run_script', {
    title: 'Run script',
    description: `Run a SERVER script now and return its result. Scripts can write tags: only run when the user asked.

Args:
  - name (string): script name or id
  - params (object, optional): parameter values by name; tagid parameters accept "Device.Tag"

Returns: the value returned by the script.`,
    inputSchema: { name: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ name, params }) => run(async () => {
    const r = await admin.runScript(name, params);
    return ok(`Script ${name} returned: ${JSON.stringify(r)}`, { result: r as unknown });
  }));

  server.registerTool('scadacraft_delete_script', {
    title: 'Delete script',
    description: 'Delete a script by name or id.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteScript(name);
    return ok(`Deleted script ${name}.`, { name });
  }));

  // ---------------------------------------------------------------- notifications
  server.registerTool('scadacraft_list_notifications', {
    title: 'List notifications',
    description: 'E-mail notifications (alarm levels to receivers).',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const list = await admin.list('notifications');
    return ok(list.map((n) => `- **${n.name}** → ${n.receiver} (${n.type}, ${JSON.stringify(n.subscriptions)}, ${n.enabled ? 'enabled' : 'disabled'})`).join('\n') || 'No notifications.', { notifications: list });
  }));

  server.registerTool('scadacraft_set_notification', {
    title: 'Create or update notification',
    description: `E-mail notification for alarms: when alarms of the given levels become active, mail the receivers (needs SMTP settings).

Args:
  - name (string)
  - receivers (string): e-mail addresses separated by ";" or ","
  - levels (array): highhigh | high | low | info (default highhigh, high)
  - delay_min (number, default 1): wait before sending; interval_min (number, default 0): repeat interval
  - enabled (boolean), text (string, optional extra text)`,
    inputSchema: {
      name: z.string().min(1), receivers: z.string().min(3),
      levels: z.array(z.enum(['highhigh', 'high', 'low', 'info'])).optional(),
      delay_min: z.number().min(0).optional(), interval_min: z.number().min(0).optional(),
      enabled: z.boolean().optional(), text: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const n = await admin.setNotification(input);
    return ok(`Notification **${n.name}** saved → ${n.receiver}.`, { notification: n });
  }));

  server.registerTool('scadacraft_delete_notification', {
    title: 'Delete notification',
    description: 'Delete a notification by name or id.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteNotification(name);
    return ok(`Deleted notification ${name}.`, { name });
  }));

  // ---------------------------------------------------------------- languages and texts
  server.registerTool('scadacraft_get_texts', {
    title: 'Get languages and texts',
    description: 'Languages of the operator app and the translatable texts (used as @name in labels).',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const languages = await admin.getLanguages();
    const texts = await admin.list('texts');
    return ok(`Languages: ${JSON.stringify(languages)}\n${texts.map((t) => `- @${t.name} = "${t.value}" ${JSON.stringify(t.translations)}`).join('\n')}`, { languages, texts });
  }));

  server.registerTool('scadacraft_set_languages', {
    title: 'Set languages',
    description: `Languages offered in the operator app. Example: default {"id": "IT", "name": "Italiano"}, options [{"id": "EN", "name": "English"}].`,
    inputSchema: {
      default: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
      options: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const l = await admin.setLanguages(input.default, input.options);
    return ok(`Languages: ${JSON.stringify(l)}`, { languages: l });
  }));

  server.registerTool('scadacraft_set_texts', {
    title: 'Set texts',
    description: `Create or update translatable texts. Use "@name" in widget labels to show the text in the operator's language.
Example: [{"name": "pump", "value": "Pompa", "translations": {"EN": "Pump"}}]`,
    inputSchema: {
      texts: z.array(z.object({
        name: z.string().min(1), value: z.string(), group: z.string().optional(), translations: z.record(z.string(), z.string()).optional(),
      }).strict()).min(1).max(500),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ texts }) => run(async () => {
    const r = await admin.setTexts(texts);
    return ok(`Saved ${r.length} text(s).`, { texts: r });
  }));

  server.registerTool('scadacraft_delete_texts', {
    title: 'Delete texts',
    description: 'Delete translatable texts by name.',
    inputSchema: { names: z.array(z.string().min(1)).min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ names }) => run(async () => {
    const r = await admin.deleteTexts(names);
    return ok(`Deleted: ${r.join(', ')}.`, { removed: r });
  }));

  // ---------------------------------------------------------------- charts and reports
  server.registerTool('scadacraft_list_charts', {
    title: 'List chart definitions',
    description: 'Chart (trend) definitions: name and pens (tag, label, colour, axis). Used by chart widgets and reports.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const charts = await admin.list('charts');
    return ok(charts.map((c) => `- **${c.name}**: ${((c.lines as Record<string, unknown>[]) ?? []).map((l) => `${l.device}.${l.name} (${l.color})`).join(', ')}`).join('\n') || 'No charts.', { charts });
  }));

  server.registerTool('scadacraft_set_chart', {
    title: 'Create or update chart definition',
    description: `Define a trend chart (pens on tags). Tags should have history enabled to show past data.
Example: {"name": "Livelli", "lines": [{"tag": "PLC1.LT101", "label": "T-101", "color": "#2E7DD7"}, {"tag": "PLC1.FT101", "yaxis": 2}]}`,
    inputSchema: {
      name: z.string().min(1),
      lines: z.array(z.object({
        tag: z.string().min(1), label: z.string().optional(), color: z.string().optional(),
        yaxis: z.number().int().min(1).max(4).optional(), width: z.number().min(1).max(10).optional(), fill: z.string().optional(),
      }).strict()).min(1).max(20),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const c = await admin.setChart(input);
    return ok(`Chart **${c.name}** saved with ${(c.lines as unknown[]).length} pen(s).`, { chart: c });
  }));

  server.registerTool('scadacraft_delete_chart', {
    title: 'Delete chart definition',
    description: 'Delete a chart definition by name.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteChart(name);
    return ok(`Deleted chart ${name}.`, { name });
  }));

  server.registerTool('scadacraft_list_reports', {
    title: 'List reports',
    description: 'PDF report definitions and, optionally, the generated files.',
    inputSchema: { files: z.boolean().default(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ files }) => run(async () => {
    const reports = await admin.list('reports');
    const generated = files ? (await Promise.all(reports.map((r) => admin.listReportFiles(String(r.name))))).flat() : undefined;
    return ok(reports.map((r) => `- **${r.name}** (${r.scheduling}) → ${r.receiver || 'no receivers'}`).join('\n') +
      (generated ? `\nFiles: ${generated.join(', ') || '(none)'}` : ''), { reports, ...(generated ? { files: generated } : {}) });
  }));

  server.registerTool('scadacraft_set_report', {
    title: 'Create or update report',
    description: `PDF report generated by the server every day / week / month (for the previous period) and mailed to the receivers.

Args:
  - name (string); receivers (string, optional, e-mails); schedule: none | day | week | month (default week)
  - title (string, optional)
  - tags (array, optional): table of values, aggregated by interval (min5|min10|min30|hour|day) with function (min|max|average|sum)
  - chart (string, optional): chart definition name (scadacraft_set_chart)
  - alarms (boolean, optional): alarm list of the period
  - orientation: portrait | landscape

Returns: the report. Build it now with scadacraft_build_report.`,
    inputSchema: {
      name: z.string().min(1), receivers: z.string().optional(), schedule: z.enum(['none', 'day', 'week', 'month']).optional(),
      title: z.string().optional(), tags: z.array(z.string()).optional(),
      function: z.enum(['min', 'max', 'average', 'sum']).optional(), interval: z.enum(['min5', 'min10', 'min30', 'hour', 'day']).optional(),
      alarms: z.boolean().optional(), chart: z.string().optional(), orientation: z.enum(['portrait', 'landscape']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => run(async () => {
    const r = await admin.setReport(input);
    return ok(`Report **${r.name}** saved (${r.scheduling}).`, { report: { id: r.id, name: r.name, scheduling: r.scheduling } });
  }));

  server.registerTool('scadacraft_build_report', {
    title: 'Build report now',
    description: 'Generate the PDF of a report now (and mail it if receivers are set). Then see the files with scadacraft_list_reports {files: true}.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name }) => run(async () => {
    await admin.buildReport(name);
    return ok(`Report ${name} scheduled for generation now (it is built within a few seconds).`, { name });
  }));

  server.registerTool('scadacraft_delete_report', {
    title: 'Delete report',
    description: 'Delete a report definition.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteReport(name);
    return ok(`Deleted report ${name}.`, { name });
  }));

  // ---------------------------------------------------------------- API keys and logs
  server.registerTool('scadacraft_list_api_keys', {
    title: 'List API keys',
    description: 'API keys for external systems calling the ScadaCraft REST API (keys are masked).',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const keys = (await admin.listApiKeys()).map((k) => ({ ...k, key: k.key ? `${String(k.key).slice(0, 4)}…` : undefined }) as Record<string, unknown>);
    return ok(keys.map((k) => `- **${k.name}** (${k.enabled ? 'enabled' : 'disabled'}), expires ${k.expires}`).join('\n') || 'No API keys.', { apiKeys: keys });
  }));

  server.registerTool('scadacraft_create_api_key', {
    title: 'Create API key',
    description: 'Create an API key for an external system. The full key is returned only once: give it to the user.',
    inputSchema: { name: z.string().min(1), description: z.string().optional(), expires_days: z.number().int().min(1).max(3650).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => run(async () => {
    const k = await admin.createApiKey(input);
    return ok(`API key **${k.name}** created, expires ${k.expires}:\n${k.key}`, { apiKey: k });
  }));

  server.registerTool('scadacraft_delete_api_key', {
    title: 'Delete API key',
    description: 'Revoke an API key by name or id.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteApiKey(name);
    return ok(`Deleted API key ${name}.`, { name });
  }));

  server.registerTool('scadacraft_read_logs', {
    title: 'Read server logs',
    description: `Last lines of the ScadaCraft server log, optionally filtered (e.g. "ERR", a device name). Use it to diagnose connections.

Args: file (optional, see list_files), lines (default 100), filter (optional), list_files (boolean)`,
    inputSchema: {
      file: z.string().optional(), lines: z.number().int().min(1).max(2000).default(100), filter: z.string().optional(), list_files: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ file, lines, filter, list_files }) => run(async () => {
    if (list_files) {
      const files = await admin.listLogs();
      return ok(files.map((f) => `- ${typeof f === 'string' ? f : JSON.stringify(f)}`).join('\n'), { files });
    }
    const r = await admin.readLog(file, lines, filter);
    return ok(`${r.file}: ${r.total} line(s)${filter ? ` matching "${filter}"` : ''}, last ${r.lines.length}:\n${r.lines.join('\n')}`, { ...r });
  }));

  // ---------------------------------------------------------------- backups
  server.registerTool('scadacraft_backup_status', {
    title: 'Backup status',
    description: 'Backup schedule, next run, pending restore and the list of backups (name, date, size, with/without history).',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => run(async () => {
    const s = await admin.backupStatus();
    const backups = (s.backups as Record<string, unknown>[]) ?? [];
    const cfg = s.config as Record<string, unknown>;
    const text = [
      `Schedule: ${cfg.enabled ? `daily at ${cfg.time}${(cfg.days as number[]).length ? ` on days ${(cfg.days as number[]).join(',')}` : ''}, keep ${cfg.keep}` : 'disabled'}; folder ${cfg.dir}` +
        `${s.nextRun ? `; next ${s.nextRun}` : ''}`,
      ...(s.pendingRestore ? [`PENDING RESTORE from ${(s.pendingRestore as Record<string, unknown>).backup} (applied at next server start)`] : []),
      `Backups (${backups.length}):`,
      ...backups.map((b) => `- ${b.name}: ${b.created}, ${((Number(b.size) || 0) / 1048576).toFixed(1)} MB${b.includesHistory ? ', with history' : ''}`),
    ].join('\n');
    return ok(text, s);
  }));

  server.registerTool('scadacraft_create_backup', {
    title: 'Create backup',
    description: `Back up everything now on the ScadaCraft server: project, users, alarms, API keys, recipes, scheduler, settings,
uploaded images and (optionally) the tag history databases. Consistent copy while running.

Args: label (optional), include_history (default: as in the backup settings, normally true)`,
    inputSchema: { label: z.string().max(40).optional(), include_history: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ label, include_history }) => run(async () => {
    const b = await admin.createBackup(label, include_history);
    return ok(`Backup **${b.name}** created: ${((b.files as unknown[]) ?? []).length} items, ${((Number(b.size) || 0) / 1048576).toFixed(1)} MB, in ${b.path}.`, b);
  }));

  server.registerTool('scadacraft_set_backup_schedule', {
    title: 'Set backup schedule',
    description: `Automatic backups on the ScadaCraft server.

Args (optional): enabled, time "HH:MM", days [0..6] (0 = Sunday; empty = every day), keep (number of automatic backups kept),
dir (folder on the server; default _backups next to the data folder), include_history`,
    inputSchema: {
      enabled: z.boolean().optional(), time: z.string().optional(), days: z.array(z.number().int().min(0).max(6)).optional(),
      keep: z.number().int().min(1).max(1000).optional(), dir: z.string().optional(), include_history: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ include_history, ...rest }) => run(async () => {
    const r = await admin.setBackupSchedule({ ...rest, ...(include_history !== undefined ? { includeHistory: include_history } : {}) });
    const c = r.config as Record<string, unknown>;
    return ok(`Backups ${c.enabled ? `enabled at ${c.time}, keep ${c.keep}` : 'disabled'}${r.nextRun ? `; next ${r.nextRun}` : ''}.`, r);
  }));

  server.registerTool('scadacraft_restore_backup', {
    title: 'Restore backup',
    description: `Restore a backup. The databases are in use while ScadaCraft runs, so the restore is applied at the next server start;
the current files are kept in a "pre-restore" folder. Set restart=true to restart now (needs a service supervisor such as Docker,
systemd or pm2 to bring ScadaCraft back up). Only when the user explicitly asked to restore.

Args: name (backup name), history (restore tag history too, default true), settings (default true), restart (default false), cancel (cancel a pending restore)`,
    inputSchema: {
      name: z.string().optional(), history: z.boolean().default(true), settings: z.boolean().default(true),
      restart: z.boolean().default(false), cancel: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ name, history, settings, restart, cancel }) => run(async () => {
    if (cancel) {
      const r = await admin.cancelRestore();
      return ok(r.cancelled ? 'Pending restore cancelled.' : 'No pending restore.', r);
    }
    if (!name) throw new Error('Give the backup name (see scadacraft_backup_status).');
    const r = await admin.restoreBackup(name, history, settings);
    if (restart) await admin.restartServer();
    return ok(`Restore of ${name} scheduled${restart ? '; ScadaCraft is restarting' : ': it is applied at the next start of ScadaCraft'}.`, r);
  }));

  server.registerTool('scadacraft_delete_backup', {
    title: 'Delete backup',
    description: 'Delete a backup folder on the server.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => run(async () => {
    await admin.deleteBackup(name);
    return ok(`Deleted backup ${name}.`, { name });
  }));

  // ---------------------------------------------------------------- raw sections
  const SECTIONS = ['layout', 'scripts', 'notifications', 'texts', 'languages', 'charts', 'graphs', 'reports', 'mapsLocations', 'ar', 'clientAccess', 'recipes', 'alarms'] as const;
  const COMMANDS = ['layout', 'charts', 'graphs', 'languages', 'client-access', 'set-script', 'del-script', 'set-notification', 'del-notification',
    'set-text', 'del-text', 'set-alarm', 'del-alarm', 'set-report', 'del-report', 'set-maps-location', 'del-maps-location', 'set-ar-marker', 'del-ar-marker'] as const;

  server.registerTool('scadacraft_get_section', {
    title: 'Get project section (raw)',
    description: `Raw JSON of a project section, for anything the typed tools do not cover: ${SECTIONS.join(', ')}.`,
    inputSchema: { section: z.enum(SECTIONS) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ section }) => run(async () => {
    const v = await admin.getSection(section);
    return ok(JSON.stringify(v ?? null, null, 2), { section, value: v as unknown });
  }));

  server.registerTool('scadacraft_set_section', {
    title: 'Set project section (raw)',
    description: `Advanced: send a raw project command with a JSON value, exactly as the editor does (POST /api/projectData).
Commands: ${COMMANDS.join(', ')}. "layout", "charts", "graphs", "languages", "client-access" replace the whole section;
"set-*"/"del-*" add/replace or remove one item (by id or name). Prefer the typed tools; read the section first with scadacraft_get_section.`,
    inputSchema: { cmd: z.enum(COMMANDS), value: z.unknown() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ cmd, value }) => run(async () => {
    if (value === undefined || value === null) throw new Error('value is required');
    await admin.setSectionRaw(cmd, value);
    return ok(`Sent ${cmd}.\n${RELOAD_NOTE}`, { cmd });
  }));

  void iso;
}

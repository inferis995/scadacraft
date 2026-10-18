/**
 * Everything else the ScadaCraft editor configures: app layout (menu, header, logo, colours),
 * server settings (history database, SMTP, security, retention), users and roles, scripts,
 * notifications, multilingual texts, chart definitions, reports, API keys, uploads, logs,
 * backups. Records are built in the same shape as the client models (client/src/app/_models).
 */
import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ScadaCraftClient } from '../fuxa/client.js';
import { guid } from '../fuxa/ids.js';
import { allTags, resolveTag } from '../fuxa/tags.js';
import type { Project, View } from '../fuxa/types.js';
import { buildEvents, type EventSpec } from '../fuxa/interaction.js';

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------- layout
export const NAV_MODES = ['void', 'push', 'over', 'fix'] as const;
export const NAV_TYPES = ['icon', 'text', 'block', 'inline'] as const;
export const NOTIFY_MODES = ['hide', 'fix', 'float'] as const;
export const ZOOM_MODES = ['disabled', 'enabled', 'autoresize'] as const;
export const INPUT_MODES = ['false', 'true', 'keyboard', 'keyboardFullScreen'] as const;

export interface MenuItemInput {
  text: string;
  view?: string;
  link?: string;
  alarms?: boolean;
  icon?: string;
  image?: string;
  children?: MenuItemInput[];
}

export interface LayoutInput {
  start_view?: string;
  show_dev_button?: boolean;
  zoom?: (typeof ZOOM_MODES)[number];
  input_dialog?: (typeof INPUT_MODES)[number];
  hide_navigation?: boolean;
  login_on_start?: boolean;
  login_overlay?: 'none' | 'black' | 'white';
  show_connection_error?: boolean;
  custom_css?: string;
  /** OpenBridge palette of the widgets */
  openbridge_theme?: 'day' | 'dusk' | 'night' | 'bright';
  /** with openbridge_theme: also set the page background of views that use a default/palette background (default true) */
  page_background?: boolean;
  menu?: {
    mode?: (typeof NAV_MODES)[number];
    type?: (typeof NAV_TYPES)[number];
    background?: string;
    color?: string;
    logo?: string | null;
    items?: MenuItemInput[];
  };
  header?: {
    title?: string;
    background?: string;
    color?: string;
    height?: number;
    font_family?: string;
    font_size?: number;
    alarms?: (typeof NOTIFY_MODES)[number];
    infos?: (typeof NOTIFY_MODES)[number];
    login_info?: 'nothing' | 'username' | 'fullname' | 'both';
    date_time?: string;
    language?: 'nothing' | 'simple' | 'key' | 'fullname';
    items_anchor?: 'left' | 'center' | 'right';
    /** buttons, labels and icons in the header bar (replaces the list) */
    items?: HeaderItemInput[];
  };
}

export interface HeaderItemInput {
  /** button: raised button; label: shows the text, or the tag value when "tag" is set; image: icon only */
  type: 'button' | 'label' | 'image';
  text?: string;
  /** Material icon name or OpenBridge "ob:<name>" (scadacraft_list_icons) */
  icon?: string;
  image?: string;
  background?: string;
  color?: string;
  /** tag: colours by value (colors) and, for a label, the value shown; default target of set/toggle events */
  tag?: string;
  colors?: { min: number; max: number; fill?: string; stroke?: string }[];
  events?: EventSpec[];
  margin_left?: number;
  margin_right?: number;
  height?: number;
}

export interface MapLocationInput {
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
  /** page opened in a card on the map (marker popup button) */
  card_page?: string | null;
  /** page the marker navigates to */
  page?: string | null;
  url?: string | null;
  show_name?: boolean;
  show_icon?: boolean;
  /** Material icon or "ob:<name>" */
  icon?: string;
  image?: string | null;
  background?: string;
  color?: string;
  /** tag whose value is shown on the marker */
  value_tag?: string | null;
}

// ---------------------------------------------------------------- settings
export const APP_SETTINGS_KEYS = [
  'language', 'hideEditorOnboarding', 'editorSectionMessages', 'uiPort', 'secureEnabled', 'tokenExpiresIn',
  'enableRefreshCookieAuth', 'refreshTokenExpiresIn', 'secureOnlyEditor', 'broadcastAll', 'lazyViewLoading',
  'smtp', 'daqstore', 'alarms', 'logs', 'logFull', 'userRole', 'nodeRedEnabled', 'nodeRedAuthMode', 'swaggerEnabled',
];
export const DB_TYPES = ['SQlite', 'influxDB', 'influxDB 1.8', 'TDengine', 'questDB'] as const;
export const RETENTIONS = ['none', 'day1', 'days2', 'days3', 'days7', 'days14', 'days30', 'days90', 'year1', 'year3', 'year5'] as const;
export const ALARM_RETENTIONS = ['none', 'days7', 'days30', 'days90', 'year1', 'year3', 'year5'] as const;

export interface HistoryDbInput {
  type?: (typeof DB_TYPES)[number];
  retention?: (typeof RETENTIONS)[number];
  url?: string;
  host?: string;
  organization?: string;
  bucket?: string;
  database?: string;
  table?: string;
  config_string?: string;
  token?: string;
  username?: string;
  password?: string;
}

export interface SettingsInput {
  language?: string;
  ui_port?: number;
  security?: { enabled?: boolean; only_editor?: boolean; token_expires?: string; refresh_cookie?: boolean; refresh_expires?: string; user_roles?: boolean };
  history_db?: HistoryDbInput;
  alarms_retention?: (typeof ALARM_RETENTIONS)[number];
  logs_retention?: (typeof RETENTIONS)[number];
  log_full?: boolean;
  smtp?: { host?: string; port?: number; sender?: string; username?: string; password?: string };
  broadcast_all?: boolean;
  lazy_view_loading?: boolean;
  node_red?: boolean;
  swagger?: boolean;
}

// ---------------------------------------------------------------- users
export const USER_GROUPS: Record<string, number> = {
  viewer: 1, operator: 2, engineer: 4, supervisor: 8, manager: 16, f: 32, g: 64, administrator: 128,
};

export function groupsToNames(v: number): string[] {
  if (v === -1 || v === 255) return ['administrator (all)'];
  return Object.entries(USER_GROUPS).filter(([, bit]) => v & bit).map(([n]) => n);
}

export class AdminService {
  private iconNames?: string[];

  constructor(readonly client: ScadaCraftClient) {}

  private viewByName(project: Project, ref: string): View {
    const views = project.hmi?.views ?? [];
    const v = views.find((x) => x.id === ref) ?? views.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!v) throw new Error(`View "${ref}" not found. Views: ${views.map((x) => x.name).join(', ') || '(none)'}.`);
    return v;
  }

  // ------------------------------------------------------------ layout
  async getLayout(): Promise<{ raw: Rec; readable: Rec }> {
    const project = await this.client.getProject();
    const layout = ((project.hmi as Rec | undefined)?.layout ?? {}) as Rec;
    const views = project.hmi?.views ?? [];
    const vname = (id: unknown) => views.find((v) => v.id === id)?.name ?? (id ? String(id) : '');
    const nav = (layout.navigation ?? {}) as Rec;
    const header = (layout.header ?? {}) as Rec;
    const items = (list: unknown): Rec[] => ((list as Rec[] | undefined) ?? []).map((i) => ({
      text: i.text, view: i.view ? vname(i.view) : undefined, link: i.link || undefined, icon: i.icon || undefined, image: i.image || undefined,
      ...(i.children ? { children: items(i.children) } : {}),
    }));
    return {
      raw: layout,
      readable: {
        start_view: vname(layout.start), show_dev_button: layout.showdev, zoom: layout.zoom, input_dialog: layout.inputdialog,
        hide_navigation: layout.hidenavigation, login_on_start: layout.loginonstart, login_overlay: layout.loginoverlaycolor,
        theme: layout.theme, openbridge_theme: layout.obcTheme ?? 'day', custom_css: layout.customStyles ? '(set)' : undefined,
        menu: { mode: nav.mode, type: nav.type, background: nav.bkcolor, color: nav.fgcolor, logo: nav.logo || null, items: items(nav.items) },
        header: {
          title: header.title, background: header.bkcolor, color: header.fgcolor, height: header.height, font_family: header.fontFamily,
          font_size: header.fontSize, alarms: header.alarms, infos: header.infos, login_info: header.loginInfo,
          date_time: header.dateTimeDisplay, language: header.language, items: ((header.items as Rec[] | undefined) ?? []).length,
        },
      },
    };
  }

  private menuItems(project: Project, items: MenuItemInput[]): Rec[] {
    return items.map((i) => {
      const view = i.view ? this.viewByName(project, i.view).id : '';
      const link = i.alarms ? '[alarms]' : i.link ?? '';
      if (!view && !link && !i.children?.length) {
        throw new Error(`Menu item "${i.text}": give a view, a link (URL) or alarms: true.`);
      }
      return {
        id: guid('m_'), text: i.text, view, link, icon: i.icon ?? '', image: i.image ?? '',
        permission: null, permissionRoles: null,
        ...(i.children?.length ? { children: this.menuItems(project, i.children) } : {}),
      };
    });
  }

  async setLayout(input: LayoutInput): Promise<Rec> {
    await this.validateIcons([...this.menuIcons(input.menu?.items), ...(input.header?.items ?? []).map((i) => i.icon)]);
    const project = await this.client.getProject();
    const current = JSON.parse(JSON.stringify(((project.hmi as Rec | undefined)?.layout ?? {}))) as Rec;
    const layout: Rec = {
      autoresize: false, start: '', showdev: true, zoom: 'disabled', inputdialog: 'false', hidenavigation: false, theme: '',
      loginonstart: false, loginoverlaycolor: 'none', ...current,
      navigation: { mode: 'over', type: 'block', bkcolor: '#F4F5F7', fgcolor: '#1D1D1D', items: [], ...(current.navigation as Rec ?? {}) },
      header: { bkcolor: '#ffffff', fgcolor: '#000000', height: 46, buttonHeight: 36, fontSize: 13, itemsAnchor: 'left', ...(current.header as Rec ?? {}) },
    };
    if (input.start_view !== undefined) layout.start = input.start_view ? this.viewByName(project, input.start_view).id : '';
    if (input.show_dev_button !== undefined) layout.showdev = input.show_dev_button;
    if (input.zoom) layout.zoom = input.zoom;
    if (input.input_dialog) layout.inputdialog = input.input_dialog;
    if (input.hide_navigation !== undefined) layout.hidenavigation = input.hide_navigation;
    if (input.login_on_start !== undefined) layout.loginonstart = input.login_on_start;
    if (input.login_overlay) layout.loginoverlaycolor = input.login_overlay;
    if (input.show_connection_error !== undefined) layout.show_connection_error = input.show_connection_error;
    if (input.custom_css !== undefined) layout.customStyles = input.custom_css;
    if (input.openbridge_theme) {
      layout.obcTheme = input.openbridge_theme;
      if (input.page_background !== false) await this.applyPaletteBackground(project, input.openbridge_theme);
    }
    const nav = layout.navigation as Rec;
    if (input.menu) {
      const m = input.menu;
      if (m.mode) nav.mode = m.mode;
      if (m.type) nav.type = m.type;
      if (m.background) nav.bkcolor = m.background;
      if (m.color) nav.fgcolor = m.color;
      if (m.logo !== undefined) nav.logo = m.logo || false;
      if (m.items) nav.items = this.menuItems(project, m.items);
    }
    const header = layout.header as Rec;
    if (input.header) {
      const h = input.header;
      const map: [keyof NonNullable<LayoutInput['header']>, string][] = [
        ['title', 'title'], ['background', 'bkcolor'], ['color', 'fgcolor'], ['height', 'height'], ['font_family', 'fontFamily'],
        ['font_size', 'fontSize'], ['alarms', 'alarms'], ['infos', 'infos'], ['login_info', 'loginInfo'], ['date_time', 'dateTimeDisplay'],
        ['language', 'language'], ['items_anchor', 'itemsAnchor'],
      ];
      for (const [k, f] of map) if (h[k] !== undefined) header[f] = h[k];
      if (h.items) header.items = this.headerItems(project, h.items);
    }
    await this.client.setProjectData('layout', layout);
    return (await this.getLayout()).readable;
  }

  /**
   * Page background from the OpenBridge palette (--container-background-color of each theme).
   * Only views with a white default or another palette background are changed; custom colours are kept.
   */
  private async applyPaletteBackground(project: Project, theme: 'day' | 'dusk' | 'night' | 'bright'): Promise<void> {
    const palette = { day: '#F7F7F7', dusk: '#1F1F1F', night: '#000000', bright: '#FCFCFC' };
    const replaceable = new Set(['', '#ffffff', '#ffffffff', '#fff', ...Object.values(palette).map((c) => c.toLowerCase())]);
    for (const view of project.hmi?.views ?? []) {
      const bk = String(view.profile?.bkcolor ?? '').toLowerCase();
      if (!replaceable.has(bk) || bk === palette[theme].toLowerCase()) continue;
      view.profile.bkcolor = palette[theme];
      await this.client.saveView(view);
    }
  }

  private headerItems(project: Project, items: HeaderItemInput[]): Rec[] {
    return items.map((i) => {
      const property: Rec = { text: i.text ?? '', events: [], actions: [] };
      if (i.tag) property.variableId = resolveTag(project, i.tag).id;
      if (i.colors?.length) {
        if (!i.tag) throw new Error(`Header item "${i.text ?? i.icon ?? i.type}": colors need a "tag".`);
        property.ranges = i.colors.map((r) => ({ min: r.min, max: r.max, color: r.fill ?? null, stroke: r.stroke ?? null }));
      }
      if (i.events?.length) property.events = buildEvents(project, i.events, i.tag);
      if (i.type === 'image' && !i.icon && !i.image) throw new Error('Header item of type "image" needs an icon or an image.');
      return {
        id: guid('i_'), type: i.type, icon: i.icon ?? '', image: i.image ?? '',
        ...(i.background ? { bkcolor: i.background } : {}), ...(i.color ? { fgcolor: i.color } : {}),
        marginLeft: i.margin_left ?? 5, marginRight: i.margin_right ?? 5, ...(i.height ? { height: i.height } : {}),
        property,
      };
    });
  }

  /** OpenBridge icon names ("ob:<name>") must exist; Material names are not checked. */
  async validateIcons(names: (string | undefined)[]): Promise<void> {
    const ob = names.filter((n): n is string => !!n && n.startsWith('ob:'));
    if (!ob.length) return;
    await this.listIcons();
    const known = new Set(this.iconNames);
    for (const n of ob) {
      if (known.has(n)) continue;
      const words = n.slice(3).split(/[-_\s]+/).filter((w) => w.length > 2);
      const similar = this.iconNames!.filter((i) => words.some((w) => i.includes(w))).sort((a, b) => a.length - b.length).slice(0, 8);
      throw new Error(`Unknown OpenBridge icon "${n}".${similar.length ? ` Similar: ${similar.join(', ')}.` : ''} Search with scadacraft_list_icons.`);
    }
  }

  private menuIcons(items: MenuItemInput[] | undefined): (string | undefined)[] {
    return (items ?? []).flatMap((i) => [i.icon, ...this.menuIcons(i.children)]);
  }

  // ------------------------------------------------------------ icons
  /** OpenBridge icon names ("ob:<name>"), filtered by words. */
  async listIcons(search?: string, limit = 60): Promise<{ total: number; icons: string[] }> {
    if (!this.iconNames) {
      const text = await this.client.getText('/assets/lib/openbridge/icons/icons.json');
      this.iconNames = (JSON.parse(text) as string[]).map((n) => `ob:${n}`);
    }
    const words = (search ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const hits = this.iconNames.filter((n) => words.every((w) => n.includes(w)));
    // shortest names first: "ob:pump" before "ob:pump-centrifugal-…"
    hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return { total: hits.length, icons: hits.slice(0, limit) };
  }

  // ------------------------------------------------------------ maps
  async listMapLocations(): Promise<Rec[]> {
    const project = await this.client.getProject();
    return ((project as unknown as { mapsLocations?: Rec[] }).mapsLocations ?? []);
  }

  describeLocation(project: Project, l: Rec): Rec {
    const views = project.hmi?.views ?? [];
    const vname = (id: unknown) => (id ? views.find((v) => v.id === id)?.name ?? String(id) : undefined);
    let tag: string | undefined;
    if (l.markerTagValueId) { try { tag = resolveTag(project, String(l.markerTagValueId)).ref; } catch { tag = String(l.markerTagValueId); } }
    return {
      id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude, description: l.description || undefined,
      card_page: vname(l.viewId), page: vname(l.pageId), url: l.url || undefined, icon: l.markerIcon || undefined, value_tag: tag,
    };
  }

  /** Create or update (by name) a map location. */
  async setMapLocation(input: MapLocationInput): Promise<Rec> {
    await this.validateIcons([input.icon]);
    const project = await this.client.getProject();
    const all = ((project as unknown as { mapsLocations?: Rec[] }).mapsLocations ?? []);
    const existing = all.find((l) => String(l.name).toLowerCase() === input.name.toLowerCase());
    if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) throw new Error('latitude must be -90..90 and longitude -180..180.');
    const loc: Rec = existing ? { ...existing } : { id: guid('l_'), showMarkerName: true, showMarkerIcon: true, showMarkerValue: true, markerIcon: 'ob:location-1', markerBackground: '#ffffff', markerColor: '#1D3C67' };
    loc.name = input.name;
    loc.latitude = input.latitude;
    loc.longitude = input.longitude;
    if (input.description !== undefined) loc.description = input.description;
    if (input.card_page !== undefined) loc.viewId = input.card_page ? this.viewByName(project, input.card_page).id : '';
    if (input.page !== undefined) loc.pageId = input.page ? this.viewByName(project, input.page).id : '';
    if (input.url !== undefined) loc.url = input.url ?? '';
    if (input.show_name !== undefined) loc.showMarkerName = input.show_name;
    if (input.show_icon !== undefined) loc.showMarkerIcon = input.show_icon;
    if (input.icon !== undefined) loc.markerIcon = input.icon;
    if (input.image !== undefined) loc.markerImage = input.image ?? '';
    if (input.background !== undefined) loc.markerBackground = input.background;
    if (input.color !== undefined) loc.markerColor = input.color;
    if (input.value_tag !== undefined) {
      loc.markerTagValueId = input.value_tag ? resolveTag(project, input.value_tag).id : '';
      if (input.value_tag) loc.showMarkerValue = true;
    }
    await this.client.setProjectData('set-maps-location', loc);
    return this.describeLocation(project, loc);
  }

  async deleteMapLocation(ref: string): Promise<Rec> {
    const project = await this.client.getProject();
    const all = ((project as unknown as { mapsLocations?: Rec[] }).mapsLocations ?? []);
    const loc = all.find((l) => l.id === ref) ?? all.find((l) => String(l.name).toLowerCase() === ref.toLowerCase());
    if (!loc) throw new Error(`Map location "${ref}" not found. Locations: ${all.map((l) => l.name).join(', ') || '(none)'}.`);
    await this.client.setProjectData('del-maps-location', loc);
    // drop it from map pages
    for (const v of project.hmi?.views ?? []) {
      if ((v as unknown as Rec).type !== 'maps') continue;
      let ids: string[] = [];
      try { ids = JSON.parse(v.svgcontent || '[]'); } catch { ids = []; }
      if (ids.includes(String(loc.id))) {
        v.svgcontent = JSON.stringify(ids.filter((i) => i !== loc.id));
        await this.client.saveView(v);
      }
    }
    return this.describeLocation(project, loc);
  }

  /** Map page (OpenStreetMap) showing locations; created or updated by name. */
  async setMapPage(input: { name: string; locations: string[]; center?: { latitude: number; longitude: number }; zoom?: number }): Promise<Rec> {
    const project = await this.client.getProject();
    const all = ((project as unknown as { mapsLocations?: Rec[] }).mapsLocations ?? []);
    const ids = input.locations.map((ref) => {
      const l = all.find((x) => x.id === ref) ?? all.find((x) => String(x.name).toLowerCase() === ref.toLowerCase());
      if (!l) throw new Error(`Map location "${ref}" not found. Create it with scadacraft_set_map_location.`);
      return l;
    });
    const views = project.hmi?.views ?? [];
    let view = views.find((v) => v.name.toLowerCase() === input.name.toLowerCase()) as unknown as Rec | undefined;
    if (view && view.type !== 'maps') throw new Error(`"${input.name}" is a ${String(view.type ?? 'svg')} page, not a map page.`);
    const center = input.center ?? (ids.length
      ? { latitude: ids.reduce((a, l) => a + Number(l.latitude), 0) / ids.length, longitude: ids.reduce((a, l) => a + Number(l.longitude), 0) / ids.length }
      : { latitude: 41.9, longitude: 12.5 });
    if (!view) {
      view = {
        id: guid('v_'), name: input.name, type: 'maps', items: {}, variables: {},
        profile: { width: 1024, height: 768, bkcolor: '#ffffffff', margin: 10, align: 'topCenter', gridType: 'fixed', viewRenderDelay: 0 },
        property: {},
      };
    }
    view.svgcontent = JSON.stringify(ids.map((l) => l.id));
    view.property = { ...((view.property as Rec) ?? {}), startLocation: { id: guid('l_'), ...center }, startZoom: input.zoom ?? (ids.length > 1 ? 9 : 13) };
    await this.client.saveView(view as unknown as View);
    return { page: input.name, locations: ids.map((l) => l.name), center, zoom: (view.property as Rec).startZoom };
  }

  /** Append a menu entry (kept if a menu entry already opens the same view). */
  async addMenuItem(item: MenuItemInput): Promise<{ added: boolean }> {
    await this.validateIcons(this.menuIcons([item]));
    const project = await this.client.getProject();
    const current = JSON.parse(JSON.stringify(((project.hmi as Rec | undefined)?.layout ?? {}))) as Rec;
    const nav = { mode: 'over', type: 'block', bkcolor: '#F4F5F7', fgcolor: '#1D1D1D', items: [], ...(current.navigation as Rec ?? {}) } as Rec;
    const items = (nav.items as Rec[] | undefined) ?? [];
    const [entry] = this.menuItems(project, [item]);
    if (entry.view && items.some((i) => i.view === entry.view)) return { added: false };
    nav.items = [...items, entry];
    await this.client.setProjectData('layout', { ...current, navigation: nav });
    return { added: true };
  }

  /** Upload an image file (logo, menu icon, background) to the server resources. Returns its URL path. */
  async uploadImage(path: string, name?: string): Promise<string> {
    const full = resolve(path);
    const ext = extname(full).slice(1).toLowerCase();
    if (!['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext)) {
      throw new Error(`Unsupported image type ".${ext}". Use svg, png, jpg, gif, webp, ico or bmp.`);
    }
    const buf = readFileSync(full);
    const mime = ext === 'jpg' ? 'jpeg' : ext === 'ico' ? 'x-icon' : ext;
    const data = ext === 'svg' ? buf.toString('utf8') : `data:image/${mime};base64,${buf.toString('base64')}`;
    const fileName = name ? (name.endsWith(`.${ext}`) ? name : `${name}.${ext}`) : basename(full);
    const res = await this.client.postJson<{ location: string }>('/api/upload', { resource: { type: ext, name: fileName, data } });
    return res.location;
  }

  // ------------------------------------------------------------ settings
  async getSettings(): Promise<Rec> {
    return this.client.getJson<Rec>('/api/settings');
  }

  async setSettings(input: SettingsInput): Promise<Rec> {
    const current = await this.getSettings();
    const body: Rec = {};
    for (const k of APP_SETTINGS_KEYS) if (current[k] !== undefined) body[k] = JSON.parse(JSON.stringify(current[k]));
    if (input.language) body.language = input.language;
    if (input.ui_port) body.uiPort = input.ui_port;
    if (input.security) {
      const s = input.security;
      if (s.enabled !== undefined) body.secureEnabled = s.enabled;
      if (s.only_editor !== undefined) body.secureOnlyEditor = s.only_editor;
      if (s.token_expires) body.tokenExpiresIn = s.token_expires;
      if (s.refresh_cookie !== undefined) body.enableRefreshCookieAuth = s.refresh_cookie;
      if (s.refresh_expires) body.refreshTokenExpiresIn = s.refresh_expires;
      if (s.user_roles !== undefined) body.userRole = s.user_roles;
    }
    if (input.history_db) {
      const d = input.history_db;
      const store: Rec = { type: 'SQlite', host: '127.0.0.1', tableName: 'meters', retention: 'year1', ...(body.daqstore as Rec ?? {}) };
      const map: [keyof HistoryDbInput, string][] = [
        ['type', 'type'], ['retention', 'retention'], ['url', 'url'], ['host', 'host'], ['organization', 'organization'],
        ['bucket', 'bucket'], ['database', 'database'], ['table', 'tableName'], ['config_string', 'configurationString'],
      ];
      for (const [k, f] of map) if (d[k] !== undefined) store[f] = d[k];
      if (d.token || d.username || d.password) {
        store.credentials = { ...(d.token ? { token: d.token } : {}), ...(d.username ? { username: d.username } : {}), ...(d.password ? { password: d.password } : {}) };
      } else {
        delete store.credentials; // the server keeps the stored credentials when none are sent
      }
      body.daqstore = store;
    }
    if (input.alarms_retention) body.alarms = { ...(body.alarms as Rec ?? {}), retention: input.alarms_retention };
    if (input.logs_retention) body.logs = { ...(body.logs as Rec ?? {}), retention: input.logs_retention };
    if (input.log_full !== undefined) body.logFull = input.log_full;
    if (input.smtp) {
      const s = input.smtp;
      body.smtp = {
        ...(body.smtp as Rec ?? {}),
        ...(s.host !== undefined ? { host: s.host } : {}), ...(s.port !== undefined ? { port: s.port } : {}),
        ...(s.sender !== undefined ? { mailsender: s.sender } : {}), ...(s.username !== undefined ? { username: s.username } : {}),
        ...(s.password ? { password: s.password } : {}),
      };
    }
    if (input.broadcast_all !== undefined) body.broadcastAll = input.broadcast_all;
    if (input.lazy_view_loading !== undefined) body.lazyViewLoading = input.lazy_view_loading;
    if (input.node_red !== undefined) body.nodeRedEnabled = input.node_red;
    if (input.swagger !== undefined) body.swaggerEnabled = input.swagger;
    await this.client.postJson('/api/settings', body, 60000);
    return this.getSettings();
  }

  async sendTestMail(to: string, subject: string, text: string): Promise<void> {
    await this.client.postJson('/api/sendmail', { params: { msg: { to, subject, text }, smtp: null } }, 60000);
  }

  async clearAlarms(all: boolean): Promise<void> {
    await this.client.postJson('/api/alarmsClear', { params: all });
  }

  // ------------------------------------------------------------ users and roles
  async listUsers(): Promise<Rec[]> {
    return (await this.client.getJson<Rec[]>('/api/users')) ?? [];
  }

  async setUser(input: { username: string; password?: string; fullname?: string; groups?: string[]; roles?: string[]; start_view?: string; language?: string }): Promise<Rec> {
    if (!/^[a-zA-Z0-9_.@-]{2,64}$/.test(input.username)) throw new Error('Username: 2-64 characters, letters, digits, _ . @ -');
    const users = await this.listUsers();
    const existing = users.find((u) => u.username === input.username);
    if (!existing && !input.password) throw new Error(`New user "${input.username}" needs a password.`);
    let groups = (existing?.groups as number | undefined) ?? 1;
    if (input.groups) {
      groups = 0;
      for (const g of input.groups) {
        const bit = USER_GROUPS[g.toLowerCase()];
        if (!bit) throw new Error(`Unknown group "${g}". Groups: ${Object.keys(USER_GROUPS).join(', ')}.`);
        groups |= bit;
      }
    }
    const oldInfo = (() => { try { return JSON.parse(String(existing?.info ?? '{}')) as Rec; } catch { return {}; } })();
    let start = oldInfo.start ?? '';
    if (input.start_view !== undefined) {
      start = input.start_view ? this.viewByName(await this.client.getProject(), input.start_view).id : '';
    }
    let roleIds = oldInfo.roles as string[] | undefined;
    if (input.roles) {
      const roles = await this.listRoles();
      roleIds = input.roles.map((r) => {
        const role = roles.find((x) => x.id === r || String(x.name).toLowerCase() === r.toLowerCase());
        if (!role) throw new Error(`Role "${r}" not found. Roles: ${roles.map((x) => x.name).join(', ') || '(none)'}.`);
        return String(role.id);
      });
    }
    const info = JSON.stringify({ start, roles: roleIds, languageId: input.language ?? oldInfo.languageId });
    await this.client.postJson('/api/users', {
      params: { username: input.username, fullname: input.fullname ?? existing?.fullname ?? '', password: input.password, groups, info },
    });
    return { username: input.username, groups: groupsToNames(groups), start_view: input.start_view, roles: input.roles };
  }

  async deleteUser(username: string): Promise<void> {
    await this.client.deleteJson(`/api/users?param=${encodeURIComponent(username)}`);
  }

  async listRoles(): Promise<Rec[]> {
    return (await this.client.getJson<Rec[]>('/api/roles')) ?? [];
  }

  async setRole(input: { name: string; description?: string; index?: number }): Promise<Rec> {
    const roles = await this.listRoles();
    const existing = roles.find((r) => String(r.name).toLowerCase() === input.name.toLowerCase());
    const role = {
      id: existing?.id ?? guid('r_'), name: input.name, description: input.description ?? existing?.description ?? '',
      index: input.index ?? existing?.index ?? roles.length,
    };
    await this.client.postJson('/api/roles', { params: [role] });
    return role;
  }

  async deleteRole(name: string): Promise<void> {
    const roles = await this.listRoles();
    const role = roles.find((r) => r.id === name || String(r.name).toLowerCase() === name.toLowerCase());
    if (!role) throw new Error(`Role "${name}" not found.`);
    await this.client.deleteJson(`/api/roles?roles=${encodeURIComponent(JSON.stringify([role]))}`);
  }

  // ------------------------------------------------------------ project sections (scripts, notifications, texts, charts, reports)
  async list(section: 'scripts' | 'notifications' | 'texts' | 'reports' | 'charts' | 'graphs'): Promise<Rec[]> {
    const project = await this.client.getProject();
    return ((project as Rec)[section] as Rec[] | undefined) ?? [];
  }

  private async findIn(section: 'scripts' | 'notifications' | 'texts' | 'reports', ref: string): Promise<Rec | undefined> {
    const list = await this.list(section);
    return list.find((x) => x.id === ref) ?? list.find((x) => String(x.name).toLowerCase() === ref.toLowerCase());
  }

  async setScript(input: {
    name: string; code: string; mode?: 'SERVER' | 'CLIENT'; parameters?: { name: string; type: 'tagid' | 'value' }[];
    interval_s?: number; run_at_start?: boolean; daily_at?: string; sync?: boolean;
  }): Promise<Rec> {
    if (!/^[a-zA-Z_$][\w$]*$/.test(input.name)) throw new Error('Script name must be a valid JavaScript identifier (it is called as a function).');
    const existing = await this.findIn('scripts', input.name);
    let scheduling: Rec | undefined = existing?.scheduling as Rec | undefined;
    if (input.interval_s) scheduling = { mode: 'interval', interval: input.interval_s, schedules: [] };
    else if (input.run_at_start) scheduling = { mode: 'start', interval: 0, schedules: [] };
    else if (input.daily_at) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.daily_at)) throw new Error('daily_at must be HH:MM');
      const [hour, minute] = input.daily_at.split(':').map(Number);
      scheduling = { mode: 'scheduling', interval: 0, schedules: [{ type: 0, days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], time: input.daily_at, hour, minute }] };
    }
    const script: Rec = {
      ...(existing ?? {}),
      id: existing?.id ?? guid('s_'), name: input.name, code: input.code, sync: input.sync ?? existing?.sync ?? false,
      parameters: (input.parameters ?? (existing?.parameters as Rec[] | undefined) ?? []).map((p) => ({ name: p.name, type: p.type, value: undefined })),
      mode: input.mode ?? existing?.mode ?? 'SERVER',
      permission: existing?.permission ?? null, permissionRoles: existing?.permissionRoles ?? { enabled: [] },
      ...(scheduling ? { scheduling } : {}),
    };
    await this.client.setProjectData('set-script', script);
    // the server reloads its script module on its next check cycle (1 s): wait so a following run uses the new code
    await new Promise((r) => setTimeout(r, 2500));
    return script;
  }

  async deleteScript(ref: string): Promise<void> {
    const s = await this.findIn('scripts', ref);
    if (!s) throw new Error(`Script "${ref}" not found.`);
    await this.client.setProjectData('del-script', s);
  }

  async runScript(ref: string, params: Record<string, unknown>): Promise<unknown> {
    const s = await this.findIn('scripts', ref);
    if (!s) throw new Error(`Script "${ref}" not found.`);
    if (s.mode === 'CLIENT') throw new Error(`Script "${s.name}" runs in the browser (CLIENT mode) and cannot be run from here.`);
    const project = await this.client.getProject();
    const parameters = ((s.parameters as Rec[] | undefined) ?? []).map((p) => {
      const v = params[String(p.name)];
      if (v === undefined) throw new Error(`Missing parameter "${p.name}".`);
      return { ...p, value: p.type === 'tagid' ? resolveTag(project, String(v)).id : v };
    });
    return this.client.postJson('/api/runscript', { params: { script: { id: s.id, name: s.name, parameters }, toLogEvent: true } }, 120000);
  }

  async setNotification(input: {
    name: string; receivers: string; type?: 'alarms' | 'trigger';
    levels?: ('highhigh' | 'high' | 'low' | 'info')[]; delay_min?: number; interval_min?: number; enabled?: boolean; text?: string;
  }): Promise<Rec> {
    const existing = await this.findIn('notifications', input.name);
    const subs: Rec = {};
    for (const l of input.levels ?? ['highhigh', 'high']) subs[l] = true;
    const n: Rec = {
      ...(existing ?? {}),
      id: existing?.id ?? guid('n_'), name: input.name, receiver: input.receivers, type: input.type ?? 'alarms',
      delay: input.delay_min ?? existing?.delay ?? 1, interval: input.interval_min ?? existing?.interval ?? 0,
      enabled: input.enabled ?? existing?.enabled ?? true, text: input.text ?? existing?.text ?? '',
      subscriptions: input.levels ? subs : existing?.subscriptions ?? subs, mode: existing?.mode ?? 0, options: existing?.options ?? null,
    };
    await this.client.setProjectData('set-notification', n);
    return n;
  }

  async deleteNotification(ref: string): Promise<void> {
    const n = await this.findIn('notifications', ref);
    if (!n) throw new Error(`Notification "${ref}" not found.`);
    await this.client.setProjectData('del-notification', n);
  }

  async getLanguages(): Promise<Rec> {
    const project = await this.client.getProject();
    return ((project as Rec).languages as Rec | undefined) ?? { default: { id: 'EN', name: 'English' }, options: [] };
  }

  async setLanguages(def: { id: string; name: string }, options: { id: string; name: string }[]): Promise<Rec> {
    const value = { default: def, options };
    await this.client.setProjectData('languages', value);
    return value;
  }

  async setTexts(texts: { name: string; value: string; group?: string; translations?: Record<string, string> }[]): Promise<Rec[]> {
    const current = await this.list('texts');
    const out: Rec[] = [];
    for (const t of texts) {
      const existing = current.find((x) => x.name === t.name);
      const text = {
        id: existing?.id ?? guid('w_'), name: t.name, group: t.group ?? existing?.group ?? '', value: t.value,
        translations: { ...(existing?.translations as Rec ?? {}), ...(t.translations ?? {}) },
      };
      await this.client.setProjectData('set-text', text);
      out.push(text);
    }
    return out;
  }

  async deleteTexts(names: string[]): Promise<string[]> {
    const current = await this.list('texts');
    const removed: string[] = [];
    for (const n of names) {
      const t = current.find((x) => x.name === n || x.id === n);
      if (!t) throw new Error(`Text "${n}" not found.`);
      await this.client.setProjectData('del-text', t);
      removed.push(String(t.name));
    }
    return removed;
  }

  /** Chart definitions (trend pens) used by chart widgets and reports. */
  async setChart(input: { name: string; lines: { tag: string; label?: string; color?: string; yaxis?: number; width?: number; fill?: string }[] }): Promise<Rec> {
    const project = await this.client.getProject();
    const charts = JSON.parse(JSON.stringify(((project as Rec).charts as Rec[] | undefined) ?? [])) as Rec[];
    const palette = ['#2E7DD7', '#E8443A', '#2BA84A', '#F2A20C', '#8E44AD', '#16A2B8', '#7F8C8D', '#D35400'];
    const lines = input.lines.map((l, i) => {
      const t = resolveTag(project, l.tag);
      return {
        device: t.device, id: t.id, name: t.name, label: l.label ?? t.name, color: l.color ?? palette[i % palette.length],
        yaxis: l.yaxis ?? 1, lineWidth: l.width ?? 2, spanGaps: true, ...(l.fill ? { fill: l.fill } : {}),
      };
    });
    const existing = charts.find((c) => String(c.name).toLowerCase() === input.name.toLowerCase());
    const chart = { id: existing?.id ?? guid('c_'), name: input.name, lines };
    if (existing) Object.assign(existing, chart); else charts.push(chart);
    await this.client.setProjectData('charts', charts);
    return chart;
  }

  async deleteChart(name: string): Promise<void> {
    const project = await this.client.getProject();
    const charts = (((project as Rec).charts as Rec[] | undefined) ?? []);
    const left = charts.filter((c) => String(c.name).toLowerCase() !== name.toLowerCase() && c.id !== name);
    if (left.length === charts.length) throw new Error(`Chart "${name}" not found.`);
    await this.client.setProjectData('charts', left);
  }

  async setReport(input: {
    name: string; receivers?: string; schedule?: 'none' | 'day' | 'week' | 'month';
    title?: string; tags?: string[]; function?: 'min' | 'max' | 'average' | 'sum'; interval?: 'min5' | 'min10' | 'min30' | 'hour' | 'day';
    alarms?: boolean; chart?: string; orientation?: 'portrait' | 'landscape';
  }): Promise<Rec> {
    const project = await this.client.getProject();
    const existing = await this.findIn('reports', input.name);
    // date range of every item = the scheduling period (previous day / week / month)
    const range = input.schedule && input.schedule !== 'none' ? input.schedule : 'day';
    const items: Rec[] = [];
    if (input.title) items.push({ type: 'text', text: input.title, align: 'left', size: 18 });
    if (input.tags?.length) {
      const columns = input.tags.map((ref) => {
        const t = resolveTag(project, ref);
        return { type: 1, tag: { id: t.id, name: t.name, label: t.name, address: t.address }, label: t.name, align: 'right', width: 'auto', function: input.function ?? 'average' };
      });
      items.push({
        type: 'table', range, interval: input.interval ?? 'hour', size: 10, align: 'left',
        columns: [{ type: 0, tag: { label: 'Timestamp' }, label: 'Timestamp', align: 'left', width: 'auto' }, ...columns],
      });
    }
    if (input.chart) {
      const chart = (((project as Rec).charts as Rec[] | undefined) ?? []).find((c) => String(c.name).toLowerCase() === input.chart!.toLowerCase());
      if (!chart) throw new Error(`Chart "${input.chart}" not found; create it with scadacraft_set_chart.`);
      items.push({ type: 'chart', chart, range, width: 500, height: 350, size: 10, align: 'left' });
    }
    if (input.alarms) {
      items.push({
        type: 'alarms', range, size: 10, align: 'left',
        priority: { highhigh: true, high: true, low: true, info: true },
        priorityText: { highhigh: 'High High', high: 'High', low: 'Low', info: 'Info' },
        property: { ontime: true, text: true, type: true, group: true, status: true, offtime: true, acktime: true, userack: true },
        propertyText: { ontime: 'On', text: 'Text', type: 'Priority', group: 'Group', status: 'Status', offtime: 'Off', acktime: 'Ack', userack: 'Ack user' },
        statusText: { N: 'Active', NF: 'Passive', NA: 'Active, acknowledged' },
      });
    }
    const schedKey = input.schedule ?? (existing ? undefined : 'week');
    const report: Rec = {
      ...(existing ?? {}),
      id: existing?.id ?? guid('r_'), name: input.name, receiver: input.receivers ?? existing?.receiver ?? '',
      scheduling: schedKey ?? existing?.scheduling,
      docproperty: { pageSize: 'A4', pageOrientation: input.orientation ?? 'portrait', pageMargins: [60, 40, 40, 40], fontName: 'Helvetica', ...(existing?.docproperty as Rec ?? {}), ...(input.orientation ? { pageOrientation: input.orientation } : {}) },
      content: { items: items.length ? items : ((existing?.content as Rec | undefined)?.items ?? []) },
    };
    await this.client.setProjectData('set-report', report);
    return report;
  }

  async deleteReport(ref: string): Promise<void> {
    const r = await this.findIn('reports', ref);
    if (!r) throw new Error(`Report "${ref}" not found.`);
    await this.client.setProjectData('del-report', r);
  }

  async buildReport(ref: string): Promise<void> {
    const r = await this.findIn('reports', ref);
    if (!r) throw new Error(`Report "${ref}" not found.`);
    // the server reloads its report jobs a moment after a report is saved: retry while it is not loaded yet
    for (let attempt = 0; ; attempt++) {
      try {
        await this.client.postJson('/api/reportBuild', { params: r }, 120000);
        return;
      } catch (err) {
        if (attempt >= 15 || !/report not found/i.test(String(err))) throw err;
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  }

  /** Generated PDF files of a report (the server lists files per report name). */
  async listReportFiles(name: string): Promise<string[]> {
    return (await this.client.getJson<string[]>(`/api/reportsdir?name=${encodeURIComponent(name)}`)) ?? [];
  }

  // ------------------------------------------------------------ api keys
  async listApiKeys(): Promise<Rec[]> {
    const r = await this.client.getJson<Rec[] | { apiKeys?: Rec[] }>('/api/apikeys');
    return Array.isArray(r) ? r : r?.apiKeys ?? [];
  }

  async createApiKey(input: { name: string; description?: string; expires_days?: number }): Promise<Rec> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const key = Array.from(randomBytes(40)).map((b) => chars[b % chars.length]).join('');
    const created = new Date();
    const expires = new Date(created);
    expires.setDate(expires.getDate() + (input.expires_days ?? 365));
    const apiKey = {
      id: guid('k_'), name: input.name, key, description: input.description ?? '',
      created: created.toISOString(), expires: expires.toISOString(), enabled: true,
    };
    await this.client.postJson('/api/apikeys', { params: [apiKey] });
    return apiKey;
  }

  async deleteApiKey(ref: string): Promise<void> {
    const keys = await this.listApiKeys();
    const k = keys.find((x) => x.id === ref || String(x.name).toLowerCase() === ref.toLowerCase());
    if (!k) throw new Error(`API key "${ref}" not found.`);
    await this.client.deleteJson(`/api/apikeys?apikeys=${encodeURIComponent(JSON.stringify([k]))}`);
  }

  // ------------------------------------------------------------ logs
  async listLogs(): Promise<string[]> {
    return (await this.client.getJson<string[]>('/api/logsdir')) ?? [];
  }

  async readLog(file: string | undefined, lines: number, filter?: string): Promise<{ file: string; total: number; lines: string[] }> {
    const name = file ?? 'fuxa.log';
    const text = await this.client.getText(`/api/logs?file=${encodeURIComponent(name)}`);
    let all = text.split(/\r?\n/).filter((l) => l.length);
    if (filter) {
      const f = filter.toLowerCase();
      all = all.filter((l) => l.toLowerCase().includes(f));
    }
    return { file: name, total: all.length, lines: all.slice(-lines) };
  }

  // ------------------------------------------------------------ backups
  async backupStatus(): Promise<Rec> {
    return this.client.getJson<Rec>('/api/backup');
  }

  async createBackup(label?: string, includeHistory?: boolean): Promise<Rec> {
    return this.client.postJson<Rec>('/api/backup', { label, includeHistory }, 600000);
  }

  async setBackupSchedule(cfg: Rec): Promise<Rec> {
    return this.client.postJson<Rec>('/api/backup/config', cfg);
  }

  async restoreBackup(name: string, history: boolean, settings: boolean): Promise<Rec> {
    return this.client.postJson<Rec>('/api/backup/restore', { name, history, settings });
  }

  async cancelRestore(): Promise<Rec> {
    return this.client.deleteJson<Rec>('/api/backup/restore');
  }

  async deleteBackup(name: string): Promise<void> {
    await this.client.deleteJson(`/api/backup?name=${encodeURIComponent(name)}`);
  }

  async restartServer(): Promise<void> {
    await this.client.postJson('/api/backup/restart', {});
  }

  // ------------------------------------------------------------ generic sections
  async getSection(section: string): Promise<unknown> {
    const project = await this.client.getProject();
    return section === 'layout' ? (project.hmi as Rec | undefined)?.layout : (project as Rec)[section];
  }

  async setSectionRaw(cmd: string, value: unknown): Promise<void> {
    await this.client.setProjectData(cmd, value);
  }

  tagRefs(project: Project): Map<string, string> {
    return new Map(allTags(project).map((t) => [t.id, t.ref]));
  }
}

/**
 * REST client for a ScadaCraft (FUXA-based) server.
 *
 * Endpoints used:
 *   POST /api/signin                 -> { data: { token } }   (only when security is enabled)
 *   GET  /api/project                -> full project (devices, hmi.views, alarms, server device, ...)
 *   POST /api/project                -> replace the whole project (runtime restarts)
 *   POST /api/projectData            -> { cmd, data } incremental save (set-view, set-device, set-alarm, ...)
 *   GET/POST /api/device             -> device security (credentials), stored separately from the project
 *   GET  /api/getTagValue, POST /api/setTagValue
 *   GET  /api/daq                    -> tag history
 *   GET  /api/alarms, /api/alarmsHistory, POST /api/alarmack
 *   GET  /_widgets/<group>/<file>    -> widget SVGs and widgets.json
 */
import type { Project, View, Device, AlarmDefinition } from './types.js';

export class ScadaCraftError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface ClientOptions {
  url: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

export interface ActiveAlarm {
  name: string;
  type: string;
  ontime: number;
  offtime: number;
  acktime: number;
  status: string;
  text?: string;
  group?: string;
  toack: number;
  value?: unknown;
}

export interface AlarmHistoryRow {
  name: string;
  type: string;
  status: string;
  text?: string;
  group?: string;
  ontime: number;
  offtime: number;
  acktime: number;
  userack?: string;
  value?: unknown;
}

export interface Plugin {
  name: string;
  type: string;
  version: string;
  current: string;
  group: string;
  [key: string]: unknown;
}

export class ScadaCraftClient {
  readonly baseUrl: string;
  private token?: string;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
  }

  private async request(path: string, init: RequestInit = {}, retryAuth = true, timeoutMs?: number): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('x-access-token', this.token);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs ?? this.options.timeoutMs ?? 20000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ScadaCraftError(
        `Cannot reach ScadaCraft at ${this.baseUrl} (${reason}). Check that the server is running and SCADACRAFT_URL is correct.`,
      );
    }
    if ((res.status === 401 || res.status === 403) && retryAuth && this.options.username) {
      await this.signIn();
      return this.request(path, init, false, timeoutMs);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ScadaCraftError(
          'ScadaCraft refused the request (authentication required or insufficient rights). Set SCADACRAFT_USERNAME and SCADACRAFT_PASSWORD for an admin user.',
          res.status,
        );
      }
      let message = body.slice(0, 400);
      try {
        const json = JSON.parse(body) as { message?: unknown };
        if (json.message) message = String(json.message);
      } catch { /* not JSON */ }
      throw new ScadaCraftError(`ScadaCraft ${init.method ?? 'GET'} ${path.split('?')[0]} failed (HTTP ${res.status}): ${message}`, res.status);
    }
    return res;
  }

  async signIn(): Promise<void> {
    const res = await this.request(
      '/api/signin',
      { method: 'POST', body: JSON.stringify({ username: this.options.username, password: this.options.password }) },
      false,
    );
    const json = (await res.json()) as { data?: { token?: string } };
    if (!json.data?.token) {
      throw new ScadaCraftError('Sign-in to ScadaCraft failed: no token returned. Check SCADACRAFT_USERNAME and SCADACRAFT_PASSWORD.');
    }
    this.token = json.data.token;
  }

  // ------------------------------------------------------------ project
  async getProject(): Promise<Project> {
    const res = await this.request('/api/project');
    return (await res.json()) as Project;
  }

  /** Replace the whole project. The ScadaCraft runtime restarts all devices. */
  async replaceProject(project: Project): Promise<void> {
    await this.request('/api/project', { method: 'POST', body: JSON.stringify(project) }, true, 120000);
  }

  async setProjectData(cmd: string, data: unknown): Promise<void> {
    await this.request('/api/projectData', { method: 'POST', body: JSON.stringify({ cmd, data }) });
  }

  saveView(view: View): Promise<void> {
    return this.setProjectData('set-view', view);
  }

  deleteView(view: View): Promise<void> {
    return this.setProjectData('del-view', view);
  }

  saveDevice(device: Device): Promise<void> {
    return this.setProjectData('set-device', device);
  }

  deleteDevice(device: Device): Promise<void> {
    return this.setProjectData('del-device', device);
  }

  saveAlarm(alarm: AlarmDefinition): Promise<void> {
    return this.setProjectData('set-alarm', alarm);
  }

  deleteAlarm(alarm: AlarmDefinition): Promise<void> {
    return this.setProjectData('del-alarm', alarm);
  }

  /** Device credentials (OPC UA, MQTT, ODBC), stored outside the project. */
  async setDeviceSecurity(deviceId: string, value: Record<string, unknown> | ''): Promise<void> {
    await this.request('/api/device', { method: 'POST', body: JSON.stringify({ params: { query: 'security', name: deviceId, value } }) });
  }

  // ------------------------------------------------------------ live data
  async getTagValues(ids: string[]): Promise<{ id: string; value: unknown; timestamp?: number }[]> {
    const res = await this.request(`/api/getTagValue?ids=${encodeURIComponent(JSON.stringify(ids))}`);
    return (await res.json()) as { id: string; value: unknown; timestamp?: number }[];
  }

  /** Write tag values. The values go to the field devices. */
  async setTagValues(tags: { id: string; value: unknown }[]): Promise<void> {
    await this.request('/api/setTagValue', { method: 'POST', body: JSON.stringify({ tags }) });
  }

  /** Historical values of tags with DAQ enabled. One array per tag, in the order of ids. */
  async getHistory(ids: string[], from: number, to: number): Promise<{ dt: number; value: unknown }[][]> {
    const query = JSON.stringify({ sids: ids, from, to });
    const res = await this.request(`/api/daq?query=${encodeURIComponent(query)}`, {}, true, 120000);
    return (await res.json()) as { dt: number; value: unknown }[][];
  }

  // ------------------------------------------------------------ alarms
  async getActiveAlarms(): Promise<ActiveAlarm[]> {
    const res = await this.request('/api/alarms');
    const text = await res.text();
    return text ? (JSON.parse(text) as ActiveAlarm[]) : [];
  }

  async getAlarmsHistory(start: number, end: number): Promise<AlarmHistoryRow[]> {
    const res = await this.request(`/api/alarmsHistory?start=${start}&end=${end}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as AlarmHistoryRow[]) : [];
  }

  /** Acknowledge one alarm (id "name^~^type") or all alarms (null). */
  async ackAlarm(alarmId: string | null): Promise<void> {
    await this.request('/api/alarmack', { method: 'POST', body: JSON.stringify({ params: alarmId }) });
  }

  // ------------------------------------------------------------ driver plugins
  async getPlugins(): Promise<Plugin[]> {
    const res = await this.request('/api/plugins');
    return (await res.json()) as Plugin[];
  }

  /** Install a driver package (npm, on the ScadaCraft server). Can take minutes. */
  async installPlugin(plugin: Plugin): Promise<void> {
    await this.request('/api/plugins', { method: 'POST', body: JSON.stringify({ params: plugin }) }, true, 600000);
  }

  // ------------------------------------------------------------ static files
  async getText(path: string): Promise<string> {
    const res = await this.request(path);
    return res.text();
  }
}

/**
 * Minimal REST client for a ScadaCraft (FUXA-based) server.
 *
 * Endpoints used:
 *   POST /api/signin              -> { data: { token } }   (only when security is enabled)
 *   GET  /api/project             -> full project (devices, hmi.views, server device, ...)
 *   POST /api/projectData         -> { cmd, data } incremental save (set-view, del-view, set-device)
 *   GET  /_widgets/<group>/<file> -> widget SVGs and widgets.json
 */
import type { Project, View, Device } from './types.js';

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

export class ScadaCraftClient {
  readonly baseUrl: string;
  private token?: string;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
  }

  private async request(path: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('x-access-token', this.token);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ScadaCraftError(
        `Cannot reach ScadaCraft at ${this.baseUrl} (${reason}). Check that the server is running and SCADACRAFT_URL is correct.`,
      );
    }
    if ((res.status === 401 || res.status === 403) && retryAuth && this.options.username) {
      await this.signIn();
      return this.request(path, init, false);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ScadaCraftError(
          'ScadaCraft refused the request (authentication required or insufficient rights). Set SCADACRAFT_USERNAME and SCADACRAFT_PASSWORD for an admin user.',
          res.status,
        );
      }
      throw new ScadaCraftError(`ScadaCraft ${init.method ?? 'GET'} ${path} failed with HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
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

  async getProject(): Promise<Project> {
    const res = await this.request('/api/project');
    return (await res.json()) as Project;
  }

  private async setProjectData(cmd: string, data: unknown): Promise<void> {
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

  /** Current values of tags by id (GET /api/getTagValue). */
  async getTagValues(ids: string[]): Promise<{ id: string; value: unknown; timestamp?: number }[]> {
    const res = await this.request(`/api/getTagValue?ids=${encodeURIComponent(JSON.stringify(ids))}`);
    return (await res.json()) as { id: string; value: unknown; timestamp?: number }[];
  }

  /** Write tag values (POST /api/setTagValue). The values go to the field devices. */
  async setTagValues(tags: { id: string; value: unknown }[]): Promise<void> {
    await this.request('/api/setTagValue', { method: 'POST', body: JSON.stringify({ tags }) });
  }

  async getText(path: string): Promise<string> {
    const res = await this.request(path);
    return res.text();
  }
}

import { CiderMcpError, mapHttpError, mapNetworkError } from './errors.js';

export const DEFAULT_BASE_URL = 'http://localhost:10767';

/**
 * Cider's own API rejects ids/types/hrefs that contain quotes (its fields
 * validate with /^[^'"]+$/). Reject them here too, so the user gets a clear
 * message instead of a 400 from Cider.
 */
export function assertSafeId(value: string, field: string): void {
  if (/['"]/.test(value)) {
    throw new CiderMcpError('INVALID_ARGUMENT', `${field} must not contain quote characters.`);
  }
}

export class CiderClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { apptoken: this.token };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw mapNetworkError(err);
    }

    if (response.status === 204) return undefined as T;

    const body = await response.json().catch(() => null);
    if (!response.ok) throw mapHttpError(response.status, body);

    // Cider's helper is `Yi(data, meta)` => `meta ? {data, meta} : {data}`. Every
    // paginated handler passes meta with {offset, limit, total}. Dropping it would
    // lose `total`, leaving callers unable to tell whether more pages exist.
    const envelope = body as { data?: unknown; meta?: unknown } | null;
    if (!envelope || !('data' in envelope)) return envelope as T;
    const { data, meta } = envelope;
    if (meta !== undefined && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return { ...(data as Record<string, unknown>), meta } as T;
    }
    return data as T;
  }

  get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return this.request<T>(qs ? `${path}?${qs}` : path);
  }
}

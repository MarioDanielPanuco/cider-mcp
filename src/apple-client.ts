import type { CiderClient } from './cider-client.js';
import { mapHttpError, mapNetworkError } from './errors.js';

export const APPLE_API = 'https://api.music.apple.com';

/**
 * Cider's developer token is an AMPWebPlay/WebPlayKid token carrying
 * root_https_origin: ["apple.com"]. Any other Origin — including cider.sh and
 * localhost — returns 401.
 */
const REQUIRED_ORIGIN = 'https://music.apple.com';

export interface MusicKitTokens {
  developerToken: string;
  userToken: string;
  storefront: string;
}

export class AppleMusicClient {
  private tokens?: MusicKitTokens;

  constructor(private readonly cider: CiderClient) {}

  /**
   * Always read through Cider. Fetched per process, never persisted. The
   * developer token is short-lived (hours); the user token is long-lived
   * (~6 months). Re-fetched once on a 401.
   */
  private async getTokens(force = false): Promise<MusicKitTokens> {
    if (!this.tokens || force) {
      this.tokens = await this.cider.request<MusicKitTokens>('/api/v2/client/tokens');
    }
    return this.tokens;
  }

  async storefront(): Promise<string> {
    return (await this.getTokens()).storefront || 'us';
  }

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let refreshed = false;

    for (;;) {
      const tokens = await this.getTokens(refreshed);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${tokens.developerToken}`,
        'Music-User-Token': tokens.userToken,
        Origin: REQUIRED_ORIGIN,
        // Apple returns gzip otherwise, which breaks naive UTF-8 decoding.
        'Accept-Encoding': 'identity',
      };
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';

      let response: Response;
      try {
        response = await fetch(`${APPLE_API}${path}`, {
          method: init.method ?? 'GET',
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
      } catch (err) {
        throw mapNetworkError(err);
      }

      if (response.status === 401 && !refreshed) {
        // Undici keeps the socket checked out until the body is read or
        // cancelled. Abandoning it here would hold the connection open until GC,
        // so release it explicitly before issuing the retry. Optional chaining
        // short-circuits the whole chain when body is null (e.g. a 204-shaped
        // response), and a cancel that rejects must not mask the retry.
        await response.body?.cancel().catch(() => {});
        refreshed = true;
        continue;
      }

      if (response.status === 204) return undefined as T;

      const body = await response.json().catch(() => null);
      if (!response.ok) throw mapHttpError(response.status, body);
      return body as T;
    }
  }
}

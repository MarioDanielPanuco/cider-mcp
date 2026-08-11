import { describe, expect, it, vi, afterEach } from 'vitest';
import { AppleMusicClient } from '../src/apple-client.js';
import type { CiderClient } from '../src/cider-client.js';

afterEach(() => vi.unstubAllGlobals());

function fakeCider(tokens = { developerToken: 'dev', userToken: 'usr', storefront: 'us' }) {
  return { request: vi.fn().mockResolvedValue(tokens) } as unknown as CiderClient;
}
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('AppleMusicClient', () => {
  it('sends the origin-locked header and opts out of gzip', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await new AppleMusicClient(fakeCider()).request('/v1/me/library/playlists');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.music.apple.com/v1/me/library/playlists');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Origin']).toBe('https://music.apple.com');
    expect(headers['Accept-Encoding']).toBe('identity');
    expect(headers['Authorization']).toBe('Bearer dev');
    expect(headers['Music-User-Token']).toBe('usr');
  });

  it('sends method and JSON-encoded body with a Content-Type header for mutating requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: null }));
    vi.stubGlobal('fetch', fetchMock);

    await new AppleMusicClient(fakeCider()).request('/v1/me/library/playlists', {
      method: 'POST',
      body: { attributes: {} },
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect((init as RequestInit).body).toBe('{"attributes":{}}');
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('no body');
        },
      }),
    );

    await expect(new AppleMusicClient(fakeCider()).request('/v1/me/library/playlists')).resolves.toBeUndefined();
  });

  it('wraps a network failure with mapNetworkError instead of leaking the raw error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })),
    );

    await expect(new AppleMusicClient(fakeCider()).request('/v1/me/library/playlists')).rejects.toMatchObject({
      code: 'CIDER_NOT_RUNNING',
    });
  });

  it('fetches tokens once and reuses them across calls', async () => {
    const cider = fakeCider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ data: [] })));

    const client = new AppleMusicClient(cider);
    await client.request('/v1/me/library/songs');
    await client.request('/v1/me/library/albums');

    expect((cider.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('refreshes tokens once on 401 and retries', async () => {
    const cider = fakeCider();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => null })
      .mockResolvedValueOnce(ok({ data: ['after-refresh'] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AppleMusicClient(cider).request('/v1/me/library/songs');

    // AppleMusicClient returns Apple's body verbatim; only CiderClient unwraps {data}.
    expect(result).toEqual({ data: ['after-refresh'] });
    expect((cider.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('cancels the abandoned 401 body before retrying so undici can release the socket', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, body: { cancel }, json: async () => null })
      .mockResolvedValueOnce(ok({ data: ['after-refresh'] }));
    vi.stubGlobal('fetch', fetchMock);

    await new AppleMusicClient(fakeCider()).request('/v1/me/library/songs');

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('retries even when cancelling the 401 body rejects', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        body: { cancel: vi.fn().mockRejectedValue(new Error('already locked')) },
        json: async () => null,
      })
      .mockResolvedValueOnce(ok({ data: ['after-refresh'] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AppleMusicClient(fakeCider()).request('/v1/me/library/songs')).resolves.toEqual({
      data: ['after-refresh'],
    });
  });

  it('gives up after a single refresh so a hard 401 does not loop', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => null });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AppleMusicClient(fakeCider()).request('/v1/me/library/songs')).rejects.toMatchObject({
      code: 'APPLE_UNAUTHORIZED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('AppleMusicClient#storefront', () => {
  it('returns the storefront reported by Cider', async () => {
    const cider = fakeCider({ developerToken: 'dev', userToken: 'usr', storefront: 'jp' });

    await expect(new AppleMusicClient(cider).storefront()).resolves.toBe('jp');
  });

  it('falls back to "us" when Cider reports an empty storefront', async () => {
    const cider = fakeCider({ developerToken: 'dev', userToken: 'usr', storefront: '' });

    await expect(new AppleMusicClient(cider).storefront()).resolves.toBe('us');
  });
});

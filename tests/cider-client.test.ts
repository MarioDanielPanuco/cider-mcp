import { describe, expect, it, vi, afterEach } from 'vitest';
import { CiderClient, assertSafeId } from '../src/cider-client.js';
import { CiderMcpError } from '../src/errors.js';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('CiderClient', () => {
  it('sends the apptoken header and unwraps the data envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { volume: 0.5 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new CiderClient('tok').request<{ volume: number }>('/api/v2/audio/volume');

    expect(result).toEqual({ volume: 0.5 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:10767/api/v2/audio/volume');
    expect((init as RequestInit).headers).toMatchObject({ apptoken: 'tok' });
  });

  it('preserves the meta envelope so paginated callers keep total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { data: { items: [] }, meta: { offset: 0, limit: 50, total: 812 } })),
    );

    const result = await new CiderClient('tok').request<{ items: unknown[]; meta: { total: number } }>(
      '/api/v2/library/songs',
    );

    expect(result.meta.total).toBe(812);
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
    await expect(new CiderClient('tok').request('/api/v2/playback/play', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('translates an error body into a CiderMcpError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'UNAUTHORIZED_APP_TOKEN' })));
    await expect(new CiderClient('tok').request('/api/v2/queue')).rejects.toMatchObject({
      code: 'UNAUTHORIZED_APP_TOKEN',
    });
  });

  it('reports Cider as not running when the connection is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })));
    await expect(new CiderClient('tok').request('/api/v2/queue')).rejects.toMatchObject({
      code: 'CIDER_NOT_RUNNING',
    });
  });

  it('builds query strings and omits undefined values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await new CiderClient('tok').get('/api/v2/library/songs', { offset: 0, limit: 25, cursor: undefined });

    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:10767/api/v2/library/songs?offset=0&limit=25');
  });

  it('sends method and JSON-encoded body with a Content-Type header for mutating requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: null }));
    vi.stubGlobal('fetch', fetchMock);

    await new CiderClient('tok').request('/x', { method: 'PUT', body: { a: 1 } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('PUT');
    expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect((init as RequestInit).body).toBe('{"a":1}');
  });
});

describe('assertSafeId', () => {
  it("rejects quotes, which Cider's own API forbids in these fields", () => {
    expect(() => assertSafeId(`a"b`, 'id')).toThrow(CiderMcpError);
    expect(() => assertSafeId("a'b", 'id')).toThrow(CiderMcpError);
  });

  it('accepts ordinary catalog ids', () => {
    expect(() => assertSafeId('1625058484', 'id')).not.toThrow();
  });
});

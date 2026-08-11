import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

const getPassword = vi.hoisted(() => vi.fn());
const setPassword = vi.hoisted(() => vi.fn());
const clearPassword = vi.hoisted(() => vi.fn());
vi.mock('../src/keychain.js', () => ({ getPassword, setPassword, clearPassword }));

const readFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile }));

import { acquireAppToken, tokenFromConfig, CIDER_SCOPES, SPA_CONFIG_PATH } from '../src/token.js';

beforeEach(() => {
  getPassword.mockReset();
  setPassword.mockReset();
  clearPassword.mockReset();
  readFile.mockReset();
  delete process.env.CIDER_APP_TOKEN;
});
afterEach(() => vi.unstubAllGlobals());

describe('acquireAppToken', () => {
  it('uses a valid stored token (200) and does not re-pair', async () => {
    getPassword.mockResolvedValue('from-keychain');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(acquireAppToken()).resolves.toBe('from-keychain');
    // The only network call is validation against /client/info — never /auth/request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/v2/client/info');
    expect(init.headers).toMatchObject({ apptoken: 'from-keychain' });
    // The validation fetch is bounded so a hung Cider cannot wedge startup.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(clearPassword).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('times out a hung validation fetch and keeps the token rather than wedging startup', async () => {
    getPassword.mockResolvedValue('from-keychain');
    // Reject with an AbortError, the shape AbortSignal.timeout produces on expiry.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
    );

    await expect(acquireAppToken()).resolves.toBe('from-keychain');
    expect(clearPassword).not.toHaveBeenCalled();
  });

  it('clears a stored token that Cider rejects (403) and falls through to the env token', async () => {
    getPassword.mockResolvedValue('dead-keychain-token');
    process.env.CIDER_APP_TOKEN = 'from-env';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'UNAUTHORIZED_APP_TOKEN' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(acquireAppToken()).resolves.toBe('from-env');
    expect(clearPassword).toHaveBeenCalledWith('cider-mcp', 'app-token');
    // Env path still ran and persisted the fresh token.
    expect(setPassword).toHaveBeenCalledWith('cider-mcp', 'app-token', 'from-env');
  });

  it('keeps the stored token when validation fails with a network error', async () => {
    getPassword.mockResolvedValue('from-keychain');
    // A Cider hiccup at startup must never nuke a good credential.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(acquireAppToken()).resolves.toBe('from-keychain');
    expect(clearPassword).not.toHaveBeenCalled();
  });

  it('keeps the stored token when validation returns 5xx (unknown, not a confirmed rejection)', async () => {
    getPassword.mockResolvedValue('from-keychain');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => null }),
    );

    await expect(acquireAppToken()).resolves.toBe('from-keychain');
    expect(clearPassword).not.toHaveBeenCalled();
  });

  it('does not abort acquisition when saving the token to the Keychain throws', async () => {
    getPassword.mockResolvedValue(null);
    process.env.CIDER_APP_TOKEN = 'from-env';
    setPassword.mockRejectedValue(new Error('keychain is locked'));

    await expect(acquireAppToken()).resolves.toBe('from-env');
  });

  it('falls back to CIDER_APP_TOKEN and persists it to the Keychain', async () => {
    getPassword.mockResolvedValue(null);
    process.env.CIDER_APP_TOKEN = 'from-env';

    await expect(acquireAppToken()).resolves.toBe('from-env');
    expect(setPassword).toHaveBeenCalledWith('cider-mcp', 'app-token', 'from-env');
  });

  it('pairs when nothing is stored, and saves the result', async () => {
    getPassword.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { token: 'from-pairing', scopes: [] } }),
      }),
    );

    await expect(acquireAppToken()).resolves.toBe('from-pairing');
    expect(setPassword).toHaveBeenCalledWith('cider-mcp', 'app-token', 'from-pairing');
  });

  it('sends no AbortSignal, because approval outlasts any sane timeout', async () => {
    getPassword.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { token: 't', scopes: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await acquireAppToken();
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('signal');
  });

  it('recovers the token from spa-config.yml when the pairing response is lost', async () => {
    getPassword.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));
    readFile.mockResolvedValue(`connectivity:
  apiTokens:
    - name: Cider MCP
      token: recovered-token
      scopes:
        - playback
`);

    await expect(acquireAppToken()).resolves.toBe('recovered-token');
  });

  it('sends the pairing request to the expected endpoint, method, and body', async () => {
    getPassword.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { token: 'from-pairing', scopes: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await acquireAppToken({ baseUrl: 'http://localhost:10767' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:10767/api/v2/auth/request');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init.body)).toEqual({
      app_name: 'Cider MCP',
      scopes: [...CIDER_SCOPES],
    });
  });

  it('reports CIDER_NOT_RUNNING, not the generic pairing message, when Cider is unreachable', async () => {
    getPassword.mockResolvedValue(null);
    // The real shape global fetch() rejects with on a refused connection:
    // a TypeError wrapping the errno error in `.cause`, not a bare {code}.
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:10767'), {
      code: 'ECONNREFUSED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause })));

    await expect(acquireAppToken()).rejects.toMatchObject({ code: 'CIDER_NOT_RUNNING' });
    // No point reading the config file: Cider never received the request, so
    // no token could have been minted for the lost-response race to recover.
    expect(readFile).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe('CIDER_SCOPES', () => {
  it('requests the mandatory "account" scope — the only source of MusicKit tokens', () => {
    expect(CIDER_SCOPES).toContain('account');
  });
});

describe('SPA_CONFIG_PATH', () => {
  it('points at spa-config.yml under Cider\'s Application Support directory', () => {
    expect(SPA_CONFIG_PATH).toBe(
      join(homedir(), 'Library', 'Application Support', 'sh.cider.genten', 'spa-config.yml'),
    );
  });
});

describe('tokenFromConfig', () => {
  it('returns null when no entry matches the app name', () => {
    expect(tokenFromConfig('apiTokens:\n    - name: Other\n      token: xyz\n')).toBeNull();
  });

  it('returns the most recently paired entry, not the first, when several match', () => {
    const yaml = `connectivity:
  apiTokens:
    - name: Cider MCP
      token: stale-revoked-token
      scopes:
        - playback
    - name: Cider MCP
      token: fresh-token
      scopes:
        - playback
        - account
`;
    expect(tokenFromConfig(yaml)).toBe('fresh-token');
  });
});

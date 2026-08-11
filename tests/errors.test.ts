import { describe, expect, it } from 'vitest';
import { CiderMcpError, mapHttpError, mapNetworkError } from '../src/errors.js';

describe('mapHttpError', () => {
  it('maps an unauthorized app token to the real Keychain-clearing recovery', () => {
    const err = mapHttpError(403, { error: 'UNAUTHORIZED_APP_TOKEN' });
    expect(err).toBeInstanceOf(CiderMcpError);
    expect(err.code).toBe('UNAUTHORIZED_APP_TOKEN');
    // A dead token sits in the Keychain and wins over everything, so restarting
    // alone cannot re-pair — the message must name the delete command.
    expect(err.message).toContain(
      'security delete-generic-password -s cider-mcp -a app-token',
    );
  });

  it('names the missing scope on INSUFFICIENT_SCOPE', () => {
    const err = mapHttpError(403, {
      error: { code: 'INSUFFICIENT_SCOPE', message: 'requires scope: library' },
    });
    expect(err.code).toBe('INSUFFICIENT_SCOPE');
    expect(err.message).toContain('library');
  });

  it('maps a 504 RPC_TIMEOUT to a renderer-busy message', () => {
    const err = mapHttpError(504, { error: { code: 'RPC_TIMEOUT' } });
    expect(err.code).toBe('RPC_TIMEOUT');
    expect(err.message).toMatch(/did not respond/i);
  });

  it('maps 409 to AUTH_REQUEST_BUSY', () => {
    const err = mapHttpError(409, { error: { code: 'AUTH_REQUEST_BUSY' } });
    expect(err.code).toBe('AUTH_REQUEST_BUSY');
  });

  it('falls back to UNKNOWN with the status in the message', () => {
    const err = mapHttpError(500, { nope: true });
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toContain('500');
  });
});

describe('mapNetworkError', () => {
  it('maps ECONNREFUSED to a Cider-not-running message', () => {
    const err = mapNetworkError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    expect(err.code).toBe('CIDER_NOT_RUNNING');
    expect(err.message).toMatch(/Cider/);
  });

  it('maps the real shape undici\'s fetch() rejects with — a TypeError whose .code-bearing cause is one level down', () => {
    // This is what global fetch() actually throws on a refused connection: not
    // a bare `{code}` object, but `TypeError: fetch failed` wrapping the real
    // errno error in `.cause`.
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:10767'), {
      code: 'ECONNREFUSED',
      errno: -61,
    });
    const err = mapNetworkError(Object.assign(new TypeError('fetch failed'), { cause }));
    expect(err.code).toBe('CIDER_NOT_RUNNING');
    expect(err.message).toMatch(/Cider/);
  });

  it('falls back to UNKNOWN when neither the error nor its cause carries a recognized code', () => {
    const err = mapNetworkError(new Error('socket hang up'));
    expect(err.code).toBe('UNKNOWN');
  });
});

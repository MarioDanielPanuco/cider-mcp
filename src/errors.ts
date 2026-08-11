export type CiderErrorCode =
  | 'CIDER_NOT_RUNNING'
  | 'UNAUTHORIZED_APP_TOKEN'
  | 'INSUFFICIENT_SCOPE'
  | 'RPC_TIMEOUT'
  | 'AUTH_REQUEST_BUSY'
  | 'AUTH_REQUEST_TIMEOUT'
  | 'AUTH_REQUEST_DENIED'
  | 'APPLE_UNAUTHORIZED'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN';

export class CiderMcpError extends Error {
  constructor(
    public readonly code: CiderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CiderMcpError';
  }
}

/** Cider returns either `{error: "CODE"}` or `{error: {code, message}}`. Normalise both. */
function extract(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return { code: error };
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === 'string' ? e.code : undefined,
      message: typeof e.message === 'string' ? e.message : undefined,
    };
  }
  return {};
}

export function mapHttpError(status: number, body: unknown): CiderMcpError {
  const { code, message } = extract(body);

  switch (code) {
    case 'UNAUTHORIZED_APP_TOKEN':
      return new CiderMcpError(
        'UNAUTHORIZED_APP_TOKEN',
        'Cider rejected the app token. It was revoked or never granted — run `security delete-generic-password -s cider-mcp -a app-token` and restart the server (or set CIDER_APP_TOKEN to a fresh token).',
      );
    case 'INSUFFICIENT_SCOPE':
      return new CiderMcpError(
        'INSUFFICIENT_SCOPE',
        `The app token is missing a required scope${message ? ` (${message})` : ''}. Run \`security delete-generic-password -s cider-mcp -a app-token\`, revoke it in Cider under Settings -> Connectivity -> Manage External Application Access, then restart the server to re-pair with the full scopes.`,
      );
    case 'RPC_TIMEOUT':
      return new CiderMcpError(
        'RPC_TIMEOUT',
        "Cider's interface did not respond in time. It may be busy or mid-launch — try again.",
      );
    case 'AUTH_REQUEST_BUSY':
      return new CiderMcpError(
        'AUTH_REQUEST_BUSY',
        'A pairing dialog is already open in Cider. Approve or dismiss it, then retry.',
      );
    case 'AUTH_REQUEST_TIMEOUT':
      return new CiderMcpError(
        'AUTH_REQUEST_TIMEOUT',
        'Cider closed the approval dialog before it was answered (it allows about two minutes). Restart this server to try again, and approve promptly.',
      );
    case 'AUTH_REQUEST_DENIED':
      return new CiderMcpError(
        'AUTH_REQUEST_DENIED',
        'Access was declined in Cider. Restart this server to request again.',
      );
  }

  if (status === 401) {
    return new CiderMcpError(
      'APPLE_UNAUTHORIZED',
      'Apple Music rejected the request. The borrowed MusicKit token may have expired, or the operation is not permitted with it (playlist deletion is never permitted).',
    );
  }

  return new CiderMcpError('UNKNOWN', `Unexpected response from Cider (HTTP ${status})${message ? `: ${message}` : ''}.`);
}

/**
 * Pulls a `code` (e.g. `ECONNREFUSED`) off a thrown value. Node's own network
 * errors carry it at the top level, but undici's global `fetch` (what we use
 * to talk to Cider) always rejects with a `TypeError: fetch failed` whose
 * real cause — including `code` — lives one level down at `err.cause`.
 */
function networkErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return undefined;
}

export function mapNetworkError(err: unknown): CiderMcpError {
  const code = networkErrorCode(err);
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    return new CiderMcpError(
      'CIDER_NOT_RUNNING',
      'Could not reach Cider on port 10767. Make sure Cider is running and its external API is enabled.',
    );
  }
  return new CiderMcpError('UNKNOWN', `Network failure talking to Cider: ${(err as Error)?.message ?? String(err)}`);
}

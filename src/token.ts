import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getPassword, setPassword, clearPassword } from './keychain.js';
import { CiderMcpError, mapHttpError, mapNetworkError } from './errors.js';

const SERVICE = 'cider-mcp';
const ACCOUNT = 'app-token';
const APP_NAME = 'Cider MCP';

export const CIDER_SCOPES = ['playback', 'queue', 'library', 'audio', 'account'] as const;

export const SPA_CONFIG_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'sh.cider.genten',
  'spa-config.yml',
);

/**
 * Pulls our token out of Cider's config. Deliberately a targeted regex rather than
 * a YAML dependency: we need exactly one field from a large file whose shape we do
 * not otherwise care about.
 */
export function tokenFromConfig(yaml: string, appName = APP_NAME): string | null {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`-\\s*name:\\s*${escaped}\\s*\\n\\s*token:\\s*(\\S+)`, 'g');

  // Each approval appends a new entry, so the earliest match can be a stale
  // or revoked token from a prior pairing. Walk every match and keep the
  // last one — the most recent approval wins.
  let lastToken: string | null = null;
  for (let match = pattern.exec(yaml); match !== null; match = pattern.exec(yaml)) {
    lastToken = match[1] ?? lastToken;
  }
  return lastToken;
}

/** Removes our token from the Keychain. Best-effort — {@link clearPassword} never throws. */
export async function clearStoredToken(): Promise<void> {
  await clearPassword(SERVICE, ACCOUNT);
}

/**
 * Persists the token to the Keychain without ever letting a write failure abort
 * startup: a token already in hand is worth more than a Keychain entry. On
 * failure we log one line and carry on with the token.
 */
async function saveTokenBestEffort(token: string): Promise<void> {
  try {
    await setPassword(SERVICE, ACCOUNT, token);
  } catch (err) {
    process.stderr.write(
      `[cider-mcp] warning: could not save token to Keychain: ${(err as Error)?.message ?? String(err)}\n`,
    );
  }
}

/** Cider signals a rejected token via `{error:'UNAUTHORIZED_APP_TOKEN'}` or `{error:{code:'INSUFFICIENT_SCOPE'}}`. */
function isTokenRejection(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (error === 'UNAUTHORIZED_APP_TOKEN' || error === 'INSUFFICIENT_SCOPE') return true;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    return code === 'UNAUTHORIZED_APP_TOKEN' || code === 'INSUFFICIENT_SCOPE';
  }
  return false;
}

type StoredTokenState = 'valid' | 'dead' | 'unknown';

/**
 * Verifies a Keychain-sourced token against Cider before we trust it. A stored
 * token outlives revocation in Cider and, being the highest-priority tier, wins
 * forever — so the one case we act on is a *confirmed* rejection.
 *
 *   200                                        -> 'valid'  (use it)
 *   403, or an UNAUTHORIZED/INSUFFICIENT_SCOPE body -> 'dead'   (clear, fall through)
 *   network error / timeout / 5xx / anything   -> 'unknown' (use it anyway)
 *
 * The 'unknown' bias is deliberate: a Cider hiccup at startup must never nuke a
 * good credential.
 */
async function validateStoredToken(baseUrl: string, token: string): Promise<StoredTokenState> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v2/client/info`, {
      headers: { apptoken: token },
      // Bounded: this is on the startup path, and a hung Cider must not wedge
      // it forever. A timeout falls into the catch below -> 'unknown' -> keep
      // the token, which is the safe bias.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Cider unreachable / mid-launch / timed out: treat as unknown, keep the token.
    return 'unknown';
  }

  if (response.status === 200) {
    // Release the connection; we only care that it was accepted.
    await response.body?.cancel().catch(() => {});
    return 'valid';
  }

  const body = await response.json().catch(() => null);
  if (response.status === 403 || isTokenRejection(body)) return 'dead';

  // 5xx, unexpected statuses: not a confirmed rejection, so leave it alone.
  return 'unknown';
}

async function pair(baseUrl: string): Promise<string | null> {
  // No AbortSignal by design. Cider itself bounds the wait (~120 s, then 408
  // AUTH_REQUEST_TIMEOUT), so a client-side timeout adds nothing except the
  // failure mode we actually hit in testing: the client gives up, the user
  // approves anyway, and a valid token is minted that the client never sees.
  // The config-file fallback below exists for exactly that race.
  //
  // fetch() itself rejects (rather than resolving with a non-ok Response) on
  // connection failure, e.g. Cider isn't running. That rejection is a plain
  // TypeError, not a CiderMcpError, so it's routed through mapNetworkError
  // here to get an accurate diagnosis (CIDER_NOT_RUNNING) instead of falling
  // through to the generic "approve the dialog" message.
  const response = await fetch(`${baseUrl}/api/v2/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_name: APP_NAME, scopes: [...CIDER_SCOPES] }),
  }).catch((err: unknown) => {
    throw mapNetworkError(err);
  });

  if (!response.ok) throw mapHttpError(response.status, await response.json().catch(() => null));

  const body = (await response.json()) as { data?: { token?: string } };
  return body.data?.token ?? null;
}

export async function acquireAppToken(
  opts: { baseUrl?: string; configPath?: string } = {},
): Promise<string> {
  const baseUrl = opts.baseUrl ?? 'http://localhost:10767';
  const configPath = opts.configPath ?? SPA_CONFIG_PATH;

  const stored = await getPassword(SERVICE, ACCOUNT);
  if (stored) {
    // A revoked Keychain token stays put and, as the top-priority tier, would
    // win forever. Verify it first; only a *confirmed* rejection clears it and
    // falls through to env/pair/recovery. Anything ambiguous keeps the token.
    if ((await validateStoredToken(baseUrl, stored)) !== 'dead') return stored;
    await clearStoredToken();
  }

  const fromEnv = process.env.CIDER_APP_TOKEN?.trim();
  if (fromEnv) {
    await saveTokenBestEffort(fromEnv);
    return fromEnv;
  }

  process.stderr.write(
    `[cider-mcp] Requesting access from Cider. Approve the "${APP_NAME}" dialog in Cider to continue.\n`,
  );

  let paired: string | null = null;
  try {
    paired = await pair(baseUrl);
  } catch (err) {
    if (err instanceof CiderMcpError && err.code !== 'UNKNOWN') throw err;
    // Fall through: the token may exist even though we lost the response.
  }

  if (!paired) {
    const yaml = await readFile(configPath, 'utf8').catch(() => null);
    paired = yaml ? tokenFromConfig(yaml) : null;
  }

  if (!paired) {
    throw new CiderMcpError(
      'UNAUTHORIZED_APP_TOKEN',
      `Could not obtain a Cider app token. Approve the "${APP_NAME}" dialog in Cider, or generate a token under Settings -> Connectivity -> Manage External Application Access and set CIDER_APP_TOKEN.`,
    );
  }

  await saveTokenBestEffort(paired);
  return paired;
}

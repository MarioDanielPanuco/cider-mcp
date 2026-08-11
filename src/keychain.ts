import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Reads a generic password. Returns null when the item is absent (security exits 44). */
export async function getPassword(service: string, account: string): Promise<string | null> {
  try {
    const { stdout } = await run('security', [
      'find-generic-password',
      '-s', service,
      '-a', account,
      '-w',
    ]);
    const secret = stdout.trim();
    return secret.length > 0 ? secret : null;
  } catch {
    // Exit 44 = item not found. Any other failure (locked keychain, no TTY) is
    // also non-fatal here: callers fall through to the next acquisition tier.
    return null;
  }
}

/**
 * Deletes a generic password. Best-effort cleanup: never throws. `security`
 * exits 44 when there is no such item, and any other failure (locked keychain,
 * no `security` on PATH) is equally non-fatal here — the caller is discarding a
 * dead credential, not depending on the delete having happened.
 */
export async function clearPassword(service: string, account: string): Promise<void> {
  try {
    await run('security', [
      'delete-generic-password',
      '-s', service,
      '-a', account,
    ]);
  } catch {
    // Exit 44 = item not found; every other failure is swallowed too. A failed
    // delete must never propagate — this is cleanup, not a precondition.
  }
}

/** How long `security add-generic-password` gets before we kill it. */
const SET_PASSWORD_TIMEOUT_MS = 10_000;

/**
 * Writes a generic password, replacing any existing item (-U).
 *
 * The secret goes over stdin, never argv: argv is world-readable in the process
 * table (`ps -ww`) for the lifetime of the call, so `-w <secret>` leaks it to
 * every local user. Given a bare `-w`, `security` instead prompts twice —
 * "password data for new item:" then "retype password for new item:" — and
 * reads both from stdin, hence the secret is written twice.
 *
 * Writing it only once is a silent-corruption trap: security compares the
 * secret against EOF, reports "passwords don't match", stores an EMPTY password
 * and still exits 0.
 *
 * Those prompts go through getpass(3), which reads /dev/tty whenever a
 * controlling terminal can be opened and only falls back to stdin when it
 * cannot. Launched by an MCP client the process has no controlling terminal, so
 * the stdin path is taken and all is well; run from an interactive shell
 * (`npm run dev`, `npx cider-mcp`, first-run pairing) the child inherits our
 * terminal and blocks on /dev/tty for input that is arriving on the pipe —
 * hanging the whole startup path forever.
 *
 * `detached: true` is the fix: libuv setsid()s the child into a new session
 * with no controlling terminal, so open("/dev/tty") fails with ENXIO and
 * getpass falls back to stdin. It has to be `spawn`, not `execFile` — execFile
 * forwards only a fixed subset of options to spawn and silently drops
 * `detached`, so the child keeps our terminal and still hangs. The child is
 * otherwise an ordinary awaitable child process; only its session changes.
 *
 * The timeout is belt-and-braces on top of that: a keychain write on the
 * startup path must fail loudly rather than wedge the server forever.
 */
export async function setPassword(service: string, account: string, secret: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const child = spawn(
      'security',
      [
        'add-generic-password',
        '-U',
        '-s', service,
        '-a', account,
        '-w',
      ],
      // stdout is always empty on this subcommand; stderr carries both the
      // getpass prompts and any real diagnostic, so keep it for the error path.
      { detached: true, stdio: ['pipe', 'ignore', 'pipe'] },
    );

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        new Error(
          `security add-generic-password did not finish within ${SET_PASSWORD_TIMEOUT_MS}ms and was killed; the keychain item for service "${service}" was not written.`,
        ),
      );
    }, SET_PASSWORD_TIMEOUT_MS);
    // Never let a pending kill-timer be the only thing holding the loop open.
    timer.unref?.();

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      // Bounded: a wedged child must not be able to grow this without limit.
      if (stderr.length < 4096) stderr += chunk.toString();
    });

    // ENOENT (no `security` on PATH) arrives here, not as a non-zero exit.
    child.on('error', (err: Error) => finish(err));
    child.on('close', (code, signal) => {
      if (code === 0) return finish();
      const detail = stderr.trim();
      finish(
        new Error(
          `security add-generic-password failed (${signal ? `signal ${signal}` : `exit code ${code}`})${detail ? `: ${detail}` : ''}`,
        ),
      );
    });

    // A spawn failure (no `security` on PATH) tears the pipe down before the
    // write lands; without this the EPIPE surfaces as an unhandled 'error'.
    child.stdin?.on('error', () => {});
    child.stdin?.end(`${secret}\n${secret}\n`);
  });
}

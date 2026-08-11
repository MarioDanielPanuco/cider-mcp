import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));

// Promisify calls execFile[util.promisify.custom] if present, else wraps the callback form.
import { getPassword, setPassword, clearPassword } from '../src/keychain.js';

// Block body, not a concise arrow: mockReset() returns the mock itself, and a hook
// that returns a function has that function called as a teardown callback with no
// arguments — which blows up inside the mock as "cb is not a function".
beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe('getPassword', () => {
  it('returns the secret on success', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, { stdout: 'sekrit\n', stderr: '' }));
    await expect(getPassword('cider-mcp', 'app-token')).resolves.toBe('sekrit');
  });

  it('returns null when the item does not exist', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) =>
      cb(Object.assign(new Error('not found'), { code: 44 })),
    );
    await expect(getPassword('cider-mcp', 'app-token')).resolves.toBeNull();
  });
});

describe('clearPassword', () => {
  it('runs delete-generic-password and resolves on success', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, { stdout: '', stderr: '' }));
    await expect(clearPassword('cider-mcp', 'app-token')).resolves.toBeUndefined();
    expect(execFileMock.mock.calls[0]![0]).toBe('security');
    const args = execFileMock.mock.calls[0]![1] as string[];
    expect(args).toContain('delete-generic-password');
    expect(args).toContain('cider-mcp');
    expect(args).toContain('app-token');
  });

  it('does not throw when the item is absent (security exits 44)', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) =>
      cb(Object.assign(new Error('not found'), { code: 44 })),
    );
    await expect(clearPassword('cider-mcp', 'app-token')).resolves.toBeUndefined();
  });

  it('swallows any other failure — deletion is best-effort cleanup', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) =>
      cb(Object.assign(new Error('spawn security ENOENT'), { code: 'ENOENT' })),
    );
    await expect(clearPassword('cider-mcp', 'app-token')).resolves.toBeUndefined();
  });
});

describe('setPassword', () => {
  // setPassword drives the child directly (it needs stdin, and it needs the
  // `detached` option that execFile refuses to forward), so the mock has to hand
  // back a child-shaped object: writable stdin, readable stderr, and events.
  function stubChild(
    outcome: { code?: number; signal?: string; stderr?: string; hang?: boolean } = {},
  ) {
    const child = Object.assign(new EventEmitter(), {
      stdin: { on: vi.fn(), end: vi.fn() },
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    spawnMock.mockImplementation(() => {
      if (!outcome.hang) {
        // Later tick: setPassword attaches its listeners after spawn returns.
        setImmediate(() => {
          if (outcome.stderr) child.stderr.emit('data', Buffer.from(outcome.stderr));
          child.emit('close', outcome.code ?? 0, outcome.signal ?? null);
        });
      }
      return child;
    });
    return child;
  }

  const argvOf = () => spawnMock.mock.calls[0]![1] as string[];
  const optsOf = () => spawnMock.mock.calls[0]![2] as { detached?: boolean; stdio?: unknown[] };

  it('passes -U so an existing item is updated rather than duplicated', async () => {
    stubChild();
    await setPassword('cider-mcp', 'app-token', 'abc');
    expect(spawnMock.mock.calls[0]![0]).toBe('security');
    expect(argvOf()).toContain('-U');
    expect(argvOf()).toContain('cider-mcp');
  });

  it('never puts the secret in argv, where ps would expose it to any local user', async () => {
    stubChild();
    await setPassword('cider-mcp', 'app-token', 'sup3r-s3cret');
    const args = argvOf();
    expect(args).not.toContain('sup3r-s3cret');
    expect(args.some((a) => a.includes('sup3r-s3cret'))).toBe(false);
    // Bare -w is what makes security read the password from stdin.
    expect(args[args.length - 1]).toBe('-w');
  });

  it('writes the secret to stdin twice, because security prompts for a retype', async () => {
    const child = stubChild();
    await setPassword('cider-mcp', 'app-token', 'sup3r-s3cret');
    // Sending it once makes security compare against EOF: it stores an EMPTY
    // password and still exits 0, so the count here is load-bearing.
    expect(child.stdin.end).toHaveBeenCalledWith('sup3r-s3cret\nsup3r-s3cret\n');
  });

  it('detaches the child so getpass cannot reach /dev/tty and falls back to stdin', async () => {
    stubChild();
    await setPassword('cider-mcp', 'app-token', 'abc');
    // Without this the child keeps our controlling terminal, security prompts on
    // /dev/tty, and the whole startup path hangs forever under an interactive
    // shell. It must be spawn, too: execFile drops `detached` on the floor.
    expect(optsOf().detached).toBe(true);
    expect(optsOf().stdio?.[0]).toBe('pipe');
  });

  it('rejects with the exit code and stderr when security fails', async () => {
    stubChild({ code: 1, stderr: 'security: SecKeychainItemCreateFromContent: boom\n' });
    await expect(setPassword('cider-mcp', 'app-token', 'abc')).rejects.toThrow(
      /exit code 1.*boom/s,
    );
  });

  it('rejects when the child cannot be spawned at all', async () => {
    const child = stubChild({ hang: true });
    const promise = setPassword('cider-mcp', 'app-token', 'abc');
    const assertion = expect(promise).rejects.toThrow('spawn security ENOENT');
    child.emit('error', new Error('spawn security ENOENT'));
    await assertion;
  });

  it('kills the child and rejects instead of hanging forever', async () => {
    vi.useFakeTimers();
    try {
      const child = stubChild({ hang: true });
      const promise = setPassword('cider-mcp', 'app-token', 'abc');
      const assertion = expect(promise).rejects.toThrow(/did not finish within 10000ms/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});

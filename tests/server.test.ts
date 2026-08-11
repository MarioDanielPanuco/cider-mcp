import { describe, expect, it } from 'vitest';
import { InMemoryTransport, LATEST_PROTOCOL_VERSION, type McpServer } from '@modelcontextprotocol/server';
import { buildServer, toContent, toErrorContent } from '../src/server.js';
import { CiderMcpError } from '../src/errors.js';
import { allTools } from '../src/tools/index.js';
import type { Deps } from '../src/tools/types.js';

describe('buildServer', () => {
  // The riskiest line in the codebase is registerTool(name, {inputSchema: z.object(...)})
  // against SDK v2. tsc cannot catch a runtime registration throw, so actually
  // build the server once.
  it('registers every tool without throwing', () => {
    const deps = { cider: {} as never, apple: {} as never };
    expect(() => buildServer(deps)).not.toThrow();
    expect(allTools.length).toBeGreaterThan(30);
  });
});

describe('toContent', () => {
  it('serialises objects as pretty JSON text', () => {
    expect(toContent({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{\n  "a": 1\n}' }] });
  });

  it('reports a bare ok for endpoints that return no body', () => {
    expect(toContent(undefined).content[0]!.text).toBe('ok');
  });
});

describe('toErrorContent', () => {
  it('surfaces the actionable message and marks the result as an error', () => {
    const result = toErrorContent(new CiderMcpError('CIDER_NOT_RUNNING', 'Cider is not running.'));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Cider is not running.');
  });

  it('does not leak stack traces for unexpected errors', () => {
    const result = toErrorContent(new Error('kaboom'));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toMatch(/at .*:\d+:\d+/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end exercise of the registered callback.
//
// The unit tests above cover toContent/toErrorContent in isolation, and the
// registration smoke test proves the tools register — but nothing above ever
// *runs* the closure buildServer installs. Dropping the `await`, handing the
// handler the wrong deps, or deleting the catch arm would all keep the rest of
// the suite green while every real tool call returned garbage. So drive a tool
// the way a client does: over the SDK's own InMemoryTransport, through a real
// initialize handshake and a real tools/call.
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code: number; message: string };
}

/** A live client end wired to `server`, already past the initialize handshake. */
async function connectClient(server: McpServer): Promise<{
  call: (name: string, args: unknown) => Promise<JsonRpcResponse>;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: JsonRpcResponse) => void>();

  clientTransport.onmessage = (message) => {
    const { id } = message as { id?: number };
    if (typeof id !== 'number') return; // notifications
    pending.get(id)?.(message as JsonRpcResponse);
    pending.delete(id);
  };

  await server.connect(serverTransport);
  await clientTransport.start();

  let nextId = 0;
  const request = async (method: string, params: unknown): Promise<JsonRpcResponse> => {
    const id = ++nextId;
    const settled = new Promise<JsonRpcResponse>((resolve) => pending.set(id, resolve));
    await clientTransport.send({ jsonrpc: '2.0', id, method, params } as never);
    return settled;
  };

  await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'cider-mcp-test', version: '0.0.0' },
  });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

  return {
    call: (name, args) => request('tools/call', { name, arguments: args }),
    close: () => clientTransport.close(),
  };
}

/** Deps carrying a single stubbed `cider.request`; no HTTP, no Cider, no Apple. */
function stubDeps(request: (path: string, init?: unknown) => Promise<unknown>): Deps {
  return { cider: { request }, apple: {} } as unknown as Deps;
}

describe('registered tool callback', () => {
  it('awaits the handler and returns its value as pretty JSON', async () => {
    const seen: string[] = [];
    const server = buildServer(
      stubDeps(async (path) => {
        seen.push(path);
        return { name: 'Everything In Its Right Place', artist: 'Radiohead' };
      }),
    );
    const client = await connectClient(server);

    const response = await client.call('now_playing', {});

    // The stub is only reachable if the callback got the deps buildServer was
    // handed, so this pins the wiring as well as the route.
    expect(seen).toEqual(['/api/v2/playback/now-playing']);
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBeFalsy();
    // A dropped `await` would serialise the Promise here and yield "{}".
    expect(response.result?.content).toEqual([
      {
        type: 'text',
        text: '{\n  "name": "Everything In Its Right Place",\n  "artist": "Radiohead"\n}',
      },
    ]);

    await client.close();
  });

  it('passes parsed arguments through to the handler', async () => {
    const bodies: unknown[] = [];
    const server = buildServer(
      stubDeps(async (_path, init) => {
        bodies.push((init as { body?: unknown }).body);
        return undefined;
      }),
    );
    const client = await connectClient(server);

    const response = await client.call('set_volume', { volume: 0.42 });

    expect(bodies).toEqual([{ volume: 0.42 }]);
    expect(response.result?.content).toEqual([{ type: 'text', text: 'ok' }]);

    await client.close();
  });

  it('turns a CiderMcpError into a readable tool error, not a protocol fault', async () => {
    const server = buildServer(
      stubDeps(() => {
        throw new CiderMcpError(
          'CIDER_NOT_RUNNING',
          'Could not reach Cider on port 10767. Make sure Cider is running and its external API is enabled.',
        );
      }),
    );
    const client = await connectClient(server);

    const response = await client.call('now_playing', {});

    // A protocol-level error would arrive as `error`, which the model cannot act on.
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain('Make sure Cider is running');
    expect(response.result?.content?.[0]?.text).toContain('CIDER_NOT_RUNNING');

    await client.close();
  });

  it('reports an unexpected throw as a tool error without a stack trace', async () => {
    const server = buildServer(
      stubDeps(() => {
        return Promise.reject(new Error('kaboom'));
      }),
    );
    const client = await connectClient(server);

    const response = await client.call('playback_state', {});

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    // Our own wording, not the SDK's fallback: proves the catch arm ran here
    // rather than the failure escaping into the SDK's generic handler.
    expect(response.result?.content?.[0]?.text).toBe('Unexpected failure: kaboom');
    expect(response.result?.content?.[0]?.text).not.toMatch(/at .*:\d+:\d+/);

    await client.close();
  });
});

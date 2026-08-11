#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { acquireAppToken } from './token.js';
import { CiderClient } from './cider-client.js';
import { AppleMusicClient } from './apple-client.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const token = await acquireAppToken();
  const cider = new CiderClient(token);
  const apple = new AppleMusicClient(cider);

  // serveStdio, not `new StdioServerTransport()` + connect. On stdio the protocol
  // era is decided by the serving entry: serveStdio classifies the opening
  // exchange and pins a 2026-07-28-era instance. Hand-wiring the transport skips
  // that classification, and McpServer has no era option to compensate. The same
  // factory serves both eras.
  serveStdio(() => buildServer({ cider, apple }));

  // stdout is the JSON-RPC channel; all diagnostics go to stderr.
  process.stderr.write('[cider-mcp] ready\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`[cider-mcp] fatal: ${(err as Error)?.message ?? String(err)}\n`);
  process.exit(1);
});

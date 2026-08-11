import { McpServer } from '@modelcontextprotocol/server';
import { CiderMcpError } from './errors.js';
import { allTools } from './tools/index.js';
import type { Deps } from './tools/types.js';

type TextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function toContent(value: unknown): TextResult {
  if (value === undefined || value === null) {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function toErrorContent(err: unknown): TextResult {
  const text =
    err instanceof CiderMcpError
      ? `${err.message} (${err.code})`
      : `Unexpected failure: ${(err as Error)?.message ?? String(err)}`;
  return { content: [{ type: 'text', text }], isError: true };
}

export function buildServer(deps: Deps): McpServer {
  const server = new McpServer(
    { name: 'cider-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Registration order defines tools/list order; allTools is frozen for that reason.
  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: unknown) => {
        try {
          return toContent(await tool.handler(args as never, deps));
        } catch (err) {
          // Tool-level failures are results, not protocol errors, so the model
          // can read the message and adjust.
          return toErrorContent(err);
        }
      },
    );
  }

  return server;
}

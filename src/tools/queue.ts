import { z } from 'zod';
import { assertSafeId } from '../cider-client.js';
import { CiderMcpError } from '../errors.js';
import { defineTool, type ToolDef } from './types.js';

// Cider v2 caps limit at 200 and defaults to 50; offset and all queue indices are 0-based.
const pagination = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});

const itemRef = z.object({
  type: z.string().min(1).describe('Apple Music type, e.g. "songs".'),
  id: z.string().min(1).describe('Apple Music catalog id.'),
});

// Annotations are not optional in practice: MCP treats an ABSENT destructiveHint
// as true, so an unannotated "add to queue" reads as more dangerous than
// queue_clear. Every mutating tool states its hints explicitly.
const QUEUE_MUTATES = { readOnlyHint: false, destructiveHint: false } as const;

export const queueTools: ToolDef[] = [
  defineTool({
    name: 'queue_list',
    title: 'List the queue',
    description: 'List upcoming tracks in the play queue. Indices are 0-based.',
    inputSchema: pagination,
    annotations: { readOnlyHint: true },
    handler: ({ offset, limit }, { cider }) => cider.get('/api/v2/queue', { offset, limit }),
  }),
  defineTool({
    name: 'queue_position',
    title: 'Get queue position',
    description: 'Get the 0-based index of the currently playing item in the queue.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    handler: (_args, { cider }) => cider.request('/api/v2/queue/position'),
  }),
  defineTool({
    name: 'queue_add_next',
    title: 'Play next',
    description: 'Insert an item immediately after the current track.',
    inputSchema: itemRef,
    annotations: QUEUE_MUTATES,
    handler: async ({ type, id }, { cider }) => {
      assertSafeId(type, 'type');
      assertSafeId(id, 'id');
      return cider.request('/api/v2/queue/add-next', { method: 'POST', body: { type, id } });
    },
  }),
  defineTool({
    name: 'queue_add_later',
    title: 'Add to end of queue',
    description: 'Append an item to the end of the queue.',
    inputSchema: itemRef,
    annotations: QUEUE_MUTATES,
    handler: async ({ type, id }, { cider }) => {
      assertSafeId(type, 'type');
      assertSafeId(id, 'id');
      return cider.request('/api/v2/queue/add-later', { method: 'POST', body: { type, id } });
    },
  }),
  defineTool({
    name: 'queue_jump',
    title: 'Jump to queue position',
    description: 'Start playing the queue item at the given 0-based index.',
    inputSchema: z.object({ index: z.number().int().min(0) }),
    annotations: QUEUE_MUTATES,
    handler: ({ index }, { cider }) =>
      cider.request('/api/v2/queue/jump', { method: 'POST', body: { index } }),
  }),
  defineTool({
    name: 'queue_move',
    title: 'Reorder the queue',
    description: 'Move a queue item from one 0-based index to another.',
    inputSchema: z.object({
      from: z.number().int().min(0),
      to: z.number().int().min(0),
    }),
    annotations: QUEUE_MUTATES,
    handler: ({ from, to }, { cider }) =>
      cider.request('/api/v2/queue/move', { method: 'POST', body: { from, to } }),
  }),
  defineTool({
    name: 'queue_remove',
    title: 'Remove from queue',
    description: 'Remove the queue item at the given 0-based index.',
    inputSchema: z.object({ index: z.number().int().min(0) }),
    annotations: QUEUE_MUTATES,
    handler: ({ index }, { cider }) =>
      cider.request(`/api/v2/queue/items/${index}`, { method: 'DELETE' }),
  }),
  defineTool({
    name: 'queue_clear',
    title: 'Clear the queue',
    description:
      'Remove every item from the queue. This cannot be undone, so it requires confirm: true.',
    inputSchema: z.object({
      confirm: z.boolean().describe('Must be true. Guards against accidental queue loss.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: async ({ confirm }, { cider }) => {
      if (!confirm) {
        throw new CiderMcpError(
          'INVALID_ARGUMENT',
          'queue_clear wipes the entire queue and cannot be undone. Call it again with confirm: true if that is intended.',
        );
      }
      return cider.request('/api/v2/queue', { method: 'DELETE' });
    },
  }),
];

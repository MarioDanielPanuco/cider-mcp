import { z } from 'zod';
import { assertSafeId } from '../cider-client.js';
import { defineTool, type ToolDef } from './types.js';

const empty = z.object({});
const READ_ONLY = { readOnlyHint: true } as const;
const MUTATES = { readOnlyHint: false, destructiveHint: false } as const;
// Replaces what is playing and clobbers the existing queue — destructive in the
// sense MCP means, unlike play/pause/seek which only move within the queue.
const REPLACES_QUEUE = { ...MUTATES, destructiveHint: true } as const;

export const playbackTools: ToolDef[] = [
  defineTool({
    name: 'now_playing',
    title: 'Now playing',
    description:
      'Get the currently playing track: title, artist, album, and artwork. Playback position is not included here — use playback_state for that.',
    inputSchema: empty,
    annotations: READ_ONLY,
    handler: (_args, { cider }) => cider.request('/api/v2/playback/now-playing'),
  }),
  defineTool({
    name: 'playback_state',
    title: 'Playback state',
    description: 'Get a snapshot of playback: playing/paused, repeat and shuffle modes, autoplay, and volume.',
    inputSchema: empty,
    annotations: READ_ONLY,
    handler: (_args, { cider }) => cider.request('/api/v2/playback'),
  }),
  defineTool({
    name: 'play',
    title: 'Play',
    description: 'Resume playback of the current track without changing the queue.',
    inputSchema: empty,
    annotations: { ...MUTATES, idempotentHint: true },
    handler: (_args, { cider }) => cider.request('/api/v2/playback/play', { method: 'POST' }),
  }),
  defineTool({
    name: 'pause',
    title: 'Pause',
    description: 'Pause playback, keeping the current position in the track.',
    inputSchema: empty,
    annotations: { ...MUTATES, idempotentHint: true },
    handler: (_args, { cider }) => cider.request('/api/v2/playback/pause', { method: 'POST' }),
  }),
  defineTool({
    name: 'toggle_playback',
    title: 'Toggle play/pause',
    description: 'Toggle between playing and paused.',
    inputSchema: empty,
    annotations: MUTATES,
    handler: (_args, { cider }) => cider.request('/api/v2/playback/toggle', { method: 'POST' }),
  }),
  defineTool({
    name: 'next_track',
    title: 'Next track',
    description: 'Skip to the next track in the queue.',
    inputSchema: empty,
    annotations: MUTATES,
    handler: (_args, { cider }) => cider.request('/api/v2/playback/next', { method: 'POST' }),
  }),
  defineTool({
    name: 'previous_track',
    title: 'Previous track',
    description:
      'Go back to the previous track. Set force to true to always skip back rather than restarting the current track.',
    inputSchema: z.object({ force: z.boolean().optional() }),
    annotations: MUTATES,
    // Unlike every other bodyless playback POST, this route unconditionally runs
    // z.object({force: boolean().optional()}).parse(request.body). A body-less
    // POST leaves request.body undefined, the parse throws, and Cider returns
    // 400 INVALID_REQUEST. Always send an object.
    handler: ({ force }, { cider }) =>
      cider.request('/api/v2/playback/previous', {
        method: 'POST',
        body: force === undefined ? {} : { force },
      }),
  }),
  defineTool({
    name: 'seek',
    title: 'Seek',
    description: 'Seek to a position in the current track, in seconds from the start.',
    inputSchema: z.object({ position: z.number().min(0).describe('Seconds from the start of the track.') }),
    annotations: MUTATES,
    handler: ({ position }, { cider }) =>
      cider.request('/api/v2/playback/seek', { method: 'POST', body: { position } }),
  }),
  defineTool({
    name: 'set_repeat',
    title: 'Set repeat mode',
    description: 'Set the repeat mode to none, one (repeat current track), or all (repeat queue).',
    inputSchema: z.object({ mode: z.enum(['none', 'one', 'all']) }),
    annotations: { ...MUTATES, idempotentHint: true },
    handler: ({ mode }, { cider }) =>
      cider.request('/api/v2/playback/repeat', { method: 'PUT', body: { mode } }),
  }),
  defineTool({
    name: 'set_shuffle',
    title: 'Set shuffle',
    description: 'Turn shuffle on or off.',
    inputSchema: z.object({ enabled: z.boolean() }),
    annotations: { ...MUTATES, idempotentHint: true },
    handler: ({ enabled }, { cider }) =>
      cider.request('/api/v2/playback/shuffle', { method: 'PUT', body: { enabled } }),
  }),
  defineTool({
    name: 'set_rating',
    title: 'Love or dislike current track',
    description: 'Rate the current track: 1 to love it, -1 to dislike it, 0 to clear the rating.',
    inputSchema: z.object({ rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
    annotations: { ...MUTATES, idempotentHint: true },
    handler: ({ rating }, { cider }) =>
      cider.request('/api/v2/library/now-playing/rating', { method: 'PUT', body: { rating } }),
  }),
  defineTool({
    name: 'play_item',
    title: 'Play an item',
    description: 'Play a single item immediately by catalog type and id, replacing what is playing.',
    inputSchema: z.object({
      type: z.string().min(1).describe('Apple Music type, e.g. "songs".'),
      id: z.string().min(1).describe('Apple Music catalog id.'),
    }),
    annotations: REPLACES_QUEUE,
    handler: async ({ type, id }, { cider }) => {
      assertSafeId(type, 'type');
      assertSafeId(id, 'id');
      return cider.request('/api/v2/playback/play-item', { method: 'POST', body: { type, id } });
    },
  }),
  defineTool({
    name: 'play_collection',
    title: 'Play an album or playlist',
    description: 'Play a whole collection — album, playlist, or station — optionally shuffled.',
    inputSchema: z.object({
      type: z.string().min(1).describe('e.g. "albums", "playlists", "library-playlists".'),
      id: z.string().min(1),
      shuffle: z.boolean().optional(),
    }),
    annotations: REPLACES_QUEUE,
    handler: async ({ type, id, shuffle }, { cider }) => {
      assertSafeId(type, 'type');
      assertSafeId(id, 'id');
      return cider.request('/api/v2/playback/play-collection', { method: 'POST', body: { type, id, shuffle } });
    },
  }),
  defineTool({
    name: 'get_volume',
    title: 'Get volume',
    description: 'Get the current output volume, from 0 to 1.',
    inputSchema: empty,
    annotations: READ_ONLY,
    handler: (_args, { cider }) => cider.request('/api/v2/audio/volume'),
  }),
  defineTool({
    name: 'set_volume',
    title: 'Set volume',
    description: 'Set the output volume, from 0 (mute) to 1 (full).',
    inputSchema: z.object({ volume: z.number().min(0).max(1) }),
    annotations: { ...MUTATES, idempotentHint: true },
    handler: ({ volume }, { cider }) =>
      cider.request('/api/v2/audio/volume', { method: 'PATCH', body: { volume } }),
  }),
];

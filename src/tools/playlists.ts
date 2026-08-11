import { z } from 'zod';
import { defineTool, type ToolDef } from './types.js';

const trackIds = z
  .array(z.string().min(1))
  .describe('Apple Music catalog song ids, from catalog_search.');

/**
 * Only create and append exist. DELETE /v1/me/library/playlists/{id} returns 401
 * with Cider's WebPlay token under every auth variant tested, so no delete,
 * remove-track, or reorder tool is offered. Deletion happens in Cider's UI.
 */
export const playlistTools: ToolDef[] = [
  defineTool({
    name: 'playlist_create',
    title: 'Create a playlist',
    description:
      'Create a new Apple Music library playlist, optionally seeded with tracks. Playlists cannot be deleted through this server — removal must happen in Cider.',
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      track_ids: trackIds.default([]),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: ({ name, description, track_ids }, { apple }) =>
      apple.request('/v1/me/library/playlists', {
        method: 'POST',
        body: {
          attributes: { name, ...(description === undefined ? {} : { description }) },
          ...(track_ids.length === 0
            ? {}
            : { relationships: { tracks: { data: track_ids.map((id) => ({ id, type: 'songs' })) } } }),
        },
      }),
  }),
  defineTool({
    name: 'playlist_add_tracks',
    title: 'Add tracks to a playlist',
    description: 'Append tracks to an existing library playlist. Tracks cannot be removed through this server.',
    inputSchema: z.object({
      playlist_id: z.string().min(1).describe('Library playlist id, e.g. "p.xxxxxxxx".'),
      track_ids: trackIds.min(1),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: ({ playlist_id, track_ids }, { apple }) =>
      apple.request(`/v1/me/library/playlists/${encodeURIComponent(playlist_id)}/tracks`, {
        method: 'POST',
        body: { data: track_ids.map((id) => ({ id, type: 'songs' })) },
      }),
  }),
];

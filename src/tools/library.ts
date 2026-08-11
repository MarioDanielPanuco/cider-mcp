import { z } from 'zod';
import { assertSafeId } from '../cider-client.js';
import { defineTool, type ToolDef } from './types.js';

const pagination = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});
const withId = pagination.extend({ id: z.string().min(1) });
const READ_ONLY = { readOnlyHint: true } as const;

export const libraryTools: ToolDef[] = [
  defineTool({
    name: 'library_playlists',
    title: 'List library playlists',
    description: "List the user's Apple Music library playlists.",
    inputSchema: pagination,
    annotations: READ_ONLY,
    handler: ({ offset, limit }, { cider }) => cider.get('/api/v2/library/playlists', { offset, limit }),
  }),
  defineTool({
    name: 'library_playlist_tracks',
    title: 'List playlist tracks',
    description: 'List the tracks in a library playlist.',
    inputSchema: withId,
    annotations: READ_ONLY,
    handler: async ({ id, offset, limit }, { cider }) => {
      assertSafeId(id, 'id');
      return cider.get(`/api/v2/library/playlists/${encodeURIComponent(id)}/songs`, { offset, limit });
    },
  }),
  defineTool({
    name: 'library_albums',
    title: 'List library albums',
    description: "List albums in the user's library.",
    inputSchema: pagination,
    annotations: READ_ONLY,
    handler: ({ offset, limit }, { cider }) => cider.get('/api/v2/library/albums', { offset, limit }),
  }),
  defineTool({
    name: 'library_album_tracks',
    title: 'List album tracks',
    description: 'List the tracks on a library album.',
    inputSchema: withId,
    annotations: READ_ONLY,
    handler: async ({ id, offset, limit }, { cider }) => {
      assertSafeId(id, 'id');
      return cider.get(`/api/v2/library/albums/${encodeURIComponent(id)}/songs`, { offset, limit });
    },
  }),
  defineTool({
    name: 'library_artists',
    title: 'List library artists',
    description: "List artists in the user's library.",
    inputSchema: pagination,
    annotations: READ_ONLY,
    handler: ({ offset, limit }, { cider }) => cider.get('/api/v2/library/artists', { offset, limit }),
  }),
  defineTool({
    name: 'library_songs',
    title: 'List library songs',
    description: "List songs in the user's library.",
    inputSchema: pagination,
    annotations: READ_ONLY,
    handler: ({ offset, limit }, { cider }) => cider.get('/api/v2/library/songs', { offset, limit }),
  }),
  defineTool({
    name: 'library_add_current',
    title: 'Add current track to library',
    description: 'Add the currently playing track to the library.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, idempotentHint: true },
    handler: (_args, { cider }) => cider.request('/api/v2/library/now-playing/add', { method: 'POST' }),
  }),
];

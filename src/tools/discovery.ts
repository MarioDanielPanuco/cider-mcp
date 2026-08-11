import { z } from 'zod';
import { defineTool, type ToolDef } from './types.js';

export const discoveryTools: ToolDef[] = [
  defineTool({
    name: 'catalog_search',
    title: 'Search the Apple Music catalog',
    description:
      'Search the Apple Music catalog for songs, albums, artists, or playlists. Returns catalog ids suitable for play_item, queue_add_next, and playlist_create. Cider has no search endpoint, so this queries Apple directly.',
    inputSchema: z.object({
      term: z.string().min(1).describe('Free-text search, e.g. "elliott smith between the bars".'),
      types: z
        .string()
        .default('songs')
        .describe('Comma-separated result types: songs, albums, artists, playlists.'),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async ({ term, types, limit }, { apple }) => {
      const storefront = await apple.storefront();
      const params = new URLSearchParams({ term, types, limit: String(limit) });
      return apple.request(`/v1/catalog/${storefront}/search?${params.toString()}`);
    },
  }),
  defineTool({
    name: 'recently_played',
    title: 'Recently played tracks',
    description: 'List tracks the user played recently. Useful for building playlists from listening history.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
    annotations: { readOnlyHint: true },
    handler: ({ limit }, { apple }) => apple.request(`/v1/me/recent/played/tracks?limit=${limit}`),
  }),
];

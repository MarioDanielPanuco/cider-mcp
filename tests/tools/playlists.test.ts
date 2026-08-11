import { describe, expect, it, vi } from 'vitest';
import { playlistTools } from '../../src/tools/playlists.js';
import type { Deps } from '../../src/tools/types.js';

function deps() {
  const request = vi.fn().mockResolvedValue({ data: [{ id: 'p.new' }] });
  return { deps: { cider: {} as any, apple: { request, storefront: vi.fn() } as any } as Deps, request };
}
const tool = (name: string) => playlistTools.find((t) => t.name === name)!;

describe('playlist tools', () => {
  it('creates a playlist with seed tracks in one request', async () => {
    const { deps: d, request } = deps();
    await tool('playlist_create').handler(
      { name: 'Late night', description: 'quiet things', track_ids: ['123', '456'] },
      d,
    );
    expect(request).toHaveBeenCalledWith('/v1/me/library/playlists', {
      method: 'POST',
      body: {
        attributes: { name: 'Late night', description: 'quiet things' },
        relationships: { tracks: { data: [{ id: '123', type: 'songs' }, { id: '456', type: 'songs' }] } },
      },
    });
  });

  it('omits the tracks relationship when no seeds are given', async () => {
    const { deps: d, request } = deps();
    await tool('playlist_create').handler({ name: 'Empty', track_ids: [] }, d);
    expect((request.mock.calls[0]![1] as any).body.relationships).toBeUndefined();
  });

  it('appends tracks to an existing playlist', async () => {
    const { deps: d, request } = deps();
    await tool('playlist_add_tracks').handler({ playlist_id: 'p.abc', track_ids: ['789'] }, d);
    expect(request).toHaveBeenCalledWith('/v1/me/library/playlists/p.abc/tracks', {
      method: 'POST',
      body: { data: [{ id: '789', type: 'songs' }] },
    });
  });

  it('requires at least one track when appending', () => {
    expect(tool('playlist_add_tracks').inputSchema.safeParse({ playlist_id: 'p.a', track_ids: [] }).success).toBe(false);
  });

  it('exposes no tool that deletes or reorders, because Apple returns 401 for those', () => {
    const names = playlistTools.map((t) => t.name);
    expect(names).toEqual(['playlist_create', 'playlist_add_tracks']);
  });
});

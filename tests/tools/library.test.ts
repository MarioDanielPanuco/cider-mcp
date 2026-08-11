import { describe, expect, it, vi } from 'vitest';
import { libraryTools } from '../../src/tools/library.js';
import type { Deps } from '../../src/tools/types.js';

function deps() {
  const get = vi.fn().mockResolvedValue({});
  const request = vi.fn().mockResolvedValue({});
  return { deps: { cider: { get, request } as any, apple: {} as any } as Deps, get, request };
}
const tool = (name: string) => libraryTools.find((t) => t.name === name)!;

describe('library tools', () => {
  it('lists playlists through Cider rather than Apple', async () => {
    const { deps: d, get } = deps();
    await tool('library_playlists').handler({ offset: 0, limit: 50 }, d);
    expect(get).toHaveBeenCalledWith('/api/v2/library/playlists', { offset: 0, limit: 50 });
  });

  it('encodes playlist ids into the tracks path', async () => {
    const { deps: d, get } = deps();
    await tool('library_playlist_tracks').handler({ id: 'p.abc 123', offset: 0, limit: 50 }, d);
    expect(get).toHaveBeenCalledWith('/api/v2/library/playlists/p.abc%20123/songs', { offset: 0, limit: 50 });
  });

  it('rejects ids containing quotes', async () => {
    const { deps: d } = deps();
    await expect(
      tool('library_playlist_tracks').handler({ id: `p."x`, offset: 0, limit: 50 }, d),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('encodes album ids into the tracks path', async () => {
    const { deps: d, get } = deps();
    await tool('library_album_tracks').handler({ id: 'a.abc 123', offset: 0, limit: 50 }, d);
    expect(get).toHaveBeenCalledWith('/api/v2/library/albums/a.abc%20123/songs', { offset: 0, limit: 50 });
  });

  it('rejects album ids containing quotes', async () => {
    const { deps: d } = deps();
    await expect(
      tool('library_album_tracks').handler({ id: `a."x`, offset: 0, limit: 50 }, d),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('adds the current track to the library', async () => {
    const { deps: d, request } = deps();
    await tool('library_add_current').handler({}, d);
    expect(request).toHaveBeenCalledWith('/api/v2/library/now-playing/add', { method: 'POST' });
  });

  it('marks every listing tool read-only', () => {
    for (const name of ['library_playlists', 'library_albums', 'library_artists', 'library_songs']) {
      expect(tool(name).annotations?.readOnlyHint).toBe(true);
    }
  });
});

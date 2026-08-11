import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/tools/index.js';

describe('allTools', () => {
  it('has unique names', () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('pins the exact tools/list order', () => {
    // A re-import would be vacuous: ESM caches module records, so it returns the
    // same array and the assertion could never fail. Pin the order explicitly —
    // this is the wire contract clients cache against. Append, never reorder.
    expect(allTools.map((t) => t.name)).toEqual([
      'now_playing', 'playback_state', 'play', 'pause', 'toggle_playback',
      'next_track', 'previous_track', 'seek', 'set_repeat', 'set_shuffle',
      'set_rating', 'play_item', 'play_collection',
      'get_volume', 'set_volume',
      'queue_list', 'queue_position', 'queue_add_next', 'queue_add_later',
      'queue_jump', 'queue_move', 'queue_remove', 'queue_clear',
      'library_playlists', 'library_playlist_tracks', 'library_albums',
      'library_album_tracks', 'library_artists', 'library_songs', 'library_add_current',
      'catalog_search', 'recently_played',
      'playlist_create', 'playlist_add_tracks',
    ]);
  });

  it('gives every tool a description and a title', () => {
    for (const t of allTools) {
      expect(t.description.length, `${t.name} description`).toBeGreaterThan(20);
      expect(t.title.length, `${t.name} title`).toBeGreaterThan(0);
    }
  });

  it('exposes no playlist deletion tool', () => {
    expect(allTools.some((t) => /delete|remove_track|reorder/.test(t.name))).toBe(false);
  });
});

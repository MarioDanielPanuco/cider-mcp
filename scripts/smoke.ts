/**
 * Live end-to-end check against a running Cider. Not part of `pnpm test`.
 * Run with: CIDER_MCP_SMOKE=1 pnpm smoke
 *
 * This script CANNOT delete the playlist it creates: Apple returns 401 for
 * DELETE /v1/me/library/playlists/{id} with Cider's WebPlay token. It prints
 * the id so you can remove it in Cider.
 */
import { acquireAppToken } from '../src/token.js';
import { CiderClient } from '../src/cider-client.js';
import { AppleMusicClient } from '../src/apple-client.js';

if (process.env.CIDER_MCP_SMOKE !== '1') {
  console.error('Refusing to run. Set CIDER_MCP_SMOKE=1 — this writes to your real library.');
  process.exit(1);
}

const token = await acquireAppToken();
const cider = new CiderClient(token);
const apple = new AppleMusicClient(cider);

const info = await cider.request<{ version: string }>('/api/v2/client/info');
console.log('client/info      ok  version', info.version);

const nowPlaying = await cider.request<{ name?: string; artistName?: string }>('/api/v2/playback/now-playing');
console.log('now-playing      ok ', nowPlaying?.name ?? '(nothing playing)', '—', nowPlaying?.artistName ?? '');

const queue = await cider.get<{ items: unknown[] }>('/api/v2/queue', { offset: 0, limit: 3 });
console.log('queue            ok ', queue.items.length, 'item(s)');

const storefront = await apple.storefront();
const search = await apple.request<{ results: { songs?: { data: Array<{ id: string; attributes: { name: string } }> } } }>(
  `/v1/catalog/${storefront}/search?term=norah+jones&types=songs&limit=1`,
);
const song = search.results.songs?.data[0];
if (!song) throw new Error('catalog search returned no songs');
console.log('catalog_search   ok ', song.attributes.name, `(${song.id})`);

const created = await apple.request<{ data: Array<{ id: string }> }>('/v1/me/library/playlists', {
  method: 'POST',
  body: {
    attributes: { name: 'cider-mcp smoke test', description: 'Delete me' },
    relationships: { tracks: { data: [{ id: song.id, type: 'songs' }] } },
  },
});
const playlistId = created.data[0]!.id;
console.log('playlist_create  ok ', playlistId);

const tracks = await apple.request<{ data: unknown[] }>(
  `/v1/me/library/playlists/${playlistId}/tracks`,
);
console.log('read back        ok ', tracks.data.length, 'track(s)');

console.log('');
console.log('All checks passed.');
console.log(`ACTION REQUIRED: delete the playlist "cider-mcp smoke test" (${playlistId}) in Cider.`);
console.log('This script cannot delete it — Apple returns 401 for playlist deletion with this token.');

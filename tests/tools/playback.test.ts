import { describe, expect, it, vi } from 'vitest';
import { playbackTools } from '../../src/tools/playback.js';
import type { Deps } from '../../src/tools/types.js';

function deps(request = vi.fn().mockResolvedValue({})): { deps: Deps; request: typeof request } {
  return { deps: { cider: { request, get: request } as any, apple: {} as any }, request };
}
const tool = (name: string) => playbackTools.find((t) => t.name === name)!;

describe('playback tools', () => {
  it('exposes now_playing as read-only', () => {
    expect(tool('now_playing').annotations?.readOnlyHint).toBe(true);
  });

  it('pause POSTs to the v2 pause endpoint', async () => {
    const { deps: d, request } = deps();
    await tool('pause').handler({}, d);
    expect(request).toHaveBeenCalledWith('/api/v2/playback/pause', { method: 'POST' });
  });

  it('previous_track sends a body, because Cider 400s on a bodyless POST there', async () => {
    const { deps: d, request } = deps();
    await tool('previous_track').handler({}, d);
    expect(request).toHaveBeenCalledWith('/api/v2/playback/previous', { method: 'POST', body: {} });
  });

  it('seek sends the position in the body', async () => {
    const { deps: d, request } = deps();
    await tool('seek').handler({ position: 42 }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/playback/seek', { method: 'POST', body: { position: 42 } });
  });

  it('set_volume PATCHes and rejects values outside 0..1', async () => {
    const { deps: d, request } = deps();
    await tool('set_volume').handler({ volume: 0.25 }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/audio/volume', { method: 'PATCH', body: { volume: 0.25 } });
    expect(tool('set_volume').inputSchema.safeParse({ volume: 1.5 }).success).toBe(false);
  });

  it('set_repeat accepts only none|one|all', () => {
    expect(tool('set_repeat').inputSchema.safeParse({ mode: 'all' }).success).toBe(true);
    expect(tool('set_repeat').inputSchema.safeParse({ mode: 'sometimes' }).success).toBe(false);
  });

  it('marks the queue-replacing play tools destructive, but not ordinary transport controls', () => {
    // These throw away the current queue; play/pause/seek only move within it.
    for (const name of ['play_item', 'play_collection']) {
      expect(tool(name).annotations?.destructiveHint, name).toBe(true);
      expect(tool(name).annotations?.readOnlyHint, name).toBe(false);
    }
    for (const name of ['play', 'pause', 'seek', 'next_track', 'set_volume']) {
      expect(tool(name).annotations?.destructiveHint, name).toBe(false);
    }
  });

  it('play_item rejects ids containing quotes', async () => {
    const { deps: d } = deps();
    await expect(tool('play_item').handler({ type: 'songs', id: `1"2` }, d)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

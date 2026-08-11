import { describe, expect, it, vi } from 'vitest';
import { queueTools } from '../../src/tools/queue.js';
import type { Deps } from '../../src/tools/types.js';

function deps(request = vi.fn().mockResolvedValue({})) {
  const get = vi.fn().mockResolvedValue({});
  return { deps: { cider: { request, get } as any, apple: {} as any } as Deps, request, get };
}
const tool = (name: string) => queueTools.find((t) => t.name === name)!;

describe('queue tools', () => {
  it('lists the queue with 0-based offset and a default limit', async () => {
    const { deps: d, get } = deps();
    const t = tool('queue_list');
    // zod defaults are applied by the SDK at dispatch, never inside the handler.
    // Parse here so the handler sees exactly what production hands it; calling
    // handler({}) directly would pass offset/limit as undefined.
    await t.handler(t.inputSchema.parse({}), d);
    expect(get).toHaveBeenCalledWith('/api/v2/queue', { offset: 0, limit: 50 });
  });

  it('caps limit at 200, matching Cider validation', () => {
    expect(tool('queue_list').inputSchema.safeParse({ limit: 200 }).success).toBe(true);
    expect(tool('queue_list').inputSchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('rejects a negative index, because v2 indices are 0-based', () => {
    expect(tool('queue_jump').inputSchema.safeParse({ index: 0 }).success).toBe(true);
    expect(tool('queue_jump').inputSchema.safeParse({ index: -1 }).success).toBe(false);
  });

  it('gets the current queue position', async () => {
    const { deps: d, request } = deps();
    await tool('queue_position').handler({}, d);
    expect(request).toHaveBeenCalledWith('/api/v2/queue/position');
  });

  it('adds an item to play next', async () => {
    const { deps: d, request } = deps();
    await tool('queue_add_next').handler({ type: 'songs', id: '123' }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/queue/add-next', {
      method: 'POST',
      body: { type: 'songs', id: '123' },
    });
  });

  it('queue_add_next rejects ids containing quotes', async () => {
    const { deps: d, request } = deps();
    await expect(
      tool('queue_add_next').handler({ type: 'songs', id: `a'b` }, d),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(request).not.toHaveBeenCalled();
  });

  it('queue_add_next rejects types containing quotes', async () => {
    const { deps: d, request } = deps();
    await expect(
      tool('queue_add_next').handler({ type: `songs"`, id: '123' }, d),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(request).not.toHaveBeenCalled();
  });

  it('adds an item to the end of the queue', async () => {
    const { deps: d, request } = deps();
    await tool('queue_add_later').handler({ type: 'songs', id: '456' }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/queue/add-later', {
      method: 'POST',
      body: { type: 'songs', id: '456' },
    });
  });

  it('queue_add_later rejects ids containing quotes', async () => {
    const { deps: d, request } = deps();
    await expect(
      tool('queue_add_later').handler({ type: 'songs', id: `a'b` }, d),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(request).not.toHaveBeenCalled();
  });

  it('queue_add_later rejects types containing quotes', async () => {
    const { deps: d, request } = deps();
    await expect(
      tool('queue_add_later').handler({ type: `songs"`, id: '123' }, d),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(request).not.toHaveBeenCalled();
  });

  it('removes an item by index via DELETE on the item path', async () => {
    const { deps: d, request } = deps();
    await tool('queue_remove').handler({ index: 3 }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/queue/items/3', { method: 'DELETE' });
  });

  it('moves an item with from/to', async () => {
    const { deps: d, request } = deps();
    await tool('queue_move').handler({ from: 2, to: 0 }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/queue/move', { method: 'POST', body: { from: 2, to: 0 } });
  });

  it('refuses to clear the queue without explicit confirmation', async () => {
    const { deps: d, request } = deps();
    await expect(tool('queue_clear').handler({ confirm: false }, d)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('clears the queue when confirmed', async () => {
    const { deps: d, request } = deps();
    await tool('queue_clear').handler({ confirm: true }, d);
    expect(request).toHaveBeenCalledWith('/api/v2/queue', { method: 'DELETE' });
  });

  it('marks queue_clear as destructive', () => {
    expect(tool('queue_clear').annotations?.destructiveHint).toBe(true);
  });
});

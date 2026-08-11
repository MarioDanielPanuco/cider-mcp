import { describe, expect, it, vi } from 'vitest';
import { discoveryTools } from '../../src/tools/discovery.js';
import type { Deps } from '../../src/tools/types.js';

function deps(storefrontValue = 'us') {
  const request = vi.fn().mockResolvedValue({ results: {} });
  const storefront = vi.fn().mockResolvedValue(storefrontValue);
  return { deps: { cider: {} as any, apple: { request, storefront } as any } as Deps, request, storefront };
}
const tool = (name: string) => discoveryTools.find((t) => t.name === name)!;

describe('discovery tools', () => {
  it('searches the storefront catalog with encoded terms', async () => {
    const { deps: d, request, storefront } = deps('jp');
    await tool('catalog_search').handler({ term: 'aphex twin', types: 'albums', limit: 5 }, d);
    expect(storefront).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith('/v1/catalog/jp/search?term=aphex+twin&types=albums&limit=5');
  });

  it('defaults to songs and a limit of 10', () => {
    const parsed = tool('catalog_search').inputSchema.parse({ term: 'x' });
    expect(parsed).toMatchObject({ types: 'songs', limit: 10 });
  });

  it('reads recently played', async () => {
    const { deps: d, request } = deps();
    await tool('recently_played').handler({ limit: 10 }, d);
    expect(request).toHaveBeenCalledWith('/v1/me/recent/played/tracks?limit=10');
  });
});

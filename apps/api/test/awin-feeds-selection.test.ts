import { describe, it, expect } from 'vitest';
import { selectableAwinFeeds } from '../src/lib/marketplaces';
import type { AwinFeedListEntry } from '@afilados/marketplaces';

function entry(over: Partial<AwinFeedListEntry>): AwinFeedListEntry {
  return {
    advertiserId: '1',
    advertiserName: 'Loja',
    region: 'BR',
    membershipStatus: 'active',
    feedId: 'f1',
    feedName: 'Feed',
    format: 'Awin',
    productCount: null,
    url: 'https://x',
    ...over,
  };
}

describe('selectableAwinFeeds', () => {
  it('filtra só feeds com membershipStatus active', () => {
    const feeds = [
      entry({ feedId: 'a', membershipStatus: 'active' }),
      entry({ feedId: 'b', membershipStatus: 'Not Joined' }),
    ];
    expect(selectableAwinFeeds(feeds).map((f) => f.feedId)).toEqual(['a']);
  });

  it('ordena BR primeiro, depois por nome do anunciante', () => {
    const feeds = [
      entry({ feedId: 'us1', region: 'US', advertiserName: 'Zebra Co' }),
      entry({ feedId: 'br2', region: 'BR', advertiserName: 'Zebra BR' }),
      entry({ feedId: 'br1', region: 'BR', advertiserName: 'Acme BR' }),
    ];
    expect(selectableAwinFeeds(feeds).map((f) => f.feedId)).toEqual(['br1', 'br2', 'us1']);
  });
});

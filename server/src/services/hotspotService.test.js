import { describe, expect, it } from 'vitest';
import { selectEntriesForAnalysis } from './hotspotService.js';

function entry(sourceType, index, keywordId = 1) {
  return {
    source: { name: sourceType },
    keyword: { id: keywordId, term: `keyword-${keywordId}` },
    item: {
      sourceType,
      title: `${sourceType}-${index}`,
      url: `https://example.com/${keywordId}/${sourceType}/${index}`,
      discoveredAt: new Date(Date.now() - index).toISOString()
    }
  };
}

describe('hotspot scan selection', () => {
  it('applies the yupi 15 twitter and 10 other quota every time it is called', () => {
    const entries = [
      ...Array.from({ length: 20 }, (_, index) => entry('twitter', index)),
      ...Array.from({ length: 20 }, (_, index) => entry('bilibili', index))
    ];

    const selected = selectEntriesForAnalysis(entries, 25, 'quick');

    expect(selected).toHaveLength(25);
    expect(selected.filter((item) => item.item.sourceType === 'twitter')).toHaveLength(15);
    expect(selected.filter((item) => item.item.sourceType !== 'twitter')).toHaveLength(10);
  });

  it('can be used independently for each keyword so every keyword gets its own quota', () => {
    const firstKeyword = Array.from({ length: 30 }, (_, index) => entry('bilibili', index, 1));
    const secondKeyword = Array.from({ length: 30 }, (_, index) => entry('bilibili', index, 2));

    expect(selectEntriesForAnalysis(firstKeyword, 25, 'quick')).toHaveLength(10);
    expect(selectEntriesForAnalysis(secondKeyword, 25, 'quick')).toHaveLength(10);
  });
});

import { describe, expect, it } from 'vitest';
import { buildInternationalQueryVariants, buildQueryVariants } from './sourceQuery.js';

describe('source query helpers', () => {
  it('keeps local query variants unchanged', () => {
    expect(buildQueryVariants({ keyword: 'AI编程', scope: 'AI 编程' })).toEqual(['AI编程 AI 编程', 'AI编程']);
  });

  it('expands AI programming keywords with international aliases', () => {
    const variants = buildInternationalQueryVariants({
      keyword: 'AI编程',
      scope: 'AI 编程'
    });

    expect(variants).toContain('AI programming');
    expect(variants).toContain('AI coding');
    expect(variants).toContain('AI-assisted coding');
    expect(variants).toContain('coding with AI');
    expect(variants).toContain('AI编程');
  });
});

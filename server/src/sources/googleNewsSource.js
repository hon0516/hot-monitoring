import * as cheerio from 'cheerio';
import { fetchText } from './sourceClient.js';
import { buildInternationalQueryVariants, dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';

export async function searchGoogleNews({ keyword, scope }) {
  const results = [];
  const queries = buildInternationalQueryVariants({ keyword, scope });

  for (const query of queries) {
    const prefersEnglish = /[a-z]{2,}/i.test(query) && !/[\u4e00-\u9fff]/u.test(query);
    const locale = prefersEnglish
      ? { hl: 'en-US', gl: 'US', ceid: 'US:en' }
      : { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' };
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
    const xml = await fetchText(url, {
      timeoutMs: 15000,
      headers: {
        Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const $ = cheerio.load(xml, { xmlMode: true });

    $('item').each((_, element) => {
      const title = $(element).find('title').first().text().trim();
      const link = $(element).find('link').first().text().trim();
      const snippet = $(element).find('description').first().text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const sourceAuthor = $(element).find('source').first().text().trim();
      const published = $(element).find('pubDate').first().text().trim();

      if (!title || !link) {
        return;
      }

      results.push({
        title,
        snippet,
        url: link,
        sourceType: 'google-news',
        sourceAuthor: sourceAuthor || 'Google News',
        sourcePublishedAt: published || null,
        engagementJson: null
      });
    });

    if (results.length >= 10) {
      break;
    }
  }

  return dedupeSourceItems(filterRecentSourceItems(results)).slice(0, 10);
}

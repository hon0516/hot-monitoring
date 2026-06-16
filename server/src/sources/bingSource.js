import * as cheerio from 'cheerio';
import { buildInternationalQueryVariants, dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function searchBing({ keyword, scope }) {
  const results = [];
  const queries = buildInternationalQueryVariants({ keyword, scope });

  for (const query of queries) {
    const setlang = /[a-z]{2,}/i.test(query) && !/[\u4e00-\u9fff]/u.test(query) ? 'en-US' : 'zh-Hans';
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=${setlang}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': pickUserAgent()
      }
    });

    if (!response.ok) {
      throw new Error(`Bing News 抓取失败: ${response.status}`);
    }

    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    $('item').each((_, element) => {
      const title = $(element).find('title').first().text().trim();
      const link = $(element).find('link').first().text().trim();
      const snippet = $(element).find('description').first().text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const sourceAuthor =
        $(element).find('News\\:Source').first().text().trim() ||
        $(element).find('source').first().text().trim() ||
        'Bing News';
      const published = $(element).find('pubDate').first().text().trim();

      if (!title || !link) {
        return;
      }

      results.push({
        title,
        snippet,
        url: link,
        sourceType: 'bing',
        sourceAuthor,
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

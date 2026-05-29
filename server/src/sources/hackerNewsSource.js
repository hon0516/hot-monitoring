import { buildQueryVariants, dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';

export async function searchHackerNews({ keyword, scope }) {
  const results = [];
  const queries = buildQueryVariants({ keyword, scope });

  for (const query of queries) {
    const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
    url.searchParams.set('query', query);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('hitsPerPage', '10');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Hacker News 查询失败: ${response.status}`);
    }

    const payload = await response.json();
    const hits = Array.isArray(payload?.hits) ? payload.hits : [];

    results.push(
      ...hits
        .filter((hit) => hit.title && (hit.url || hit.story_url))
        .map((hit) => ({
          title: hit.title,
          snippet: hit.story_text || hit.comment_text || `Hacker News score ${hit.points ?? 0}, comments ${hit.num_comments ?? 0}`,
          url: hit.url || hit.story_url,
          sourceType: 'hacker-news',
          sourceAuthor: hit.author || 'Hacker News',
          sourcePublishedAt: hit.created_at || null,
          engagementJson: JSON.stringify({
            points: hit.points ?? 0,
            comments: hit.num_comments ?? 0
          })
        }))
    );

    if (results.length >= 10) {
      break;
    }
  }

  return dedupeSourceItems(filterRecentSourceItems(results)).slice(0, 10);
}

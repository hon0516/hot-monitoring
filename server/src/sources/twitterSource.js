import { configState, env } from '../config/env.js';
import { buildInternationalQueryVariants, dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';

function formatSinceDate() {
  const date = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2);
  return date.toISOString().slice(0, 10);
}

export async function searchTwitter({ keyword, scope }) {
  if (!configState.hasTwitterApiKey || !configState.twitterSourceRuntimeEnabled) {
    return [];
  }

  const results = [];
  const queries = buildInternationalQueryVariants({ keyword, scope });

  for (const query of queries) {
    const url = new URL('https://api.twitterapi.io/twitter/tweet/advanced_search');
    url.searchParams.set('query', `${query} since:${formatSinceDate()}`);
    url.searchParams.set('queryType', 'Top');

    const response = await fetch(url, {
      headers: {
        'X-API-Key': env.twitterApiKey
      }
    });

    if (!response.ok) {
      throw new Error(`twitterapi.io 查询失败: ${response.status}`);
    }

    const payload = await response.json();
    const tweets = Array.isArray(payload?.tweets) ? payload.tweets : [];

    results.push(
      ...tweets.map((tweet) => ({
        title: String(tweet.text || '').slice(0, 120),
        snippet: tweet.text || '',
        url: tweet.url || `https://x.com/${tweet.author?.userName || 'i'}/status/${tweet.id}`,
        sourceType: 'twitter',
        sourceAuthor: tweet.author?.name || tweet.author?.userName || 'Unknown',
        sourcePublishedAt: tweet.createdAt || null,
        engagementJson: JSON.stringify({
          authorVerified:
            tweet.author?.isVerified ??
            tweet.author?.verified ??
            tweet.author?.blueVerified ??
            tweet.author?.isBlueVerified ??
            false,
          authorFollowers:
            tweet.author?.followers ??
            tweet.author?.followersCount ??
            tweet.author?.followers_count ??
            null,
          likes: tweet.likeCount ?? 0,
          retweets: tweet.retweetCount ?? 0,
          replies: tweet.replyCount ?? 0,
          quotes: tweet.quoteCount ?? 0,
          views: tweet.viewCount ?? 0
        })
      }))
    );

    if (results.length >= 10) {
      break;
    }
  }

  return dedupeSourceItems(filterRecentSourceItems(results)).slice(0, 10);
}

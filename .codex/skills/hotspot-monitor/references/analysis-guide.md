# Hotspot Analysis Guide

Use this guide after scripts return JSON candidates.

## Review Output

For each item, make these decisions before showing it:

```json
{
  "contentExists": true,
  "keywordMentioned": true,
  "directRelevance": true,
  "isReal": true,
  "relevance": 85,
  "relevanceReason": "The title and snippet directly describe a new OpenAI model release.",
  "importance": "high",
  "summary": "OpenAI 发布新模型并开放 API 调用"
}
```

Keep the final user-facing summary in Simplified Chinese, preferably under 80 Chinese characters. Include concrete entities, versions, dates, prices, benchmarks, or policy names when present.

## Status

- `trusted`: direct keyword relevance, good source quality, enough snippet/body evidence, no obvious noise flags.
- `needs_review`: plausible and relevant, but metadata or source evidence is incomplete.
- `low_relevance`: real content, but the monitored keyword is incidental or broad-field only.
- `noise`: malformed title, search page, duplicate, spam, or unsupported result.

## Review Rules

- Prefer official announcements and reputable original reporting.
- Treat search engines and aggregators as discovery channels, not original sources.
- Do not count copied or syndicated text as independent corroboration.
- Keep summaries tied to the monitored keyword: `此内容与【关键词】的关联：...`
- If evidence is thin, keep the item in `needs_review`.

## Authenticity

Mark an item as credible when it has at least one of these:

- Official source, verified account, product blog, release note, paper, repository, or regulatory/filing source.
- Reputable original reporting with named details.
- Multiple independent sources describing the same event.
- Social post from a primary actor or a clearly identified participant.

Mark as low trust or noise when it has these patterns:

- Sensational title without concrete details.
- Rumor phrasing without attribution.
- SEO/content-farm repetition, keyword stuffing, or generic AI-written fluff.
- Search result pages, list pages, login pages, coupons, downloads, or unrelated account cards.
- Duplicate syndication that adds no new source evidence.

## Relevance Scoring

| Score | Meaning | Example for keyword `GPT-5` |
| --- | --- | --- |
| 90-100 | Direct primary topic | Official GPT-5 release announcement |
| 70-89 | Strongly related | Benchmarks, API access, pricing, or rollout details for GPT-5 |
| 50-69 | Moderate | AI model landscape article with a meaningful GPT-5 section |
| 30-49 | Tangential | OpenAI business story with only passing GPT-5 mention |
| 0-29 | Not relevant | Generic technology article |

Useful signals:

- Exact or close variant appears in title.
- Candidate is primarily about the keyword rather than the wider field.
- Source is authoritative for the topic.
- Published recently for the requested time window.
- Engagement is high enough to indicate attention, but not enough to prove truth.

Filter thresholds:

- Discard from default output if `isReal` is false.
- Discard from default output if relevance is below 40.
- If the keyword is not literally mentioned and relevance is below 60, classify as `low_relevance`.
- Keep relevant but under-evidenced candidates as `needs_review`, not `trusted`.

## Importance

Use the numeric `importance` score in local scripts and map it conceptually:

- 85-100 `urgent`: breaking releases, serious incidents, major policy/regulatory impact, critical security issues.
- 70-84 `high`: major feature launches, funding/acquisition/partnership news, strong research breakthroughs, fast-growing discussions.
- 45-69 `medium`: regular releases, conference talks, notable analysis, practical ecosystem updates.
- 0-44 `low`: tutorials, routine posts, small community discussion, old news resurfacing.

## Engagement Heat

When engagement data exists, use it to break ties and explain heat. Do not let it override trust.

Normalize common fields:

- Views: `views`, `viewCount`, `play`, `reads`
- Likes: `likes`, `likeCount`, `points`
- Reposts: `retweets`, `retweetCount`, `shares`, `reposts`
- Replies: `comments`, `commentCount`, `replyCount`, `quotes`, `quoteCount`

Simple heat score:

```text
raw = likes * 10 + reposts * 5 + replies * 3 + log10(max(views, 1)) * 8
heatScore = min(100, raw)
```

Use heat as supporting context: "high-engagement but unverified" should usually be `needs_review`.

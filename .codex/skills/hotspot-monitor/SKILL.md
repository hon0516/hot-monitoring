---
name: hotspot-monitor
description: >
  Use when the user wants an AI agent to monitor hotspots from keywords, discover trending or latest developments,
  track a topic over time, collect multi-source candidate items, filter noise, verify relevance and trust, and output
  a structured list or report of credible hotspot events. Trigger on requests such as "最近有什么热点",
  "帮我关注 XX 动态", "查一下 XX 最新消息", "生成热点报告", "monitor XX", or "what's trending in XX".
---

# Hotspot Monitor

Use this skill to run or design a keyword-based hotspot monitoring workflow. The goal is to return credible, directly relevant hotspot events instead of raw search results.

The skill is intentionally lightweight: the default web pipeline uses Python standard library only. Optional China-platform and Twitter/X scripts are available when broader coverage is useful.

## Quick Start

From this skill directory, run the default quality-first scan:

```bash
python3 scripts/search_web.py "OpenAI" --days 1 --limit 8 \
  | python3 scripts/filter_results.py --keyword "OpenAI" \
  | python3 scripts/generate_report.py --keyword "OpenAI"
```

For China-heavy topics, merge the optional Chinese-source scan:

```bash
python3 scripts/search_china.py "AI编程" --limit 8 \
  | python3 scripts/filter_results.py --keyword "AI编程" \
  | python3 scripts/generate_report.py --keyword "AI编程"
```

For Twitter/X, set `TWITTER_API_KEY` first:

```bash
TWITTER_API_KEY=... python3 scripts/search_twitter.py "GPT-5" --limit 10 \
  | python3 scripts/filter_results.py --keyword "GPT-5" \
  | python3 scripts/generate_report.py --keyword "GPT-5"
```

## Inputs

Collect these from the user or infer them from context:

- `keywords`: monitored topic words, such as `AI编程`.
- `sources`: search engines, news, Hacker News, social platforms, or project-local source adapters.
- `time_window`: recency window for candidates.
- `strictness`: default to quality-first when unspecified.
- `output`: hotspot list, notification batch, Markdown report, or API payload.

## Intent Modes

- `broad_discovery`: user asks what is hot in a field. Search broad bilingual variants, prefer multiple sources, and return grouped themes.
- `specific_tracking`: user names a product, person, company, event, version, or keyword. Use tighter variants and require direct relevance.
- `latest_update`: user asks for latest news. Keep the time window short and sort by freshness after trust.
- `report_generation`: user asks for a report. Run the full pipeline and present a Markdown report with stats, evidence, and caveats.
- `debug_filtering`: user asks why a result was included or excluded. Run with `--include-noise` and explain scores and risk flags.

## Workflow

1. Understand the user intent.
   - If the request is broad, expand around the domain and likely entity aliases.
   - If the request is specific, keep query variants tight to avoid generic industry noise.
   - If the user did not specify recency, default to `--days 1` for "latest" and `--days 7` for trend/background scans.

2. Expand keywords into a small query set.
   - Generate 5-12 variants covering Chinese, English, spaces, hyphens, capitalization, and core product/entity names.
   - Avoid broad variants that make the query ambiguous.
   - Script: `python3 scripts/expand_keyword.py "AI编程"`.

3. Collect candidates into a raw candidate pool.
   - Keep source metadata: title, snippet, URL, discovered time, published time, author, source name, engagement, and channel.
   - Resolve aggregator links when possible so Google/Bing are not treated as the original publisher.
   - Default script: `python3 scripts/search_web.py "OpenAI" --sources google-news,bing-news,hackernews,duckduckgo`.
   - China script: `python3 scripts/search_china.py "AI编程" --sources sogou,bilibili,weibo-hot`.
   - Twitter/X script: `python3 scripts/search_twitter.py "OpenAI"`.

4. Pre-filter obvious noise before AI review.
   - Downrank or remove pure search pages, result lists, collection pages, title-only keyword pages, titles that look like durations or numbers, missing snippets from low-quality sources, generic tutorials, marketing pages, and unrelated forum chatter.
   - Script: pipe search JSON into `python3 scripts/filter_results.py --keyword "OpenAI"`.

5. Normalize and deduplicate.
   - Normalize URL, canonical URL, title, source domain, and timestamps.
   - Merge exact URL duplicates and near-duplicate titles.
   - Group items that describe the same event by entity, product, action, time, and semantic overlap.

6. Review relevance and trust.
   - Prefer rule scores for clear cases.
   - Use AI for boundary cases, high-impact items, or candidates with mixed evidence.
   - Separate three decisions: whether the content exists, whether it directly relates to the keyword, and whether it is worth showing as a hotspot.
   - Do not treat social engagement alone as proof. It can raise heat/importance, but source evidence still determines trust.

7. Score and classify.
   - `trusted`: strong keyword relevance, enough source evidence, no major contradiction.
   - `needs_review`: single ordinary source, weak evidence, missing body or publish time, or borderline relevance.
   - `low_relevance`: real content but only loosely related.
   - `noise`: search noise, spam, duplicate, malformed, or unsupported content.

8. Return only useful output.
   - Default view should include `trusted` and, if requested, `needs_review`.
   - Sort by `auditStatus`, `trustScore`, `relevanceScore`, `sourceQualityScore`, freshness, then engagement.
   - Script: pipe filtered JSON into `python3 scripts/generate_report.py --keyword "OpenAI"`.

## Script Reference

| Script | Purpose | Output |
| --- | --- | --- |
| `scripts/expand_keyword.py` | Generate compact query variants | JSON array |
| `scripts/search_web.py` | Search Google News RSS, Bing News RSS, Hacker News, DuckDuckGo | JSON object with `results` and `errors` |
| `scripts/search_china.py` | Search Sogou, Bilibili, and Weibo hot search | JSON object with `results` and `errors` |
| `scripts/search_twitter.py` | Search Twitter/X through twitterapi.io | JSON object with `results` and `errors` |
| `scripts/filter_results.py` | Deduplicate, score, and classify candidates | JSON object with `events` and `stats` |
| `scripts/generate_report.py` | Render filtered events as Markdown | Markdown |

Common options:

- `--sources`: comma-separated source list.
- `--days`: recent time window in days.
- `--limit`: max results per source for `search_web.py`.
- `--detect-account`: for `search_china.py`, detect a Bilibili account and fetch latest videos.
- `--max-items`: max report items for `generate_report.py`.
- `--include-noise`: keep noise rows for debugging filter behavior.

For source behavior, read `references/search-sources.md`. For review rules, read `references/analysis-guide.md`.

## Analysis Checklist

For every candidate that may be shown, decide:

1. `contentExists`: Is there a reachable title, URL, and enough metadata/snippet to inspect?
2. `keywordMentioned`: Does the exact keyword or a close variant appear in the title, snippet, source entity, or URL?
3. `directRelevance`: Is the candidate primarily about the monitored topic rather than a generic field update?
4. `authenticity`: Is it official, reputable reporting, credible social evidence, or just rumor/SEO noise?
5. `importance`: Is it a release, incident, policy shift, major partnership, high-engagement discussion, or routine content?
6. `showDecision`: Should the user see it now, see it as `needs_review`, or not see it by default?

Use AI judgment to write concise Chinese summaries, but never let AI prior knowledge become evidence. Evidence must come from collected or fetched pages.

## Report Style

Default reports should be concise and evidence-first:

```markdown
## 热点监控报告 - {keyword}
> 生成时间: {timestamp} | 数据源: {sources_used} | 返回条数: {count}

### 可信热点
- **{title}**
  摘要: 此内容与【{keyword}】的关联：...
  来源: {source} | 可信度: {trustScore} | 相关性: {relevanceScore} | 重要度: {importance}
  风险标记: {flags} | [原文链接]({url})

### 待核验
...
```

When sources fail, keep the successful results and mention failed source names in the report header instead of aborting the whole scan.

## Output Shape

Use this shape for structured results:

```json
{
  "keyword": "AI编程",
  "scanWindow": "24h",
  "stats": {
    "collected": 0,
    "filtered": 0,
    "trusted": 0,
    "needsReview": 0,
    "aiReviewed": 0
  },
  "events": [
    {
      "title": "",
      "url": "",
      "status": "trusted",
      "trustScore": 0,
      "relevanceScore": 0,
      "importance": 0,
      "summary": "此内容与【AI编程】的关联：...",
      "sources": [],
      "evidence": [],
      "riskFlags": []
    }
  ]
}
```

## Quality Rules

- Do not count aggregator pages as independent original sources.
- Do not treat repeated syndicated copies as independent corroboration.
- Do not show a generic tutorial, listicle, or marketing page as a hotspot unless the monitored keyword explicitly asks for that content type.
- Do not show Bilibili duration overlays, search suggestions, or account cards as events unless they resolve to a real video/account update.
- Do not show Weibo hot-search matches that only share a single generic word with the keyword.
- Do not use Twitter/X virality as a replacement for authenticity; show high-engagement rumors as `needs_review`.
- Do not let AI knowledge become evidence; evidence must come from collected or fetched pages.
- If verification fails, classify conservatively as `needs_review` rather than `trusted`.

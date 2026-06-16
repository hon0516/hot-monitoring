---
name: hotspot-monitor
description: Use when the user wants an AI agent to monitor hotspots from keywords, collect multi-source candidate items, filter noise, verify relevance and trust, and output a structured list or report of credible hotspot events.
---

# Hotspot Monitor

Use this skill to run or design a keyword-based hotspot monitoring workflow. The goal is to return credible, directly relevant hotspot events instead of raw search results.

## Quick Start

The MVP scripts use Python standard library only. From this skill directory, run:

```bash
python3 scripts/search_web.py "OpenAI" --days 1 --limit 8 \
  | python3 scripts/filter_results.py --keyword "OpenAI" \
  | python3 scripts/generate_report.py --keyword "OpenAI"
```

Use `search_web.py` for collection, `filter_results.py` for local noise filtering and scoring, and `generate_report.py` for a Markdown report.

## Inputs

Collect these from the user or infer them from context:

- `keywords`: monitored topic words, such as `AI编程`.
- `sources`: search engines, news, Hacker News, social platforms, or project-local source adapters.
- `time_window`: recency window for candidates.
- `strictness`: default to quality-first when unspecified.
- `output`: hotspot list, notification batch, Markdown report, or API payload.

## Workflow

1. Expand keywords into a small query set.
   - Generate 5-12 variants covering Chinese, English, spaces, hyphens, capitalization, and core product/entity names.
   - Avoid broad variants that make the query ambiguous.
   - Script: `python3 scripts/expand_keyword.py "AI编程"`.

2. Collect candidates into a raw candidate pool.
   - Keep source metadata: title, snippet, URL, discovered time, published time, author, source name, engagement, and channel.
   - Resolve aggregator links when possible so Google/Bing are not treated as the original publisher.
   - Script: `python3 scripts/search_web.py "OpenAI" --sources google-news,bing-news,hackernews,duckduckgo`.

3. Pre-filter obvious noise before AI review.
   - Downrank or remove pure search pages, result lists, collection pages, title-only keyword pages, titles that look like durations or numbers, missing snippets from low-quality sources, generic tutorials, marketing pages, and unrelated forum chatter.
   - Script: pipe search JSON into `python3 scripts/filter_results.py --keyword "OpenAI"`.

4. Normalize and deduplicate.
   - Normalize URL, canonical URL, title, source domain, and timestamps.
   - Merge exact URL duplicates and near-duplicate titles.
   - Group items that describe the same event by entity, product, action, time, and semantic overlap.

5. Review relevance and trust.
   - Prefer rule scores for clear cases.
   - Use AI for boundary cases, high-impact items, or candidates with mixed evidence.
   - Require AI to separate three decisions: whether the content exists, whether it directly relates to the keyword, and whether it is worth showing as a hotspot.

6. Score and classify.
   - `trusted`: strong keyword relevance, enough source evidence, no major contradiction.
   - `needs_review`: single ordinary source, weak evidence, missing body or publish time, or borderline relevance.
   - `low_relevance`: real content but only loosely related.
   - `noise`: search noise, spam, duplicate, malformed, or unsupported content.

7. Return only useful output.
   - Default view should include `trusted` and, if requested, `needs_review`.
   - Sort by `trustScore`, `relevanceScore`, `sourceQualityScore`, `freshness`, then `engagement`.
   - Script: pipe filtered JSON into `python3 scripts/generate_report.py --keyword "OpenAI"`.

## Script Reference

| Script | Purpose | Output |
| --- | --- | --- |
| `scripts/expand_keyword.py` | Generate compact query variants | JSON array |
| `scripts/search_web.py` | Search Google News RSS, Bing News RSS, Hacker News, DuckDuckGo | JSON object with `results` and `errors` |
| `scripts/filter_results.py` | Deduplicate, score, and classify candidates | JSON object with `events` and `stats` |
| `scripts/generate_report.py` | Render filtered events as Markdown | Markdown |

Common options:

- `--sources`: comma-separated source list.
- `--days`: recent time window in days.
- `--limit`: max results per source for `search_web.py`.
- `--max-items`: max report items for `generate_report.py`.
- `--include-noise`: keep noise rows for debugging filter behavior.

For source behavior, read `references/search-sources.md`. For review rules, read `references/analysis-guide.md`.

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
- Do not let AI knowledge become evidence; evidence must come from collected or fetched pages.
- If verification fails, classify conservatively as `needs_review` rather than `trusted`.

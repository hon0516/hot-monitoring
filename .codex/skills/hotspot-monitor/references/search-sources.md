# Search Sources

## Included In MVP

- `google-news`: Google News RSS search, good for recent media coverage.
- `bing-news`: Bing News RSS search, good secondary news coverage.
- `hackernews`: Hacker News Algolia API, useful for technical discussions.
- `duckduckgo`: DuckDuckGo HTML search, useful fallback when news feeds are sparse.

## Optional China Sources

- `sogou`: Sogou web search. Useful for Chinese-language coverage and local reposts. HTML can change, so treat parse failures as source errors rather than scan failures.
- `bilibili`: Bilibili public video search. Useful for creator/video trend monitoring and "latest video about X" queries. It can return duration overlays or account cards; filter those out unless `--detect-account` is intentionally used.
- `weibo-hot`: Weibo public hot-search endpoint. Useful for checking whether a topic is actively trending in China. It is not a general search engine, so a miss does not mean no Weibo discussion exists.

## Optional Twitter/X Source

- `twitter`: Twitter/X search through `twitterapi.io`. Requires `TWITTER_API_KEY`. Best for early social signals, primary-account announcements, and high-engagement discussions. Treat rumors conservatively.

## Notes

- All MVP scripts use Python standard library only.
- `search_web.py`, `search_china.py`, and `search_twitter.py` all output a JSON object with `results` and `errors`, so they can be piped into `filter_results.py`.
- Public web sources can rate-limit or change markup. If a source returns no data, keep other source results and report the source error.
- Search engines are discovery channels. The original publisher, official account, project page, paper, or social post should be treated as source evidence.
- Twitter/X, Weibo, and Bilibili are less stable than RSS/API-like sources. Use them for coverage and heat signals, then verify high-impact items through official or reputable sources when possible.

## Rate-Limit Guidance

| Source | Suggested spacing | Notes |
| --- | ---: | --- |
| `hackernews` | 1s | Official Algolia API |
| `google-news` | 2s | RSS, usually stable |
| `bing-news` | 2s | RSS, occasionally wraps original URLs |
| `duckduckgo` | 3s | HTML fallback |
| `sogou` | 3s | HTML, China search |
| `bilibili` | 2s | Public JSON API, may need cookies for heavy use |
| `weibo-hot` | 3s | Public hot-search API |
| `twitter` | API quota | Paid/credentialed API |

## Source Selection

- Broad AI/tech discovery: `google-news,bing-news,hackernews,duckduckgo` plus `sogou,bilibili,weibo-hot` when Chinese coverage matters.
- Specific product/company tracking: start with `google-news,bing-news,hackernews`, add Twitter/X for official accounts or social velocity.
- Chinese creator or video monitoring: use `search_china.py --sources bilibili --detect-account`.
- China public trend check: use `search_china.py --sources weibo-hot,sogou`.
- Debugging noisy output: run filter with `--include-noise` and inspect `riskFlags`.

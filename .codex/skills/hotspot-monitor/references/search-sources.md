# Search Sources

## Included In MVP

- `google-news`: Google News RSS search, good for recent media coverage.
- `bing-news`: Bing News RSS search, good secondary news coverage.
- `hackernews`: Hacker News Algolia API, useful for technical discussions.
- `duckduckgo`: DuckDuckGo HTML search, useful fallback when news feeds are sparse.

## Notes

- All MVP scripts use Python standard library only.
- Public web sources can rate-limit or change markup. If a source returns no data, keep other source results and report the source error.
- Twitter/X, Weibo, and Bilibili are intentionally excluded from the MVP because they are less stable without official credentials or browser sessions.


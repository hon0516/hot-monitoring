# Hotspot Analysis Guide

Use this guide after scripts return JSON candidates.

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


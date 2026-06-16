---
name: content-trust-auditor
description: Use when the user wants to audit whether an article, post, announcement, search result, or URL is trustworthy, directly related to any target topic or keyword, supported by evidence, and suitable for reporting or display.
---

# Content Trust Auditor

Use this skill to audit a single content item or a small batch of items. The output should be evidence-based, conservative, and explainable.

This skill is domain-agnostic. It can audit technology, finance, policy, health, education, product, company, security, entertainment, and other public content as long as the user provides a target topic or keyword.

## Quick Start

The MVP script uses Python standard library only. From this skill directory, run:

```bash
python3 scripts/audit_content.py \
  --keyword "新能源汽车" \
  --title "某车企发布新一代新能源汽车电池技术" \
  --summary "报道称该新能源汽车电池技术提升续航并缩短充电时间。" \
  --url "https://example.com/news/battery"
```

For JSON input:

```bash
cat item.json | python3 scripts/audit_content.py --keyword "财报增长" --input -
```

## Inputs

Accept any combination of:

- `keyword`: target keyword, topic, entity, product, policy, claim, or research area.
- `title`, `summary`, `body`, `url`, `source`, `author`, `publishedAt`.
- `candidateType`: news, official announcement, social post, research, policy, financial report, tutorial, marketing, search result, unknown.
- Optional external evidence pages or source items.

## Audit Workflow

1. Build an evidence package.
   - Normalize title, source domain, canonical URL, author, published time, snippet, body length, engagement, and source channel.
   - Mark defects: missing publish time, missing body, short content, aggregator URL, search page, title-only item, malformed title, or weak source.
   - Script: `scripts/audit_content.py` accepts either CLI fields or one JSON item.

2. Classify content type.
   - Distinguish news event, official announcement, product release, social discussion, opinion, tutorial, marketing, collection, and search noise.
   - Tutorials, marketing pages, and collections should be treated as lower-evidence unless the target topic explicitly asks for that content type.

3. Judge keyword relationship.
   - `direct`: keyword or close variant is central to the event.
   - `indirect`: same broad field but not about the keyword.
   - `none`: unrelated or accidental keyword match.

4. Extract checkable claims.
   - Extract up to 5 concrete claims with entities, actions, time, product names, numbers, or quoted announcements.
   - Skip vague claims that cannot be verified.

5. Verify against evidence.
   - Mark each claim as `supported`, `partially_supported`, `contradicted`, or `unverified`.
   - Prefer official sources, original reporting, reputable media, and independent corroboration.
   - Treat syndication, copied text, and same-domain reposts as weak corroboration.

6. Decide final status.
   - `trusted`: direct relevance, strong evidence, no major contradiction, and either independent sources or clear first-party evidence.
   - `needs_review`: plausible but single ordinary source, incomplete metadata, weak body, or insufficient corroboration.
   - `low_evidence`: real but not enough support for confident display.
   - `low_relevance`: true content but not directly about the keyword.
   - `noise`: search result, spam, malformed, duplicate, or unsupported item.

## Output Shape

Return concise structured output:

```json
{
  "auditStatus": "needs_review",
  "contentType": "news",
  "keywordRelation": "direct",
  "trustScore": 0,
  "relevanceScore": 0,
  "evidenceScore": 0,
  "corroborationScore": 0,
  "importance": 0,
  "riskFlags": [],
  "summary": "此内容与【关键词】的关联：...",
  "claims": [
    {
      "claim": "",
      "status": "unverified",
      "supportingSources": [],
      "opposingSources": []
    }
  ],
  "reason": ""
}
```

## Scoring Guidance

- `relevanceScore`: direct relationship to the target keyword or topic.
- `evidenceScore`: article completeness, source traceability, author, publish time, and body quality.
- `corroborationScore`: independent support for extracted claims.
- `trustScore`: combined result; keep it below 75 when evidence is incomplete or single-source ordinary media.

## Guardrails

- Never copy long body text into the summary.
- Do not hallucinate evidence or invent source names.
- Do not upgrade content to `trusted` solely because it sounds plausible.
- If evidence and AI interpretation conflict, let evidence win.
- Use the fixed summary format: `此内容与【关键词】的关联：...`
- Keep the audit domain-neutral; do not assume the topic is AI, programming, or technology unless the input says so.

## MVP Limits

- The bundled script performs local rule-based auditing and does not fetch external corroboration by itself.
- If the item lacks body text or independent sources, keep it below `trusted`.
- For higher confidence, provide body text and independent evidence sources, then audit selected candidate items with those additional fields.

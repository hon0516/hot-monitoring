#!/usr/bin/env python3
"""Filter and score hotspot candidates from JSON stdin or file."""

import argparse
import json
import math
import re
import sys
import urllib.parse
from datetime import datetime, timezone

from expand_keyword import expand_keyword


HIGH_QUALITY_DOMAINS = {
    "openai.com",
    "anthropic.com",
    "googleblog.com",
    "blog.google",
    "microsoft.com",
    "github.blog",
    "theverge.com",
    "techcrunch.com",
    "wired.com",
    "arstechnica.com",
    "reuters.com",
    "bloomberg.com",
}

AGGREGATOR_DOMAINS = {
    "google.com",
    "news.google.com",
    "bing.com",
    "duckduckgo.com",
    "sogou.com",
    "s.weibo.com",
}

NOISE_WORDS = [
    "search results",
    "related searches",
    "site search",
    "jobs",
    "coupon",
    "download",
    "login",
    "sign up",
]

TUTORIAL_WORDS = ["tutorial", "course", "how to", "guide", "入门", "教程", "课程", "合集", "资料"]
IMPORTANCE_WORDS = ["launch", "release", "announce", "announces", "unveil", "model", "api", "funding", "security", "发布", "推出", "宣布", "融资", "安全", "模型"]
SOCIAL_CHANNELS = {"twitter", "weibo", "weibo-hot", "bilibili"}


def load_payload(path):
    text = sys.stdin.read() if not path or path == "-" else open(path, "r", encoding="utf-8").read()
    data = json.loads(text)
    if isinstance(data, list):
        return {"results": data, "errors": []}
    return data


def text_of(item):
    author = item.get("author") or {}
    author_text = ""
    if isinstance(author, dict):
        author_text = " ".join(str(author.get(k) or "") for k in ("name", "username", "userName"))
    return " ".join(str(item.get(k) or "") for k in ("title", "content", "source", "sourceType", "sourceChannel", "url")) + " " + author_text


def domain_of(url):
    url = unwrap_known_redirect(url)
    netloc = urllib.parse.urlparse(url or "").netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def unwrap_known_redirect(url):
    parsed = urllib.parse.urlparse(url or "")
    params = urllib.parse.parse_qs(parsed.query)
    if parsed.netloc.lower().endswith("bing.com") and parsed.path.endswith("/news/apiclick.aspx"):
        if "url" in params:
            return params["url"][0]
    return url


def canonical_url(url):
    url = unwrap_known_redirect(url)
    parsed = urllib.parse.urlparse(url or "")
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
    filtered = [(k, v) for k, v in query if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}]
    return urllib.parse.urlunparse(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", urllib.parse.urlencode(filtered), "")
    )


def clamp(value, low=0, high=100):
    return max(low, min(high, int(round(value))))


def channel_of(item):
    return str(item.get("sourceChannel") or item.get("sourceType") or item.get("source") or "").lower()


def engagement_of(item):
    engagement = item.get("engagement")
    if not engagement and item.get("engagementJson"):
        try:
            engagement = json.loads(item.get("engagementJson"))
        except (TypeError, json.JSONDecodeError):
            engagement = None
    if not isinstance(engagement, dict):
        engagement = {}

    def number(*keys):
        for key in keys:
            value = item.get(key)
            if value is None:
                value = engagement.get(key)
            try:
                return float(value or 0)
            except (TypeError, ValueError):
                continue
        return 0.0

    return {
        "views": number("views", "viewCount", "play", "reads"),
        "likes": number("likes", "likeCount", "points"),
        "reposts": number("retweets", "retweetCount", "shares", "reposts"),
        "replies": number("comments", "commentCount", "replyCount", "quotes", "quoteCount"),
        "followers": number("authorFollowers"),
    }


def heat_score(item):
    engagement = engagement_of(item)
    raw = engagement["likes"] * 10
    raw += engagement["reposts"] * 5
    raw += engagement["replies"] * 3
    raw += math.log10(max(engagement["views"], 1)) * 8
    raw += min(15, math.log10(max(engagement["followers"], 1)) * 3)
    return clamp(raw)


def keyword_relevance(item, variants):
    text = text_of(item).casefold()
    title = str(item.get("title") or "").casefold()
    score = 0
    for variant in variants:
        key = variant.casefold()
        if key and key in title:
            score = max(score, 80)
        elif key and key in text:
            score = max(score, 65)

    keyword_tokens = set(re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}", " ".join(variants).casefold()))
    text_tokens = set(re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}", text))
    if keyword_tokens:
        overlap = len(keyword_tokens & text_tokens) / max(1, len(keyword_tokens))
        score = max(score, overlap * 70)
    return clamp(score)


def source_quality(item):
    domain = domain_of(item.get("url"))
    channel = channel_of(item)
    if domain in HIGH_QUALITY_DOMAINS:
        return 90
    if channel in {"google-news", "bing-news", "hackernews"}:
        return 75
    if channel == "bilibili":
        return 58
    if channel in {"weibo", "weibo-hot", "twitter"}:
        return 52
    if domain in AGGREGATOR_DOMAINS:
        return 35
    if domain.endswith(".edu") or domain.endswith(".gov"):
        return 80
    return 60


def evidence_score(item):
    score = 40
    if item.get("content"):
        score += 20
    if item.get("publishedAt"):
        score += 15
    if item.get("author"):
        score += 10
    if item.get("url"):
        score += 10
    if item.get("source"):
        score += 5
    if item.get("sourceId"):
        score += 5
    return clamp(score)


def importance_score(item):
    text = text_of(item).casefold()
    score = 40
    score += min(30, sum(8 for word in IMPORTANCE_WORDS if word.casefold() in text))
    score += min(20, heat_score(item) * 0.2)
    return clamp(score)


def flags_for(item, relevance):
    flags = []
    title = str(item.get("title") or "").strip()
    content = str(item.get("content") or "").strip()
    text = text_of(item).casefold()
    domain = domain_of(item.get("url"))
    channel = channel_of(item)
    if len(title) < 8:
        flags.append("short_title")
    if re.fullmatch(r"[\d\s:：/.-]+", title):
        flags.append("numeric_title")
    if re.fullmatch(r"\d{1,4}[:：]\d{1,2}(\s*[-–—]\s*\d{1,4}[:：]\d{1,2})?", title):
        flags.append("duration_title")
    if domain in AGGREGATOR_DOMAINS:
        flags.append("aggregator_url")
    if channel in SOCIAL_CHANNELS:
        flags.append("social_signal")
    if any(word in text for word in NOISE_WORDS):
        flags.append("search_noise")
    if any(word.casefold() in text for word in TUTORIAL_WORDS):
        flags.append("tutorial_or_collection")
    if not content:
        flags.append("missing_snippet")
    if relevance < 35:
        flags.append("weak_keyword_match")
    return flags


def classify(item, variants):
    relevance = keyword_relevance(item, variants)
    source_score = source_quality(item)
    evidence = evidence_score(item)
    importance = importance_score(item)
    flags = flags_for(item, relevance)
    penalty = 0
    penalty += 25 if "search_noise" in flags or "numeric_title" in flags or "duration_title" in flags else 0
    penalty += 15 if "aggregator_url" in flags else 0
    penalty += 10 if "tutorial_or_collection" in flags else 0
    penalty += 10 if "missing_snippet" in flags else 0
    penalty += 6 if "social_signal" in flags and source_score < 60 else 0
    trust = clamp(relevance * 0.45 + source_score * 0.25 + evidence * 0.2 + importance * 0.1 - penalty)

    if any(flag in flags for flag in ("search_noise", "numeric_title", "duration_title")):
        status = "noise"
    elif relevance < 35:
        status = "low_relevance"
    elif trust >= 75 and relevance >= 60 and "social_signal" not in flags:
        status = "trusted"
    elif trust >= 82 and relevance >= 70 and source_score >= 58:
        status = "trusted"
    else:
        status = "needs_review"

    return {
        **item,
        "canonicalUrl": canonical_url(item.get("url")),
        "domain": domain_of(item.get("url")),
        "url": unwrap_known_redirect(item.get("url")),
        "auditStatus": status,
        "trustScore": trust,
        "relevanceScore": relevance,
        "sourceQualityScore": source_score,
        "evidenceScore": evidence,
        "importance": importance,
        "heatScore": heat_score(item),
        "riskFlags": flags,
        "summary": f"此内容与【{variants[0]}】的关联：{item.get('content') or item.get('title') or '候选内容需要进一步核验。'}",
    }


def main():
    parser = argparse.ArgumentParser(description="Filter and score hotspot candidates.")
    parser.add_argument("--input", "-i", default="-")
    parser.add_argument("--keyword", required=True)
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--min-relevance", type=int, default=35)
    parser.add_argument("--include-noise", action="store_true")
    args = parser.parse_args()

    payload = load_payload(args.input)
    variants = expand_keyword(args.keyword, limit=12)
    seen = set()
    events = []
    duplicates = 0
    for item in payload.get("results", []):
        key = canonical_url(item.get("url")) or str(item.get("title") or "").casefold()
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        event = classify(item, variants)
        if not args.include_noise and event["auditStatus"] == "noise":
            continue
        if event["relevanceScore"] < args.min_relevance and event["auditStatus"] != "noise":
            event["auditStatus"] = "low_relevance"
        events.append(event)

    events.sort(
        key=lambda x: (
            x.get("auditStatus") == "trusted",
            x.get("trustScore", 0),
            x.get("relevanceScore", 0),
            x.get("sourceQualityScore", 0),
            x.get("publishedAt") or x.get("discoveredAt") or "",
        ),
        reverse=True,
    )
    events = events[: args.limit]
    stats = {
        "collected": len(payload.get("results", [])),
        "duplicates": duplicates,
        "returned": len(events),
        "trusted": sum(1 for item in events if item["auditStatus"] == "trusted"),
        "needsReview": sum(1 for item in events if item["auditStatus"] == "needs_review"),
        "lowRelevance": sum(1 for item in events if item["auditStatus"] == "low_relevance"),
        "noise": sum(1 for item in events if item["auditStatus"] == "noise"),
    }
    print(
        json.dumps(
            {
                "keyword": args.keyword,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "queries": payload.get("queries", variants),
                "errors": payload.get("errors", []),
                "stats": stats,
                "events": events,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

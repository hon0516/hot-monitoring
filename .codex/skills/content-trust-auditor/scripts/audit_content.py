#!/usr/bin/env python3
"""Audit one content item for keyword relevance and evidence quality."""

import argparse
import json
import re
import sys
import urllib.parse


NOISE_WORDS = ["search results", "related searches", "login", "download", "coupon", "搜索结果", "相关搜索"]
TUTORIAL_WORDS = ["tutorial", "course", "how to", "guide", "教程", "课程", "合集", "资料"]


def load_item(path):
    if path:
        text = sys.stdin.read() if path == "-" else open(path, "r", encoding="utf-8").read()
        return json.loads(text)
    return {}


def domain_of(url):
    netloc = urllib.parse.urlparse(url or "").netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def clamp(value):
    return max(0, min(100, int(round(value))))


def text_of(item):
    return " ".join(str(item.get(k) or "") for k in ("title", "summary", "content", "body", "source", "url"))


def relevance_score(keyword, item):
    text = text_of(item).casefold()
    title = str(item.get("title") or "").casefold()
    keyword = keyword.casefold()
    if keyword and keyword in title:
        return 85
    if keyword and keyword in text:
        return 70
    tokens = set(re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}", keyword))
    text_tokens = set(re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}", text))
    if not tokens:
        return 0
    return clamp(len(tokens & text_tokens) / len(tokens) * 65)


def classify_type(item):
    text = text_of(item).casefold()
    if any(word in text for word in NOISE_WORDS):
        return "search_noise"
    if any(word.casefold() in text for word in TUTORIAL_WORDS):
        return "tutorial_or_collection"
    if domain_of(item.get("url")).endswith(("openai.com", "anthropic.com", "microsoft.com", "googleblog.com")):
        return "official_announcement"
    return item.get("candidateType") or "unknown"


def risk_flags(item, relevance):
    flags = []
    title = str(item.get("title") or "").strip()
    body = str(item.get("body") or item.get("content") or item.get("summary") or "").strip()
    if len(title) < 8:
        flags.append("short_title")
    if re.fullmatch(r"[\d\s:：/.-]+", title):
        flags.append("numeric_title")
    if not body:
        flags.append("missing_body_or_summary")
    if not item.get("publishedAt"):
        flags.append("missing_published_time")
    if relevance < 35:
        flags.append("weak_keyword_match")
    content_type = classify_type(item)
    if content_type == "search_noise":
        flags.append("search_noise")
    if content_type == "tutorial_or_collection":
        flags.append("tutorial_or_collection")
    return flags


def score(keyword, item):
    relevance = relevance_score(keyword, item)
    content_type = classify_type(item)
    flags = risk_flags(item, relevance)
    evidence = 35
    evidence += 20 if item.get("url") else 0
    evidence += 15 if item.get("publishedAt") else 0
    evidence += 15 if item.get("body") or item.get("content") or item.get("summary") else 0
    evidence += 10 if item.get("author") else 0
    evidence += 10 if content_type == "official_announcement" else 0
    evidence = clamp(evidence)
    corroboration = 20
    sources = item.get("evidenceSources") or item.get("sources") or []
    if isinstance(sources, list):
        domains = {domain_of(source.get("url") if isinstance(source, dict) else str(source)) for source in sources}
        corroboration = clamp(25 + len([d for d in domains if d]) * 20)
    penalty = 25 if "search_noise" in flags or "numeric_title" in flags else 0
    penalty += 10 if "tutorial_or_collection" in flags else 0
    trust = clamp(relevance * 0.4 + evidence * 0.35 + corroboration * 0.25 - penalty)

    if "search_noise" in flags or "numeric_title" in flags:
        status = "noise"
    elif relevance < 35:
        status = "low_relevance"
    elif trust >= 75 and relevance >= 65 and ("missing_body_or_summary" not in flags):
        status = "trusted"
    elif evidence < 45:
        status = "low_evidence"
    else:
        status = "needs_review"

    relation = "direct" if relevance >= 65 else "indirect" if relevance >= 35 else "none"
    body = item.get("summary") or item.get("content") or item.get("body") or item.get("title") or "证据不足，需进一步核验。"
    return {
        "auditStatus": status,
        "contentType": content_type,
        "keywordRelation": relation,
        "trustScore": trust,
        "relevanceScore": relevance,
        "evidenceScore": evidence,
        "corroborationScore": corroboration,
        "importance": 50,
        "riskFlags": flags,
        "summary": f"此内容与【{keyword}】的关联：{' '.join(str(body).split())[:180]}",
        "claims": [],
        "reason": "本地规则审核结果；如需更高可信度，应补充正文和独立佐证来源。",
    }


def main():
    parser = argparse.ArgumentParser(description="Audit one content item for trust and keyword relevance.")
    parser.add_argument("--input", "-i", help="JSON item path, or '-' for stdin.")
    parser.add_argument("--keyword", required=True)
    parser.add_argument("--title")
    parser.add_argument("--summary")
    parser.add_argument("--body")
    parser.add_argument("--url")
    parser.add_argument("--source")
    parser.add_argument("--published-at")
    args = parser.parse_args()

    item = load_item(args.input) if args.input else {}
    for key, value in {
        "title": args.title,
        "summary": args.summary,
        "body": args.body,
        "url": args.url,
        "source": args.source,
        "publishedAt": args.published_at,
    }.items():
        if value is not None:
            item[key] = value

    print(json.dumps(score(args.keyword, item), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()


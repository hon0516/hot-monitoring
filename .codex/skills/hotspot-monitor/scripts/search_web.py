#!/usr/bin/env python3
"""Search lightweight public sources and emit normalized JSON."""

import argparse
import email.utils
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from expand_keyword import expand_keyword


USER_AGENT = "Mozilla/5.0 (compatible; CodexHotspotSkill/1.0; +https://openai.com)"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_date(value):
    if not value:
        return None
    try:
        return email.utils.parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except Exception:
        return value


def strip_html(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    return " ".join(html.unescape(value).split())


def request_text(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace"), response.geturl()


def decode_duck_url(url):
    url = html.unescape(url or "")
    if url.startswith("//"):
        url = "https:" + url
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    if "uddg" in params:
        return params["uddg"][0]
    return url


def unwrap_known_redirect(url):
    url = html.unescape(url or "")
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    if parsed.netloc.lower().endswith("bing.com") and parsed.path.endswith("/news/apiclick.aspx"):
        if "url" in params:
            return params["url"][0]
    return url


def rss_items(xml_text, source_channel, query, discovered_at):
    root = ET.fromstring(xml_text)
    items = []
    for item in root.findall(".//item"):
        title = strip_html(item.findtext("title"))
        content = strip_html(item.findtext("description"))
        url = unwrap_known_redirect(item.findtext("link") or "")
        published_at = parse_date(item.findtext("pubDate"))
        source_name = strip_html(item.findtext("source")) or source_channel
        if title and url:
            items.append(
                {
                    "title": title,
                    "content": content,
                    "url": url,
                    "source": source_name,
                    "sourceChannel": source_channel,
                    "publishedAt": published_at,
                    "author": None,
                    "engagement": None,
                    "query": query,
                    "discoveredAt": discovered_at,
                }
            )
    return items


def search_google_news(query, limit, days, timeout):
    q = f"{query} when:{days}d" if days else query
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"}
    )
    text, _ = request_text(url, timeout)
    return rss_items(text, "google-news", query, now_iso())[:limit]


def search_bing_news(query, limit, days, timeout):
    del days
    url = "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": query, "format": "rss"})
    text, _ = request_text(url, timeout)
    return rss_items(text, "bing-news", query, now_iso())[:limit]


def search_hackernews(query, limit, days, timeout):
    timestamp = int(time.time() - days * 86400)
    params = {
        "query": query,
        "tags": "story",
        "hitsPerPage": str(limit),
        "numericFilters": f"created_at_i>{timestamp}",
    }
    url = "https://hn.algolia.com/api/v1/search_by_date?" + urllib.parse.urlencode(params)
    text, _ = request_text(url, timeout)
    data = json.loads(text)
    discovered_at = now_iso()
    items = []
    for hit in data.get("hits", []):
        title = strip_html(hit.get("title") or hit.get("story_title"))
        item_url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        content = strip_html(hit.get("comment_text") or hit.get("story_text") or "")
        if title and item_url:
            items.append(
                {
                    "title": title,
                    "content": content,
                    "url": item_url,
                    "source": "Hacker News",
                    "sourceChannel": "hackernews",
                    "publishedAt": hit.get("created_at"),
                    "author": hit.get("author"),
                    "engagement": {"points": hit.get("points"), "comments": hit.get("num_comments")},
                    "query": query,
                    "discoveredAt": discovered_at,
                }
            )
    return items


def search_duckduckgo(query, limit, days, timeout):
    del days
    url = "https://duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    text, _ = request_text(url, timeout)
    discovered_at = now_iso()
    chunks = re.split(r'<div class="result results_links', text)
    items = []
    for chunk in chunks[1:]:
        link_match = re.search(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', chunk, re.S)
        if not link_match:
            continue
        snippet_match = re.search(r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', chunk, re.S)
        title = strip_html(link_match.group(2))
        item_url = decode_duck_url(link_match.group(1))
        content = strip_html(snippet_match.group(1) if snippet_match else "")
        if title and item_url:
            items.append(
                {
                    "title": title,
                    "content": content,
                    "url": item_url,
                    "source": "DuckDuckGo",
                    "sourceChannel": "duckduckgo",
                    "publishedAt": None,
                    "author": None,
                    "engagement": None,
                    "query": query,
                    "discoveredAt": discovered_at,
                }
            )
        if len(items) >= limit:
            break
    return items


SOURCE_HANDLERS = {
    "google-news": search_google_news,
    "bing-news": search_bing_news,
    "hackernews": search_hackernews,
    "duckduckgo": search_duckduckgo,
}


def canonical_key(url):
    parsed = urllib.parse.urlparse(url or "")
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
    filtered = [(k, v) for k, v in query if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}]
    return urllib.parse.urlunparse(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", urllib.parse.urlencode(filtered), "")
    )


def main():
    parser = argparse.ArgumentParser(description="Search public hotspot sources and emit JSON.")
    parser.add_argument("keyword")
    parser.add_argument("--sources", default="google-news,bing-news,hackernews,duckduckgo")
    parser.add_argument("--limit", type=int, default=10, help="Max results per source after query expansion.")
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--query-limit", type=int, default=4)
    parser.add_argument("--no-expand", action="store_true")
    args = parser.parse_args()

    sources = [s.strip() for s in args.sources.split(",") if s.strip()]
    queries = [args.keyword] if args.no_expand else expand_keyword(args.keyword, limit=args.query_limit)
    results = []
    errors = []

    for source in sources:
        handler = SOURCE_HANDLERS.get(source)
        if not handler:
            errors.append({"source": source, "error": "unknown source"})
            continue
        source_results = []
        for query in queries:
            try:
                source_results.extend(handler(query, args.limit, args.days, args.timeout))
            except (urllib.error.URLError, TimeoutError, ET.ParseError, json.JSONDecodeError, OSError) as exc:
                errors.append({"source": source, "query": query, "error": str(exc)})
        seen = set()
        for item in source_results:
            key = canonical_key(item.get("url"))
            if key and key not in seen:
                seen.add(key)
                results.append(item)
            if len(seen) >= args.limit:
                break

    print(
        json.dumps(
            {
                "keyword": args.keyword,
                "queries": queries,
                "sources": sources,
                "generatedAt": now_iso(),
                "results": results,
                "errors": errors,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

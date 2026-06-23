#!/usr/bin/env python3
"""Search lightweight Chinese sources and emit normalized JSON."""

import argparse
import html
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

from expand_keyword import expand_keyword


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def user_agent():
    return random.choice(USER_AGENTS)


def strip_html(value):
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", value or "", flags=re.I | re.S)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    return " ".join(html.unescape(value).split())


def request_text(url, timeout, headers=None):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace"), response.geturl()


def request_json(url, timeout, headers=None):
    text, _ = request_text(
        url,
        timeout,
        headers={
            "Accept": "application/json,text/plain,*/*",
            **(headers or {}),
        },
    )
    return json.loads(text)


def normalize_url(url, base=None):
    url = html.unescape(url or "").strip()
    if url.startswith("//"):
        return "https:" + url
    if base:
        return urllib.parse.urljoin(base, url)
    return url


def result_item(title, content, url, source_channel, query, discovered_at, **extra):
    return {
        "title": strip_html(title),
        "content": strip_html(content or title),
        "url": normalize_url(url),
        "source": extra.pop("source", source_channel),
        "sourceChannel": source_channel,
        "publishedAt": extra.pop("publishedAt", None),
        "author": extra.pop("author", None),
        "engagement": extra.pop("engagement", None),
        "query": query,
        "discoveredAt": discovered_at,
        **extra,
    }


def search_sogou(query, limit, timeout):
    url = "https://www.sogou.com/web?" + urllib.parse.urlencode({"query": query, "ie": "utf-8"})
    text, final_url = request_text(url, timeout, headers={"Referer": "https://www.sogou.com/"})
    discovered_at = now_iso()
    results = []

    for chunk in re.split(r'<div[^>]+class="[^"]*(?:vrwrap|rb)[^"]*"[^>]*>', text, flags=re.I)[1:]:
        title_match = re.search(r"<h3[^>]*>.*?<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>.*?</h3>", chunk, flags=re.I | re.S)
        if not title_match:
            title_match = re.search(r"<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>", chunk, flags=re.I | re.S)
        if not title_match:
            continue

        url_value = normalize_url(title_match.group(1), final_url)
        title = strip_html(title_match.group(2))
        snippet_match = re.search(
            r'<(?:p|div|span)[^>]+class="[^"]*(?:space-txt|str-text-info|str_info|text-layout)[^"]*"[^>]*>(.*?)</(?:p|div|span)>',
            chunk,
            flags=re.I | re.S,
        )
        snippet = strip_html(snippet_match.group(1)) if snippet_match else ""
        if title and url_value and "大家还在搜" not in title:
            results.append(result_item(title, snippet or title, url_value, "sogou", query, discovered_at))
        if len(results) >= limit:
            break
    return results


def bili_headers():
    return {
        "Referer": "https://search.bilibili.com/",
        "Origin": "https://search.bilibili.com",
        "Cookie": f"buvid3={uuid.uuid4()}infoc",
    }


def parse_bilibili_time(value):
    try:
        timestamp = int(value or 0)
    except (TypeError, ValueError):
        return None
    if timestamp <= 0:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def search_bilibili(query, limit, timeout):
    url = "https://api.bilibili.com/x/web-interface/search/type?" + urllib.parse.urlencode(
        {
            "keyword": query,
            "search_type": "video",
            "order": "pubdate",
            "page": 1,
            "pagesize": limit,
        }
    )
    data = request_json(url, timeout, headers=bili_headers())
    if data.get("code") != 0:
        raise RuntimeError(f"bilibili response code {data.get('code')}")

    discovered_at = now_iso()
    results = []
    for video in data.get("data", {}).get("result") or []:
        title = strip_html(video.get("title") or "")
        bvid = video.get("bvid")
        if not title or not bvid or re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", title):
            continue
        engagement = {
            "views": video.get("play") or 0,
            "likes": video.get("like") or 0,
            "comments": video.get("review") or 0,
            "danmaku": video.get("danmaku") or 0,
            "favorites": video.get("favorites") or 0,
        }
        results.append(
            result_item(
                title,
                video.get("description") or title,
                f"https://www.bilibili.com/video/{bvid}",
                "bilibili",
                query,
                discovered_at,
                source="Bilibili",
                sourceId=bvid,
                publishedAt=parse_bilibili_time(video.get("pubdate")),
                author={"name": video.get("author") or "", "username": str(video.get("mid") or "")},
                engagement=engagement,
            )
        )
        if len(results) >= limit:
            break
    return results


def search_bilibili_user(keyword, timeout):
    url = "https://api.bilibili.com/x/web-interface/search/type?" + urllib.parse.urlencode(
        {"keyword": keyword, "search_type": "bili_user", "page": 1, "pagesize": 5}
    )
    data = request_json(url, timeout, headers=bili_headers())
    if data.get("code") != 0:
        return None
    users = data.get("data", {}).get("result") or []
    if not users:
        return None
    lowered = keyword.casefold()
    for user in users:
        if str(user.get("uname") or "").casefold() == lowered:
            return user
    top = users[0]
    name = str(top.get("uname") or "")
    if int(top.get("fans") or 0) > 1000 and lowered in name.casefold():
        return top
    return None


def search_bilibili_user_videos(keyword, limit, timeout):
    user = search_bilibili_user(keyword, timeout)
    if not user:
        return []
    mid = user.get("mid")
    url = "https://api.bilibili.com/x/space/arc/search?" + urllib.parse.urlencode(
        {"mid": mid, "pn": 1, "ps": limit, "order": "pubdate"}
    )
    data = request_json(url, timeout, headers={"Referer": f"https://space.bilibili.com/{mid}"})
    discovered_at = now_iso()
    results = []
    for video in data.get("data", {}).get("list", {}).get("vlist") or []:
        title = strip_html(video.get("title") or "")
        bvid = video.get("bvid")
        if not title or not bvid:
            continue
        engagement = {
            "views": video.get("play") or 0,
            "comments": video.get("comment") or video.get("review") or 0,
            "danmaku": video.get("danmaku") or 0,
        }
        results.append(
            result_item(
                title,
                video.get("description") or title,
                f"https://www.bilibili.com/video/{bvid}",
                "bilibili",
                keyword,
                discovered_at,
                source="Bilibili",
                sourceId=bvid,
                publishedAt=parse_bilibili_time(video.get("created")),
                author={"name": user.get("uname") or "", "username": str(mid or "")},
                engagement=engagement,
            )
        )
        if len(results) >= limit:
            break
    return results


def fuzzy_weibo_match(keyword, word):
    keyword = re.sub(r"\s+", "", keyword.casefold())
    word = re.sub(r"\s+", "", word.casefold())
    if not keyword or not word:
        return False
    if keyword in word or word in keyword:
        return True
    tokens = re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}", keyword)
    if not tokens:
        return False
    return any(len(token) >= 2 and token in word for token in tokens)


def search_weibo_hot(query, limit, timeout):
    data = request_json(
        "https://weibo.com/ajax/side/hotSearch",
        timeout,
        headers={"Referer": "https://weibo.com/"},
    )
    if data.get("ok") != 1:
        raise RuntimeError("weibo hot search returned non-ok response")
    discovered_at = now_iso()
    results = []
    for item in data.get("data", {}).get("realtime") or []:
        word = item.get("note") or item.get("word") or ""
        if not fuzzy_weibo_match(query, word):
            continue
        heat = item.get("num") or item.get("raw_hot") or 0
        topic = word.strip("#")
        url = "https://s.weibo.com/weibo?" + urllib.parse.urlencode({"q": f"#{topic}#"})
        results.append(
            result_item(
                word,
                f"微博热搜: {word}，热度 {heat}",
                url,
                "weibo-hot",
                query,
                discovered_at,
                source="Weibo Hot Search",
                engagement={"reads": heat},
            )
        )
        if len(results) >= limit:
            break
    return results


SOURCE_HANDLERS = {
    "sogou": search_sogou,
    "bilibili": search_bilibili,
    "weibo-hot": search_weibo_hot,
}


def canonical_key(item):
    url = item.get("url") or ""
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", "", ""))


def main():
    parser = argparse.ArgumentParser(description="Search Chinese hotspot sources and emit JSON.")
    parser.add_argument("keyword")
    parser.add_argument("--sources", default="sogou,bilibili,weibo-hot")
    parser.add_argument("--limit", type=int, default=10, help="Max results per source.")
    parser.add_argument("--timeout", type=float, default=12)
    parser.add_argument("--query-limit", type=int, default=3)
    parser.add_argument("--no-expand", action="store_true")
    parser.add_argument("--detect-account", action="store_true", help="Fetch latest videos when keyword matches a Bilibili account.")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between source/query calls.")
    args = parser.parse_args()

    sources = [s.strip() for s in args.sources.split(",") if s.strip()]
    queries = [args.keyword] if args.no_expand else expand_keyword(args.keyword, limit=args.query_limit)
    results = []
    errors = []

    if args.detect_account and "bilibili" in sources:
        try:
            results.extend(search_bilibili_user_videos(args.keyword, args.limit, args.timeout))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, RuntimeError) as exc:
            errors.append({"source": "bilibili", "query": args.keyword, "error": str(exc), "mode": "detect-account"})

    for source in sources:
        handler = SOURCE_HANDLERS.get(source)
        if not handler:
            errors.append({"source": source, "error": "unknown source"})
            continue
        source_results = []
        for query in queries:
            try:
                source_results.extend(handler(query, args.limit, args.timeout))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, RuntimeError) as exc:
                errors.append({"source": source, "query": query, "error": str(exc)})
            time.sleep(args.delay)
        seen = set()
        for item in source_results:
            key = canonical_key(item) or str(item.get("title") or "").casefold()
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

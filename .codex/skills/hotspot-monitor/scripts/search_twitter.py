#!/usr/bin/env python3
"""Search Twitter/X through twitterapi.io and emit normalized JSON."""

import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


API_BASE = "https://api.twitterapi.io"

MIN_LIKES = 10
MIN_RETWEETS = 5
MIN_VIEWS = 500
MIN_FOLLOWERS = 100


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def api_key():
    return os.environ.get("TWITTER_API_KEY") or os.environ.get("TWITTERAPI_IO_KEY") or ""


def request_json(endpoint, params, timeout):
    key = api_key()
    if not key:
        raise RuntimeError("TWITTER_API_KEY is not set")
    url = API_BASE + endpoint + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "X-API-Key": key,
            "Accept": "application/json",
            "User-Agent": "CodexHotspotSkill/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def since_date(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


def build_query(keyword, query_type):
    parts = [keyword, "-filter:retweets", "-filter:replies"]
    parts.append(f"since:{since_date(7 if query_type == 'Top' else 3)}")
    if query_type == "Top":
        parts.append("min_faves:10")
    return " ".join(parts)


def fetch_page(keyword, query_type, timeout, cursor=None):
    params = {"query": build_query(keyword, query_type), "queryType": query_type}
    if cursor:
        params["cursor"] = cursor
    data = request_json("/twitter/tweet/advanced_search", params, timeout)
    tweets = data.get("tweets") if isinstance(data.get("tweets"), list) else []
    next_cursor = data.get("next_cursor") if data.get("has_next_page") else None
    return tweets, next_cursor


def quality_filter(tweets):
    filtered = []
    for tweet in tweets:
        text = str(tweet.get("text") or "").strip()
        if not text or re.match(r"^@\w+\s", text):
            continue
        if "reply" in str(tweet.get("type") or "").casefold():
            continue

        author = tweet.get("author") or {}
        factor = 0.5 if author.get("isBlueVerified") else 1.0
        if int(tweet.get("likeCount") or 0) < MIN_LIKES * factor:
            continue
        if int(tweet.get("retweetCount") or 0) < MIN_RETWEETS * factor:
            continue
        if int(tweet.get("viewCount") or 0) < MIN_VIEWS * factor:
            continue
        if int(author.get("followers") or 0) < MIN_FOLLOWERS * factor:
            continue
        filtered.append(tweet)

    def score(tweet):
        author = tweet.get("author") or {}
        value = int(tweet.get("likeCount") or 0) * 2
        value += int(tweet.get("retweetCount") or 0) * 3
        value += int(tweet.get("replyCount") or 0) * 2
        value += int(tweet.get("viewCount") or 0) / 100
        if author.get("isBlueVerified"):
            value += 50
        return value

    return sorted(filtered, key=score, reverse=True)


def tweet_url(tweet):
    if tweet.get("url"):
        return tweet.get("url")
    author = tweet.get("author") or {}
    username = author.get("userName") or author.get("username") or ""
    tweet_id = tweet.get("id") or ""
    if username and tweet_id:
        return f"https://x.com/{username}/status/{tweet_id}"
    return ""


def tweet_to_result(tweet, query, discovered_at):
    author = tweet.get("author") or {}
    text = str(tweet.get("text") or "").strip()
    return {
        "title": text[:120],
        "content": text,
        "url": tweet_url(tweet),
        "source": "Twitter/X",
        "sourceChannel": "twitter",
        "sourceId": tweet.get("id"),
        "publishedAt": tweet.get("createdAt"),
        "author": {
            "name": author.get("name") or "",
            "username": author.get("userName") or author.get("username") or "",
            "followers": author.get("followers") or 0,
            "verified": bool(author.get("isBlueVerified")),
        },
        "engagement": {
            "views": tweet.get("viewCount") or 0,
            "likes": tweet.get("likeCount") or 0,
            "retweets": tweet.get("retweetCount") or 0,
            "replies": tweet.get("replyCount") or 0,
            "quotes": tweet.get("quoteCount") or 0,
        },
        "query": query,
        "discoveredAt": discovered_at,
    }


def search_twitter(keyword, limit, timeout):
    all_tweets = []
    seen = set()

    def add(tweets):
        for tweet in tweets:
            tweet_id = tweet.get("id")
            if tweet_id and tweet_id not in seen:
                seen.add(tweet_id)
                all_tweets.append(tweet)

    top_cursor = None
    try:
        tweets, top_cursor = fetch_page(keyword, "Top", timeout)
        add(tweets)
    except Exception as exc:
        raise RuntimeError(f"twitter top search failed: {exc}") from exc

    try:
        tweets, _ = fetch_page(keyword, "Latest", timeout)
        add(tweets)
    except Exception:
        pass

    if top_cursor:
        try:
            tweets, _ = fetch_page(keyword, "Top", timeout, cursor=top_cursor)
            add(tweets)
        except Exception:
            pass

    discovered_at = now_iso()
    return [tweet_to_result(tweet, keyword, discovered_at) for tweet in quality_filter(all_tweets)[:limit]]


def get_trends(timeout):
    data = request_json("/twitter/trends", {"woeid": "1"}, timeout)
    discovered_at = now_iso()
    results = []
    for item in data.get("trends") or []:
        name = item.get("name") or item.get("trend") or ""
        if not name:
            continue
        query = item.get("query") or name
        results.append(
            {
                "title": name,
                "content": f"Twitter/X worldwide trend: {name}",
                "url": "https://x.com/search?" + urllib.parse.urlencode({"q": query}),
                "source": "Twitter/X Trends",
                "sourceChannel": "twitter",
                "publishedAt": None,
                "author": None,
                "engagement": {"tweetVolume": item.get("tweet_volume") or item.get("tweetVolume") or 0},
                "query": query,
                "discoveredAt": discovered_at,
            }
        )
    return results


def get_user_tweets(username, limit, timeout):
    data = request_json("/twitter/user/last_tweets", {"userName": username}, timeout)
    tweets = data.get("tweets") if isinstance(data.get("tweets"), list) else []
    discovered_at = now_iso()
    return [tweet_to_result(tweet, username, discovered_at) for tweet in tweets[:limit]]


def main():
    parser = argparse.ArgumentParser(description="Search Twitter/X hotspot source and emit JSON.")
    parser.add_argument("keyword", nargs="?")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--trends", action="store_true")
    parser.add_argument("--user")
    args = parser.parse_args()

    errors = []
    results = []
    keyword = args.keyword or args.user or "twitter-trends"
    sources = ["twitter"]

    try:
        if args.trends:
            results = get_trends(args.timeout)[: args.limit]
        elif args.user:
            results = get_user_tweets(args.user, args.limit, args.timeout)
        elif args.keyword:
            results = search_twitter(args.keyword, args.limit, args.timeout)
        else:
            raise RuntimeError("keyword, --user, or --trends is required")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, RuntimeError) as exc:
        errors.append({"source": "twitter", "query": keyword, "error": str(exc)})

    print(
        json.dumps(
            {
                "keyword": keyword,
                "queries": [keyword],
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

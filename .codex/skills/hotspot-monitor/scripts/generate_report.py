#!/usr/bin/env python3
"""Generate a Markdown hotspot report from filtered JSON."""

import argparse
import json
import sys
from datetime import datetime


STATUS_TITLES = {
    "trusted": "可信热点",
    "needs_review": "待核验",
    "low_relevance": "低相关",
    "noise": "噪音",
}


def load_payload(path):
    text = sys.stdin.read() if not path or path == "-" else open(path, "r", encoding="utf-8").read()
    data = json.loads(text)
    if isinstance(data, list):
        return {"events": data, "stats": {}}
    return data


def one_line(value, limit=160):
    value = " ".join(str(value or "").split())
    return value if len(value) <= limit else value[: limit - 1] + "..."


def render_item(item):
    title = one_line(item.get("title"), 120)
    url = item.get("url") or ""
    source = item.get("source") or item.get("domain") or "unknown"
    summary = one_line(item.get("summary") or item.get("content") or title, 180)
    flags = ", ".join(item.get("riskFlags") or []) or "none"
    heat = item.get("heatScore")
    heat_text = f" | 热度: {heat}" if heat is not None else ""
    return "\n".join(
        [
            f"- **{title}**",
            f"  摘要: {summary}",
            f"  来源: {source} | 可信度: {item.get('trustScore', 0)} | 相关性: {item.get('relevanceScore', 0)} | 重要度: {item.get('importance', 0)}{heat_text}",
            f"  风险标记: {flags} | [原文链接]({url})",
        ]
    )


def main():
    parser = argparse.ArgumentParser(description="Generate Markdown report from hotspot JSON.")
    parser.add_argument("--input", "-i", default="-")
    parser.add_argument("--keyword")
    parser.add_argument("--max-items", type=int, default=20)
    parser.add_argument("--include-low", action="store_true")
    args = parser.parse_args()

    payload = load_payload(args.input)
    keyword = args.keyword or payload.get("keyword") or "热点"
    events = payload.get("events") or payload.get("results") or []
    allowed = {"trusted", "needs_review"} if not args.include_low else set(STATUS_TITLES)
    events = [event for event in events if event.get("auditStatus", "needs_review") in allowed][: args.max_items]

    print(f"## 热点监控报告 - {keyword}")
    print(f"> 生成时间: {datetime.now().isoformat(timespec='seconds')} | 返回条数: {len(events)}")
    stats = payload.get("stats") or {}
    if stats:
        print(
            f"> 采集: {stats.get('collected', 0)} | 可信: {stats.get('trusted', 0)} | "
            f"待核验: {stats.get('needsReview', 0)} | 去重: {stats.get('duplicates', 0)}"
        )
    errors = payload.get("errors") or []
    if errors:
        failed = "; ".join(f"{e.get('source')}:{e.get('error')}" for e in errors[:5])
        print(f"> 来源异常: {failed}")
    print()

    if not events:
        print("未发现满足当前过滤条件的热点。")
        return

    for status in ("trusted", "needs_review", "low_relevance", "noise"):
        group = [event for event in events if event.get("auditStatus", "needs_review") == status]
        if not group:
            continue
        print(f"### {STATUS_TITLES[status]}")
        for item in group:
            print(render_item(item))
        print()


if __name__ == "__main__":
    main()

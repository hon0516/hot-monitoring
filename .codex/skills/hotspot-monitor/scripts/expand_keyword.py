#!/usr/bin/env python3
"""Generate compact keyword variants for hotspot search."""

import argparse
import json
import re


ALIASES = {
    "ai编程": ["AI programming", "AI coding", "AI code generation"],
    "人工智能": ["AI", "artificial intelligence"],
    "大模型": ["large language model", "LLM"],
    "编程": ["programming", "coding"],
    "智能体": ["AI agent", "agentic AI"],
    "开源": ["open source"],
    "openai": ["OpenAI", "ChatGPT", "GPT"],
    "chatgpt": ["ChatGPT", "OpenAI ChatGPT"],
}


def dedupe(values):
    seen = set()
    result = []
    for value in values:
        value = " ".join(str(value).strip().split())
        if not value:
            continue
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def expand_keyword(keyword, limit=12, extras=None):
    variants = [keyword]
    compact = re.sub(r"\s+", "", keyword)
    if compact and compact != keyword:
        variants.append(compact)

    spaced = re.sub(r"([A-Za-z])([\u4e00-\u9fff])", r"\1 \2", keyword)
    spaced = re.sub(r"([\u4e00-\u9fff])([A-Za-z])", r"\1 \2", spaced)
    if spaced != keyword:
        variants.append(spaced)

    if " " in keyword:
        variants.append(keyword.replace(" ", "-"))
    if "-" in keyword:
        variants.append(keyword.replace("-", " "))

    lowered = keyword.casefold()
    for key, values in ALIASES.items():
        if key in lowered:
            variants.extend(values)

    if extras:
        variants.extend(extras)

    return dedupe(variants)[:limit]


def main():
    parser = argparse.ArgumentParser(description="Expand a hotspot keyword into compact search variants.")
    parser.add_argument("keyword")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--extra", action="append", default=[], help="Additional query variant.")
    parser.add_argument("--plain", action="store_true", help="Print one variant per line instead of JSON.")
    args = parser.parse_args()

    variants = expand_keyword(args.keyword, limit=args.limit, extras=args.extra)
    if args.plain:
        print("\n".join(variants))
    else:
        print(json.dumps(variants, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()


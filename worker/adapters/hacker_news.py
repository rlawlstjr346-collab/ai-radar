"""Hacker News (Algolia) — AI/LLM 키워드 스토리 중 포인트 컷오프 통과분."""

from __future__ import annotations

import re
import time
from urllib.parse import parse_qs, urlsplit

from adapters.base import BaseAdapter, parse_dt, with_query
from collector.classify import classify_news
from collector.models import RawItem

QUERIES = ("LLM", "AI", "GPT", "Claude", "Gemini", "OpenAI", "Anthropic", "open source model",
           "diffusion", "machine learning", "agent", "Llama")
LOOKBACK_HOURS = 72

# Algolia 는 부분일치가 넓어서 제목에 AI 키워드가 '단어로' 있는 것만 통과
AI_TITLE_RE = re.compile(
    r"\b(ai|a\.i\.|llms?|gpt[-\w.]*|chatgpt|claude|gemini|openai|anthropic|deepmind|mistral|llama[\w.-]*|"
    r"qwen[\w.-]*|deepseek[\w.-]*|transformers?|diffusion|machine learning|neural|agents?|agentic|"
    r"hugging ?face|ollama|vllm|inference|fine-?tun\w*|rag|embeddings?|copilot|cursor|model)\b",
    re.I,
)


class HackerNewsAdapter(BaseAdapter):
    endpoint_markers = ("hn.algolia.com",)

    def fetch(self) -> list[RawItem]:
        since = int(time.time()) - LOOKBACK_HOURS * 3600
        seen: dict[str, RawItem] = {}
        # endpoint 의 numericFilters(예: points>=100)는 유지하고 기간 조건만 덧붙인다
        existing = parse_qs(urlsplit(self.source.endpoint).query).get("numericFilters", [])
        numeric = ",".join([*existing, f"created_at_i>{since}"])
        for q in QUERIES:
            url = with_query(self.source.endpoint, query=q, hitsPerPage=50, numericFilters=numeric)
            for hit in self.get_json(url).get("hits", []):
                oid = str(hit.get("objectID"))
                title = (hit.get("title") or "").strip()
                if oid in seen or not title or not AI_TITLE_RE.search(title):
                    continue
                points = int(hit.get("points") or 0)
                hn_url = f"https://news.ycombinator.com/item?id={oid}"
                seen[oid] = self.item(
                    category=classify_news(title, self.source.default_category),
                    url=hit.get("url") or hn_url,
                    title=title,
                    body=(f"Hacker News story with {points} points and {hit.get('num_comments', 0)} comments. "
                          f"Discussion: {hn_url}. {(hit.get('story_text') or '')[:2000]}"),
                    metrics={"points": points, "comments": hit.get("num_comments", 0), "hn_url": hn_url},
                    engagement=float(points),
                    published_at=parse_dt(hit.get("created_at")),
                )
        return list(seen.values())

"""Hugging Face 어댑터 3종: Daily Papers / Trending Models / Trending Spaces."""

from __future__ import annotations

from adapters.base import BaseAdapter, parse_dt, with_query
from collector.classify import classify_hf_model, classify_space
from collector.models import RawItem
from collector.normalize import strip_html

HF = "https://huggingface.co"


class HFDailyPapersAdapter(BaseAdapter):
    endpoint_markers = ("huggingface.co/api/daily_papers",)

    def fetch(self) -> list[RawItem]:
        out = []
        for row in self.get_json(self.source.endpoint):
            paper = row.get("paper") or {}
            arxiv_id = paper.get("id")
            if not arxiv_id:
                continue
            upvotes = int(paper.get("upvotes") or 0)
            metrics = {"upvotes": upvotes, "comments": row.get("numComments", 0)}
            if paper.get("githubRepo"):
                metrics["github_repo"] = paper["githubRepo"]
                metrics["github_stars"] = paper.get("githubStars")
            out.append(self.item(
                url=f"https://arxiv.org/abs/{arxiv_id}",
                title=(paper.get("title") or row.get("title") or "").strip(),
                body=strip_html(paper.get("summary") or row.get("summary") or "", 4000),
                thumbnail_url=row.get("thumbnail"),
                metrics=metrics,
                engagement=upvotes * 4.0,          # 업보트 1 ≈ HN 4점 (커뮤니티 크기 보정)
                published_at=parse_dt(paper.get("publishedAt") or row.get("publishedAt")),
            ))
        return out


class HFTrendingModelsAdapter(BaseAdapter):
    endpoint_markers = ("huggingface.co/api/models",)

    def fetch(self) -> list[RawItem]:
        out = []
        for m in self.get_json(self.source.endpoint):
            model_id = m.get("id") or m.get("modelId")
            if not model_id:
                continue
            tags = [t for t in m.get("tags", []) if not t.startswith(("region:", "deploy:", "endpoints_"))]
            license_ = next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), None)
            trending = float(m.get("trendingScore") or 0)
            body = (
                f"Hugging Face model repository '{model_id}'. "
                f"Task: {m.get('pipeline_tag') or 'unknown'}. Library: {m.get('library_name') or 'unknown'}. "
                f"License: {license_ or 'not stated'}. Tags: {', '.join(tags[:20])}. "
                f"Likes: {m.get('likes', 0)}. Downloads (last 30 days): {m.get('downloads', 0)}."
            )
            out.append(self.item(
                category=classify_hf_model(m.get("pipeline_tag"), tags),
                url=f"{HF}/{model_id}",
                title=model_id,
                body=body,
                metrics={"likes": m.get("likes", 0), "downloads": m.get("downloads", 0),
                         "trending_score": trending, "pipeline_tag": m.get("pipeline_tag")},
                engagement=trending * 2.0,
                published_at=parse_dt(m.get("createdAt")),
            ))
        return out




class HFTrendingSpacesAdapter(BaseAdapter):
    endpoint_markers = ("huggingface.co/api/spaces",)
    EXPAND = ["cardData", "likes", "sdk", "tags", "createdAt", "trendingScore"]

    def fetch(self) -> list[RawItem]:
        url = with_query(self.source.endpoint, **{"expand[]": self.EXPAND})
        out = []
        for s in self.get_json(url):
            space_id = s.get("id")
            if not space_id:
                continue
            card = s.get("cardData") or {}
            title = card.get("title") or space_id.split("/")[-1]
            desc = card.get("short_description") or ""
            haystack = " ".join([space_id.replace("-", " ").replace("_", " "), title, desc, " ".join(s.get("tags", []))])
            category = classify_space(haystack)
            if category is None:
                continue                                      # 이미지·영상·오디오·챗 Space 만
            trending = float(s.get("trendingScore") or 0)
            body = (
                f"Hugging Face Space (web demo app) '{space_id}'. Title: {title}. "
                f"Description: {desc or 'not provided'}. SDK: {s.get('sdk') or card.get('sdk')}. "
                f"License: {card.get('license') or 'not stated'}. Likes: {s.get('likes', 0)}."
            )
            out.append(self.item(
                category=category,
                url=f"{HF}/spaces/{space_id}",
                title=f"{card.get('emoji', '')} {title}".strip(),
                body=body,
                thumbnail_url=card.get("thumbnail"),
                metrics={"likes": s.get("likes", 0), "trending_score": trending, "sdk": s.get("sdk")},
                engagement=trending * 2.0,
                published_at=parse_dt(s.get("createdAt")),
            ))
        return out

"""Bluesky — 인증 없는 공개 AppView getAuthorFeed 로 AI 계정 목록을 순회.

- 계정 목록은 config/bluesky_accounts.json 으로 분리.
- 존재하지 않는 핸들·일시 오류는 해당 계정만 건너뛴다 (skipped 에 기록).
- 리포스트·답글 제외, 최근 lookback_hours 내 + 좋아요 min_likes 이상만.
- 게시물이 외부 링크(논문·블로그)를 품고 있으면 그 링크를 이슈 URL 로 삼아 다른 소스와 중복 병합되게 한다.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from adapters.base import BaseAdapter, parse_dt, with_query
from collector.models import RawItem

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "bluesky_accounts.json"
FEED_PATH = "/xrpc/app.bsky.feed.getAuthorFeed"


def load_config(path: Path = CONFIG_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class BlueskyAdapter(BaseAdapter):
    endpoint_markers = ("bsky.app/xrpc",)

    def __init__(self, source, client, config: dict | None = None) -> None:
        super().__init__(source, client)
        self.config = config or load_config()
        self.skipped: list[str] = []

    def feed_url(self) -> str:
        # DB endpoint 가 예전 getListFeed 템플릿이어도 동작하도록 호스트만 취해 getAuthorFeed 로 고정
        base = self.source.endpoint.split("/xrpc/")[0]
        return base + FEED_PATH

    def fetch(self) -> list[RawItem]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.config.get("lookback_hours", 72))
        min_likes = self.config.get("min_likes", 15)
        out: list[RawItem] = []
        for handle in self.config["handles"]:
            url = with_query(self.feed_url(), actor=handle, limit=self.config.get("posts_per_account", 30),
                             filter="posts_no_replies")
            try:
                feed = self.get_json(url).get("feed", [])
            except Exception as e:                       # 계정 하나 실패 → 건너뛰고 계속
                self.skipped.append(f"{handle}: {type(e).__name__}")
                continue
            for entry in feed:
                if entry.get("reason"):                  # 리포스트
                    continue
                item = self._to_item(entry, handle, cutoff, min_likes)
                if item:
                    out.append(item)
        return out

    def _to_item(self, entry: dict, handle: str, cutoff: datetime, min_likes: int) -> RawItem | None:
        post = entry.get("post") or {}
        record = post.get("record") or {}
        if "reply" in record:                            # 답글 (값이 비어 있어도 답글)
            return None
        created = parse_dt(record.get("createdAt") or post.get("indexedAt"))
        likes = int(post.get("likeCount") or 0)
        text = (record.get("text") or "").strip()
        if not created or created < cutoff or likes < min_likes or not text:
            return None

        author = (post.get("author") or {}).get("handle", handle)
        rkey = post.get("uri", "").rsplit("/", 1)[-1]
        post_url = f"https://bsky.app/profile/{author}/post/{rkey}"

        external = ((post.get("embed") or {}).get("external")) or {}
        link = external.get("uri")
        first_line = text.splitlines()[0]
        title = first_line if len(first_line) <= 120 else first_line[:117] + "…"
        reposts = int(post.get("repostCount") or 0)
        body = f"Bluesky post by @{author}:\n{text}"
        if link:
            body += f"\n\nLinked page: {external.get('title') or ''} — {external.get('description') or ''} ({link})"

        return self.item(
            url=link or post_url,
            title=title,
            body=body,
            thumbnail_url=external.get("thumb"),
            metrics={"likes": likes, "reposts": reposts, "replies": post.get("replyCount", 0),
                     "author": author, "post_url": post_url},
            engagement=likes * 0.5 + reposts * 1.5,
            published_at=created,
        )

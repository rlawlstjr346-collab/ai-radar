"""대표 사진 품질 게이트 — 글자판·로고판 썸네일을 걸러 실사 사진·풍부한 일러스트만 남긴다.

3단계 (앞 단계에서 걸리면 즉시 거절, 판정은 이미지 URL 기준으로 메타 파일에 캐시):
1) 호스트·경로 패턴: 제목 글자로 자동 생성되는 OG 카드 서비스 (Zenn·Qiita·note·Hatena·GitHub OG·HF 논문 카드·/api/og …)
2) 픽셀 통계: 배경 단색 점유율이 높고 색 엔트로피가 낮은 '글자/로고 한 장' 이미지
3) Gemini 멀티모달 판정: 글자가 화면 주인공인 배너·단순 기업 로고판이면 거절
"""

from __future__ import annotations

import io
import os
import logging
import math
import re
from datetime import datetime, timedelta
from typing import Any, Optional

import httpx

logger = logging.getLogger("ai_radar.image_gate")

VERDICT_CACHE_KEY = "image_verdicts"
VERDICT_TTL_DAYS = 45
MAX_IMAGE_BYTES = 6_000_000

TEXT_CARD_RE = re.compile(
    r"(res\.cloudinary\.com/zenn|qiita-user-contents|qiita\.com|cdn\.qiita|st-note\.com|note\.com/.*/og|"
    r"social\.news\.hada\.io|hatena|hatenablog|b\.st-hatena|opengraph\.githubassets\.com|repository-images\.githubusercontent|"
    r"huggingface\.co/(?:social-thumbnails|front/thumbnails)/|cdn-thumbnails\.huggingface\.co/social-thumbnails/|"
    r"/api/og\b|/og-image|og-image\.|ogimage|/og/|share-card|sharecard|social-card|/opengraph-image)",
    re.I,
)

# 픽셀 판정: 거의 한 색뿐인 이미지(단색 배경 로고·빈 카드)만 즉시 거절한다.
# 어두운 무대 사진·파스텔 일러스트도 최빈색 점유율이 높게 나와 픽셀만으로는 글자판과 구별이 안 되므로 나머지는 비전 판정에 맡긴다.
NEAR_SOLID_ENTROPY = 1.2
PHOTO_TOP_SHARE = 0.12
PHOTO_ENTROPY = 7.0


def is_text_card_url(url: str) -> bool:
    return bool(TEXT_CARD_RE.search(url or ""))


def pixel_stats(data: bytes) -> Optional[tuple[float, float]]:
    """(최빈 색 점유율, 색 엔트로피). 디코드 불가면 None."""
    try:
        from PIL import Image
    except ImportError:            # pragma: no cover - requirements 에 포함
        return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGB")
            im.thumbnail((96, 96))
            px = list(im.getdata())
    except Exception:
        return None
    if not px:
        return None
    buckets: dict[tuple[int, int, int], int] = {}
    for r, g, b in px:
        k = (r >> 4, g >> 4, b >> 4)                 # 채널당 16단계 → 4096색
        buckets[k] = buckets.get(k, 0) + 1
    n = len(px)
    top = max(buckets.values()) / n
    entropy = -sum((c / n) * math.log2(c / n) for c in buckets.values())
    return top, entropy


def pixel_verdict(data: bytes) -> tuple[Optional[bool], str]:
    """False=거의 단색(로고·빈 카드), True=색이 풍부한 사진 후보, None=비전 판정 필요. 최종 판단은 비전이 한다."""
    stats = pixel_stats(data)
    if stats is None:
        return False, "undecodable"
    top, ent = stats
    if ent < NEAR_SOLID_ENTROPY:
        return False, f"solid(top={top:.2f},H={ent:.1f})"
    if top < PHOTO_TOP_SHARE and ent >= PHOTO_ENTROPY:
        return True, f"rich(top={top:.2f},H={ent:.1f})"
    return None, f"plain(top={top:.2f},H={ent:.1f})"


VISION_PROMPT = (
    "You are a photo editor choosing thumbnails for a news front page. Classify this image.\n"
    "Return JSON only: {\"kind\": one of [\"photo\", \"illustration\", \"text_card\", \"logo\", \"ui_or_chart\"]}\n"
    "- photo: real-world photograph (people, products, places, stage, hardware) with at most a tiny caption or watermark.\n"
    "- illustration: drawn or 3D artwork / rich graphic with visual subject matter (not mainly words).\n"
    "- text_card: a headline/title/slide of 3 or more words in large type is a main element, in any language —"
    " even when it is laid over a photo (podcast covers, YouTube-style thumbnails, title cards, infographics).\n"
    "- logo: mostly a company or product wordmark/logo on a plain background.\n"
    "- ui_or_chart: a software screenshot, code, table or chart."
)


def vision_verdict(gemini: Any, data: bytes, mime: str) -> tuple[Optional[bool], str]:
    try:
        out, model = gemini.generate_json(VISION_PROMPT, image=(data, mime))
    except Exception as e:  # noqa: BLE001 - 비전 실패는 픽셀 판정으로만 결정
        return None, f"vision-failed:{type(e).__name__}"
    if not isinstance(out, dict):
        return None, "vision-bad-json"
    kind = str(out.get("kind") or "").lower()
    if kind not in ("photo", "illustration", "text_card", "logo", "ui_or_chart"):
        return None, f"vision-unknown:{kind[:20]}"
    return kind in ("photo", "illustration"), f"vision:{kind}@{model}"


def download_image(client: httpx.Client, url: str) -> Optional[tuple[bytes, str]]:
    try:
        resp = client.get(url, headers={"Accept": "image/avif,image/webp,image/*,*/*;q=0.8"})
    except httpx.HTTPError:
        return None
    ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
    if resp.status_code >= 400 or not ctype.startswith("image/") or "svg" in ctype:
        return None
    if len(resp.content) > MAX_IMAGE_BYTES or len(resp.content) < 3_000:
        return None
    return resp.content, ctype


def _fresh(entry: Any, now: datetime) -> bool:
    if not isinstance(entry, dict) or "ok" not in entry:
        return False
    try:
        at = datetime.fromisoformat(str(entry.get("at", "")).replace("Z", "+00:00"))
    except ValueError:
        return False
    return now - at < timedelta(days=VERDICT_TTL_DAYS)


class ImageGate:
    """이미지 URL → 통과 여부. verdicts 는 {url: {ok, why, at}} 로 제자리 갱신."""

    def __init__(self, verdicts: dict[str, Any], *, client: httpx.Client, gemini: Any = None, now: datetime,
                 max_vision_calls: Optional[int] = None) -> None:
        self.verdicts = verdicts
        self.client = client
        self.gemini = gemini
        self.now = now
        self.max_vision_calls = max_vision_calls if max_vision_calls is not None else int(os.getenv("IMAGE_VISION_MAX", "60"))
        self.vision_calls = 0
        self.stats = {"host": 0, "pixel": 0, "vision_reject": 0, "ok": 0, "cached": 0}

    def _record(self, url: str, ok: bool, why: str) -> bool:
        self.verdicts[url] = {"ok": ok, "why": why, "at": self.now.isoformat().replace("+00:00", "Z")}
        return ok

    def allow(self, url: Optional[str]) -> bool:
        if not url:
            return False
        if is_text_card_url(url):
            self.stats["host"] += 1
            return False
        cached = self.verdicts.get(url)
        if _fresh(cached, self.now) and "unverified" not in str(cached.get("why")):
            self.stats["cached"] += 1
            return bool(cached["ok"])
        got = download_image(self.client, url)
        if got is None:
            return self._record(url, False, "download")
        data, mime = got
        verdict, why = pixel_verdict(data)
        if verdict is False:
            self.stats["pixel"] += 1
            return self._record(url, False, why)
        if self.gemini is not None and self.vision_calls < self.max_vision_calls:
            self.vision_calls += 1
            v, vwhy = vision_verdict(self.gemini, data, mime)
            if v is not None:
                self.stats["ok" if v else "vision_reject"] += 1
                return self._record(url, v, f"{why};{vwhy}")
        # 비전 판정을 못 했으면 픽셀상 확실한 사진만 통과 (애매한 건 다음 실행에서 다시 본다)
        ok = verdict is True
        self.stats["ok" if ok else "pixel"] += 1
        return self._record(url, ok, f"{why};unverified")

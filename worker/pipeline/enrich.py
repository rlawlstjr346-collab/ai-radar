"""스냅샷 최종 정제 단계 — 대표 사진(image_url) · 대화체 문장 · 미래 비전(vision_ko) · 동일 사건 묶음.

모든 변경은 하위 호환(Additive-only):
- 새 필드: image_url, easy_summary_ko, vision_ko, related_articles, cluster_size
- 기존 필드는 값만 다듬는다 (hook_title/title_ko 어미를 대화체로, 본문 속 `==` 마커·번역투 제거).

대표 사진 우선순위
1) 수집 단계에서 얻은 thumbnail_url (RSS media:content / enclosure / 본문 첫 이미지)
2) GitHub 레포 → opengraph.githubassets.com 공식 프리뷰
3) 기사 페이지의 og:image / twitter:image (3.5초 타임아웃, 병렬 8, 결과는 메타 파일에 캐시)
아이콘·로고·1x1 픽셀·극단 비율 배너는 헤더 바이트로 크기를 읽어 자동 제외한다.
"""

from __future__ import annotations

import hashlib
import re
import struct
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any, Callable, Optional
from urllib.parse import urljoin, urlsplit

import httpx

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
OG_TIMEOUT = httpx.Timeout(3.5, connect=3.5)
OG_MAX_WORKERS = 8
OG_MAX_FETCH_PER_RUN = 60
OG_HTML_BYTES = 400_000
IMAGE_SNIFF_BYTES = 65_536
IMAGE_CACHE_KEY = "image_cache"
IMAGE_CACHE_HIT_DAYS = 30
IMAGE_CACHE_MISS_DAYS = 3

MIN_IMAGE_W = 320
MIN_IMAGE_H = 160
MAX_ASPECT = 3.2
MIN_ASPECT = 0.5

# 소셜 포스트는 og:image 가 프로필 사진·공통 카드라 기사 사진이 아니다
SKIP_OG_HOSTS = ("x.com", "twitter.com", "bsky.app", "reddit.com", "news.ycombinator.com", "v2ex.com")
BAD_IMAGE_RE = re.compile(
    r"(favicon|apple-touch|/icons?[/_.-]|[-_/]icon[-_.]|logo|sprite|avatar|gravatar|1x1|pixel|spacer|blank\.|"
    r"placeholder|default[-_]?(og|share|image)|emoji|badge|\.svg(?:$|\?)|\.ico(?:$|\?))",
    re.I,
)
GH_REPO_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)")
META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.I)
ATTR_RE = re.compile(r'([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')')
OG_KEYS = ("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src")


# ---------------------------------------------------------------- 대표 사진


def is_plausible_image_url(url: Optional[str]) -> bool:
    if not url or not isinstance(url, str) or not url.startswith("https://"):
        return False
    if len(url) > 1200:
        return False
    return not BAD_IMAGE_RE.search(url)


def github_preview(url: str) -> Optional[str]:
    m = GH_REPO_RE.match(url or "")
    if not m:
        return None
    owner, repo = m.group(1), m.group(2)
    if owner.lower() in {"orgs", "topics", "trending", "features", "about", "sponsors"}:
        return None
    repo = re.sub(r"\.git$", "", repo)
    return f"https://opengraph.githubassets.com/1/{owner}/{repo}"


def extract_og_image(html: str, base_url: str) -> Optional[str]:
    found: dict[str, str] = {}
    for tag in META_TAG_RE.findall(html):
        attrs = {m.group(1).lower(): (m.group(3) if m.group(3) is not None else m.group(4)) for m in ATTR_RE.finditer(tag)}
        key = (attrs.get("property") or attrs.get("name") or "").strip().lower()
        content = (attrs.get("content") or "").strip()
        if key in OG_KEYS and content and key not in found:
            found[key] = unescape(content)
    for key in OG_KEYS:
        if key in found:
            candidate = urljoin(base_url, found[key])
            if candidate.startswith("http://"):
                candidate = "https://" + candidate[len("http://"):]
            return candidate
    return None


def image_dimensions(head: bytes) -> Optional[tuple[int, int]]:
    """PNG / GIF / WebP / JPEG 헤더에서 (w, h). 모르면 None."""
    try:
        if head[:8] == b"\x89PNG\r\n\x1a\n" and len(head) >= 24:
            return struct.unpack(">II", head[16:24])
        if head[:6] in (b"GIF87a", b"GIF89a") and len(head) >= 10:
            return struct.unpack("<HH", head[6:10])
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            chunk = head[12:16]
            if chunk == b"VP8X" and len(head) >= 30:
                w = 1 + int.from_bytes(head[24:27], "little")
                h = 1 + int.from_bytes(head[27:30], "little")
                return w, h
            if chunk == b"VP8 " and len(head) >= 30:
                w, h = struct.unpack("<HH", head[26:30])
                return w & 0x3FFF, h & 0x3FFF
            if chunk == b"VP8L" and len(head) >= 25:
                b = head[21:25]
                w = 1 + (((b[1] & 0x3F) << 8) | b[0])
                h = 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
                return w, h
        if head[:2] == b"\xff\xd8":
            i = 2
            while i + 9 < len(head):
                if head[i] != 0xFF:
                    i += 1
                    continue
                marker = head[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", head[i + 5:i + 9])
                    return w, h
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg_len = struct.unpack(">H", head[i + 2:i + 4])[0]
                i += 2 + seg_len
    except (struct.error, IndexError):
        return None
    return None


def dimensions_ok(dim: Optional[tuple[int, int]]) -> bool:
    if dim is None:
        return True          # 크기를 못 읽은 JPEG(긴 EXIF)는 content-type 검증만으로 통과
    w, h = dim
    if w < MIN_IMAGE_W or h < MIN_IMAGE_H:
        return False
    ratio = w / max(1, h)
    return MIN_ASPECT <= ratio <= MAX_ASPECT


def _read_prefix(resp: httpx.Response, limit: int) -> bytes:
    buf = bytearray()
    for chunk in resp.iter_bytes():
        buf.extend(chunk)
        if len(buf) >= limit:
            break
    return bytes(buf[:limit])


def verify_image(client: httpx.Client, url: str) -> bool:
    """실제로 내려받을 수 있는 충분히 큰 래스터 이미지인지 (헤더 바이트만 읽음)."""
    try:
        with client.stream("GET", url, headers={"Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}) as resp:
            if resp.status_code >= 400:
                return False
            ctype = resp.headers.get("content-type", "").lower()
            if not ctype.startswith("image/") or "svg" in ctype or "icon" in ctype:
                return False
            length = resp.headers.get("content-length")
            if length and length.isdigit() and int(length) < 3_000:
                return False
            return dimensions_ok(image_dimensions(_read_prefix(resp, IMAGE_SNIFF_BYTES)))
    except (httpx.HTTPError, ValueError):
        return False


def find_page_image(client: httpx.Client, page_url: str) -> Optional[str]:
    try:
        with client.stream("GET", page_url, headers={"Accept": "text/html,application/xhtml+xml"}) as resp:
            if resp.status_code >= 400:
                return None
            if "html" not in resp.headers.get("content-type", "").lower():
                return None
            raw = _read_prefix(resp, OG_HTML_BYTES)
            final_url = str(resp.url)
    except (httpx.HTTPError, ValueError):
        return None
    head_end = raw.lower().find(b"</head>")
    html = raw[: head_end if head_end > 0 else len(raw)].decode("utf-8", errors="ignore")
    candidate = extract_og_image(html, final_url)
    if candidate and is_plausible_image_url(candidate) and verify_image(client, candidate):
        return candidate
    return None


def _should_fetch_og(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return not any(host == h or host.endswith("." + h) for h in SKIP_OG_HOSTS)


def _cache_fresh(entry: Any, now: datetime) -> bool:
    if not isinstance(entry, dict):
        return False
    try:
        checked = datetime.fromisoformat(str(entry.get("checked_at", "")).replace("Z", "+00:00"))
    except ValueError:
        return False
    ttl = IMAGE_CACHE_HIT_DAYS if entry.get("image") else IMAGE_CACHE_MISS_DAYS
    return now - checked < timedelta(days=ttl)


def make_image_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": BROWSER_UA, "Accept-Language": "ko,en;q=0.8"},
        timeout=OG_TIMEOUT,
        follow_redirects=True,
    )


def assign_images(
    items: list[dict[str, Any]],
    cache: dict[str, Any],
    *,
    now: datetime,
    client_factory: Callable[[], httpx.Client] = make_image_client,
    fetch_og: bool = True,
    max_fetch: int = OG_MAX_FETCH_PER_RUN,
) -> dict[str, int]:
    """각 아이템에 image_url 을 채운다. cache 는 {canonical_url: {image, checked_at}} 로 제자리 갱신."""
    now_iso = now.isoformat().replace("+00:00", "Z")
    todo: list[dict[str, Any]] = []
    for it in items:
        url = str(it.get("canonical_url") or "")
        thumb = it.get("thumbnail_url")
        if is_plausible_image_url(thumb):
            it["image_url"] = thumb
            continue
        gh = github_preview(url)
        if gh:
            it["image_url"] = gh
            continue
        entry = cache.get(url)
        if _cache_fresh(entry, now):
            it["image_url"] = entry.get("image") or None
            continue
        it["image_url"] = it.get("image_url") if is_plausible_image_url(it.get("image_url")) else None
        if fetch_og and _should_fetch_og(url) and it["image_url"] is None:
            todo.append(it)

    todo = todo[:max_fetch]
    if todo:
        client = client_factory()
        try:
            with ThreadPoolExecutor(max_workers=OG_MAX_WORKERS) as pool:
                results = list(pool.map(lambda it: find_page_image(client, str(it["canonical_url"])), todo))
        finally:
            client.close()
        for it, img in zip(todo, results):
            it["image_url"] = img
            cache[str(it["canonical_url"])] = {"image": img, "checked_at": now_iso}

    # 캐시는 현재 피드에 남은 URL 만 유지 (메타 파일 비대화 방지)
    live_urls = {str(it.get("canonical_url") or "") for it in items}
    for key in [k for k in cache if k not in live_urls]:
        cache.pop(key, None)

    with_image = sum(1 for it in items if it.get("image_url"))
    return {"items": len(items), "with_image": with_image, "fetched": len(todo)}


# ---------------------------------------------------------------- 대화체 정제

MARK_RE = re.compile(r"==")
ACCORDING_RE = re.compile(r"(^|[.!?]\s+)[^.!?,]{0,40}?에 따르면,?\s*")
SPACE_RE = re.compile(r"\s{2,}")

# 문장 끝 어미 → 친근한 대화체 (긴 패턴 먼저)
ENDING_RULES: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(p), r) for p, r in (
        (r"했습니다(?=[.!?…]*$)", "했어요"),
        (r"됐습니다(?=[.!?…]*$)|되었습니다(?=[.!?…]*$)", "됐어요"),
        (r"합니다(?=[.!?…]*$)", "해요"),
        (r"됩니다(?=[.!?…]*$)", "돼요"),
        (r"있습니다(?=[.!?…]*$)", "있어요"),
        (r"없습니다(?=[.!?…]*$)", "없어요"),
        (r"였습니다(?=[.!?…]*$)", "였어요"),
        (r"었습니다(?=[.!?…]*$)", "었어요"),
        (r"았습니다(?=[.!?…]*$)", "았어요"),
        (r"줍니다(?=[.!?…]*$)", "줘요"),
        (r"냅니다(?=[.!?…]*$)", "내요"),
        (r"봅니다(?=[.!?…]*$)", "봐요"),
        (r"(?<=[갔났랐았었였했혔겼렸쳤졌셨켰웠왔됐봤줬])습니다(?=[.!?…]*$)", "어요"),
        (r"했다(?=[.!?…]*$)", "했어요"),
        (r"됐다(?=[.!?…]*$)|되었다(?=[.!?…]*$)", "됐어요"),
        (r"(?<=[가-힣])한다(?=[.!?…]*$)", "해요"),
        (r"(?<=[가-힣])하다(?=[.!?…]*$)", "해요"),
        (r"(?<=[가-힣])된다(?=[.!?…]*$)", "돼요"),
        (r"있다(?=[.!?…]*$)", "있어요"),
        (r"없다(?=[.!?…]*$)", "없어요"),
        (r"않는다(?=[.!?…]*$)", "않아요"),
        (r"였다(?=[.!?…]*$)", "였어요"),
        (r"었다(?=[.!?…]*$)", "었어요"),
        (r"았다(?=[.!?…]*$)", "았어요"),
    )
)
# 명사로 끝나는 헤드라인 (예: "ComfyUI v0.46 새 버전 공개") → 대화체 서술어
NOUN_TAIL_RULES: dict[str, str] = {
    "공개": "공개됐어요", "출시": "출시됐어요", "릴리즈": "릴리즈됐어요", "발표": "발표됐어요", "등장": "등장했어요",
    "도입": "도입했어요", "돌입": "돌입했어요", "확대": "확대했어요", "제소": "제소했어요", "인수": "인수했어요",
    "투자": "투자했어요", "개편": "개편했어요", "선언": "선언했어요", "경고": "경고했어요", "돌파": "돌파했어요",
    "합류": "합류했어요", "추진": "추진해요", "지원": "지원해요", "강화": "강화했어요", "중단": "중단했어요",
    "체결": "체결했어요", "통과": "통과했어요", "달성": "달성했어요", "착수": "착수했어요", "유치": "유치했어요",
}
NOUN_TAIL_RE = re.compile(r"(\S+?)\s*(" + "|".join(NOUN_TAIL_RULES) + r")\s*$")


def _batchim(ch: str) -> bool:
    code = ord(ch) - 0xAC00
    return 0 <= code <= 11171 and code % 28 != 0


# '보입니다(보이다)'처럼 동사 '-이다' 사동·피동형 → '보여요'
VERB_I_STEMS = ("보", "높", "줄", "늘", "먹", "붙", "쌓", "녹", "죽", "속", "끓", "움직", "기울", "숙", "덮", "돋", "꾸", "누", "드")
VERB_IPNIDA_RE = re.compile(r"(" + "|".join(VERB_I_STEMS) + r")입니다(?=[.!?…]*$)")


def _vowel_ao(ch: str) -> bool:
    code = ord(ch) - 0xAC00
    return 0 <= code <= 11171 and (code // 28) % 21 in (0, 8)   # ㅏ, ㅗ


def _generic_seumnida(sentence: str) -> str:
    """받침 + '습니다' → 모음조화 '아요'/'어요' (예: 남습니다 → 남아요, 먹습니다 → 먹어요)."""
    m = re.search(r"([가-힣])습니다(?=[.!?…]*$)", sentence)
    if not m or not _batchim(m.group(1)):
        return sentence
    tail = "아요" if _vowel_ao(m.group(1)) else "어요"
    return sentence[: m.end(1)] + tail + sentence[m.end():]


def _ipnida(sentence: str) -> str:
    """'~입니다' / '~이다' → '~이에요' / '~예요' (받침 유무)."""
    if VERB_IPNIDA_RE.search(sentence):
        return VERB_IPNIDA_RE.sub(lambda m: m.group(1) + "여요", sentence, count=1)
    m = re.search(r"([가-힣A-Za-z0-9)\]'\"’”])\s?(?:입니다|이다)(?=[.!?…]*$)", sentence)
    if not m:
        return sentence
    prev = m.group(1)
    tail = "이에요" if (not re.match(r"[가-힣]", prev) or _batchim(prev)) else "예요"
    return sentence[: m.start(1) + 1] + tail + sentence[m.end():]


def to_conversational(sentence: str) -> str:
    s = sentence.rstrip()
    if not s or s.endswith(("요", "요.", "요!", "요?", "?", "…")):
        return s
    after = _ipnida(s)
    if after != s:
        return after
    for pat, rep in ENDING_RULES:
        new = pat.sub(rep, s, count=1)
        if new != s:
            return new
    return _generic_seumnida(s)


# 번역 실패 시 붙는 임시 접미사 — 다음 수집 때 재번역되도록 대화체로 바꾸지 않는다
FALLBACK_SUFFIX_PHRASES = (
    "새 AI 모델·기능 업데이트", "개발자 도구·오픈소스 공개", "AI 이미지·디자인 모델 공개", "AI 영상·음성 모델 업데이트",
    "신규 AI 연구·벤치마크 발표", "글로벌 AI 업계 주요 발표", "글로벌 AI 빌더 실시간 공유", "AI 주요 업데이트",
)
FALLBACK_SUFFIX_RE = re.compile(r"\s—\s(?:" + "|".join(re.escape(x) for x in FALLBACK_SUFFIX_PHRASES) + r")(?:됐어요|했어요)?$")


def conversational_title(title: str) -> str:
    t = clean_text(title)
    t = re.sub(r"(" + "|".join(VERB_I_STEMS) + r")예요$", r"\1여요", t)
    t = re.sub(r"(?<=[가-힣])실전 가이드$", "하는 법", t)          # '수행실전 가이드' 붙어쓰기 복구   # 이전 규칙의 '선보예요' 오변환 복구
    if FALLBACK_SUFFIX_RE.search(t):
        return FALLBACK_SUFFIX_RE.sub(lambda m: m.group(0).removesuffix("됐어요").removesuffix("했어요"), t)
    if not t or t.endswith(("요", "?", "!", "…", '"', "”", "'", "’")):
        return t
    converted = to_conversational(t)
    if converted != t:
        return converted
    m = NOUN_TAIL_RE.search(t)
    if m and len(t) <= 80:
        return t[: m.start(2)].rstrip() + " " + NOUN_TAIL_RULES[m.group(2)]
    return t


def clean_text(text: Any) -> str:
    s = MARK_RE.sub("", str(text or ""))
    s = ACCORDING_RE.sub(lambda m: m.group(1), s)
    return SPACE_RE.sub(" ", s).strip()


SENT_SPLIT_RE = re.compile(r"(?<=[.!?。])\s+|(?<=요)\s+(?=[A-Z가-힣\"'“])")


def conversational_paragraph(text: Any) -> str:
    s = clean_text(text)
    if not s:
        return ""
    parts = [p.strip() for p in SENT_SPLIT_RE.split(s) if p.strip()]
    out = []
    for p in parts:
        tail = p[-1] if p[-1] in ".!?" else ""
        body = p[:-1] if tail else p
        conv = to_conversational(body)
        out.append(conv + (tail or ("." if conv.endswith("요") else "")))
    return " ".join(out)


def _first_sentences(text: str, limit: int, max_sentences: int) -> str:
    parts = [p.strip() for p in SENT_SPLIT_RE.split(text) if p.strip()]
    out: list[str] = []
    total = 0
    for p in parts:
        if out and (total + len(p) > limit or len(out) >= max_sentences):
            break
        out.append(p)
        total += len(p)
    joined = " ".join(out)
    if len(joined) > limit + 40:
        joined = joined[:limit].rsplit(" ", 1)[0].rstrip(",·…") + "…"
    return joined


SUBJECT_GENERIC = {"ai", "llm", "gpt", "github", "x", "openai", "google", "meta", "microsoft", "apple"}


def _subject(item: dict[str, Any]) -> str:
    ents = [e for e in item.get("entities") or [] if isinstance(e, dict) and e.get("name")]
    for kind in ("model", "tool", "company"):
        for e in ents:
            if e.get("kind") == kind and str(e["name"]).lower() not in SUBJECT_GENERIC:
                return str(e["name"])
    return ""


# 큐레이터 폴백 템플릿·상투구 — 기사 내용과 무관하게 반복되는 문장은 요약에서 제외한다
STOCK_PHRASE_RE = re.compile(
    r"(가 전한 '|에서 '.{0,120}' (?:구현 방식|이미지·디자인|멀티모달|연구 결과)|커뮤니티에서 '.{0,120}'를 둘러싼|"
    r"를 공개하며 대화형 AI의 실사용 품질|생태계 지형|벤더 전략|원가 점검|방향 변화가 뚜렷|업계 시그널|"
    r"도입 여부를 빠르게 가늠|기술 로드맵에 도움|기획 통찰이 선명|한발 앞서 잡을 수|업그레이드 시점을 판단|"
    r"안정화 패치와 신규 기능을 바로|실무 효율이 빨라져|요금 조건을 먼저 살펴|파이프라인에 바로 참고|"
    r"차세대 모델 성능과 추론 효율의 새 기준|X에서 직접 공유한|빌더 스레드 반응|오픈소스 개발자들의 주목|"
    r"다음과 같아요|정리하면|요약하자면|이처럼 원문은|원문 흐름|원문 링크|핵심 소식이에요|실시간 속보예요|"
    r"최신 시그널이에요|신규 런칭·실전 프로젝트예요|에 오신 것을 환영|구독|subscribe|^원문(?:에서는|은|이|의)\s|"
    r"구체적인 맥락으로 설명|중심으로 서술|비교 지점|짧은 헤드라인만 보면|차근차근 풀어|생태계 흐름 속에서|"
    r"제기된 업데이트예요|실무나 서비스 기획 관점|실제로 적용해 보고 싶다면|기획·벤치마킹 관점)",
    re.I,
)
# 기술 블로그 목차·번호 나열 찌꺼기 (예: '0x00', '0.1 원본 논문 0.2', '1. 2. 3.')
TOC_NOISE_RE = re.compile(r"(\b0x[0-9a-f]{2}\b|(?:\b\d+\.\d+\b.{0,24}){2,}|(?:^|\s)(?:\d+\.\s*){3,}|목차|#{2,}|\|\s*---)", re.I)
GLUED_SENTENCE_RE = re.compile(r"([.!?])(?=[가-힣A-Z\"'“(])")
BODY_PREFIX_RE = re.compile(r"^.*?(?:다음과 같아요|담겨 있어요)\.\s*")


def _norm(text: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", text.lower())


def _echoes_title(sentence: str, title: str) -> bool:
    a, b = _norm(sentence), _norm(title)
    if not a or not b:
        return False
    if a in b or (b in a and len(a) < len(b) + 20) or a[:16] == b[:16]:
        return True
    ta = set(TOKEN_RE.findall(sentence.lower()))
    tb = set(TOKEN_RE.findall(title.lower()))
    return bool(ta) and len(ta & tb) / len(ta) >= 0.8


def _body_candidates(item: dict[str, Any]) -> list[str]:
    """what_ko → easy_original 의 원문 본문 단락 순으로 실제 사실 문장 후보를 모은다."""
    texts = [str(item.get("what_ko") or "")]
    easy = item.get("easy_original") if isinstance(item.get("easy_original"), dict) else {}
    for sec in easy.get("sections") or []:
        if isinstance(sec, dict) and re.search(r"상세|핵심 내용", str(sec.get("heading") or "")):
            texts.append(BODY_PREFIX_RE.sub("", str(sec.get("body") or ""), count=1))
    out: list[str] = []
    for t in texts:
        t = GLUED_SENTENCE_RE.sub(r"\1 ", clean_text(t)).replace("핵심 변경점:", "").strip()
        out.extend(p.strip() for p in SENT_SPLIT_RE.split(t) if p.strip())
    return out


def is_clean_fact(sentence: str, title: str) -> bool:
    s = sentence.strip()
    if len(s) < 12 or len(s) > 220:
        return False
    if STOCK_PHRASE_RE.search(s) or TOC_NOISE_RE.search(s):
        return False
    if s.endswith(("…", "...", ":")) or s.count("'") % 2 or s.count('"') % 2 or s.count("“") != s.count("”"):
        return False
    if re.search(r"[\u4e00-\u9fff\u3040-\u30ff]", s):
        return False
    return not _echoes_title(s, title)


def summary_candidates(item: dict[str, Any]) -> list[str]:
    """원문 본문에서 고른 깨끗한 사실 문장 후보(대화체 변환 완료)."""
    title = str(item.get("hook_title") or item.get("title_ko") or "")
    out: list[str] = []
    seen: set[str] = set()
    for sent in _body_candidates(item):
        key = _norm(sent)[:40]
        if key in seen or not is_clean_fact(sent, title):
            continue
        seen.add(key)
        conv = to_conversational(sent.rstrip(".!? "))
        if STOCK_PHRASE_RE.search(conv):
            continue                                   # 변환 뒤에야 드러나는 미완결 서두('~다음과 같아요')
        if conv.endswith("요"):                        # 대화체로 자연스럽게 떨어지는 문장만
            out.append(conv + ".")
    return out


BOILERPLATE_MIN_ITEMS = 3


def easy_summary(item: dict[str, Any], boilerplate: frozenset[str] = frozenset()) -> str:
    """핵심 사실 1~2문장. 여러 기사에 반복되는 문장(boilerplate)·상투구·목차·제목 반복뿐이면 빈 문자열."""
    picked: list[str] = []
    for sent in summary_candidates(item):
        if _norm(sent)[:40] in boilerplate:
            continue
        picked.append(sent)
        if len(picked) == 2 or sum(len(x) for x in picked) > 150:
            break
    return " ".join(picked)


def find_boilerplate(items: list[dict[str, Any]]) -> frozenset[str]:
    """3개 이상 기사에 똑같이 나오는 문장은 기사 내용이 아니라 생성 템플릿이다."""
    counts: dict[str, int] = {}
    for it in items:
        for key in {_norm(s)[:40] for s in summary_candidates(it)}:
            counts[key] = counts.get(key, 0) + 1
    return frozenset(k for k, n in counts.items() if n >= BOILERPLATE_MIN_ITEMS)


# 미래 비전 — 어려운 한자어(벤더·원가·생태계 지형 등) 없이 일상·업무 변화로. 기사마다 문장이 겹치지 않게 변형을 고른다
VISION_BY_SIGNAL: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "model_release": (
        ("더 똑똑한 AI를 더 싸게, 매일 쓰는 앱 안에서 바로 쓰게 될 거예요",
         "번역·요약·글쓰기처럼 손이 많이 가던 일을 AI가 더 정확하게 대신해 줄 거예요",
         "휴대폰과 노트북에서도 지금보다 빠르고 똑똑한 AI 비서를 쓰게 될 거예요"),
        ("지금 쓰는 도구보다 무엇을 더 잘하는지", "무료로 어디까지 써 볼 수 있는지", "답이 얼마나 빨라지고 정확해지는지"),
    ),
    "industry_shift": (
        ("AI가 회사에서 일하는 방식과 우리가 내는 서비스 요금까지 바꿔 놓을 수 있어요",
         "AI를 둘러싼 규칙과 약속이 바뀌면서 우리가 쓰는 서비스의 모습도 달라질 거예요",
         "큰 회사들의 선택에 따라 내가 쓰는 AI 서비스의 가격과 기능이 달라질 수 있어요"),
        ("내 일과 내가 쓰는 서비스에 어떤 변화가 생기는지", "요금이나 이용 규칙이 바뀌는지", "비슷한 서비스들이 어떻게 따라 움직이는지"),
    ),
    "new_product": (
        ("전문가만 하던 일을 누구나 몇 번의 클릭으로 해내는 날이 가까워져요",
         "반복되는 귀찮은 일을 버튼 하나로 맡기는 게 자연스러워질 거예요",
         "혼자서도 작은 팀만큼 일을 해내는 사람이 늘어날 거예요"),
        ("실제로 써 봤을 때 시간을 얼마나 아껴 주는지", "무료로 어디까지 쓸 수 있는지", "내 일에 바로 붙여 쓸 수 있는지"),
    ),
    "research_breakthrough": (
        ("지금은 연구 단계지만, 몇 년 안에 우리가 쓰는 AI의 실력이 한 단계 올라가요",
         "이런 연구가 쌓이면 AI가 실수를 덜 하고 더 어려운 문제도 풀게 될 거예요",
         "연구실의 아이디어가 곧 우리가 쓰는 앱의 새 기능으로 들어올 거예요"),
        ("이 연구가 언제 실제 제품에 들어올지", "무엇이 아직 안 되는지", "어떤 일에 먼저 쓰이게 될지"),
    ),
    "builder_signal": (
        ("개발자들이 먼저 써 보는 방식이라, 곧 많은 서비스의 기본 기능이 될 가능성이 커요",
         "개인이 만든 작은 실험이 몇 달 뒤 큰 서비스의 기능으로 이어지는 경우가 많아요",
         "사람들의 반응이 좋으면 비슷한 기능이 여러 앱에 빠르게 퍼질 거예요"),
        ("사람들이 무엇을 반기고 무엇을 불편해하는지", "직접 따라 해 볼 수 있는지", "어떤 문제를 풀려고 만든 건지"),
    ),
    "open_source_trend": (
        ("누구나 무료로 가져다 쓸 수 있어서, 큰 회사가 아니어도 비슷한 AI 서비스를 직접 만들 수 있게 돼요",
         "공개된 도구가 늘수록 비싼 서비스 없이도 내 컴퓨터에서 AI를 돌리는 일이 쉬워져요",
         "개발자들이 함께 고쳐 나가는 도구라 빠르게 좋아지고 쓰는 사람도 늘어날 거예요"),
        ("설치가 얼마나 쉬운지", "내 컴퓨터에서도 돌아가는지", "누가 얼마나 활발하게 고치고 있는지"),
    ),
    "dev_workflow": (
        ("코딩과 반복 업무를 AI에게 맡기는 게 자연스러워져서, 사람은 아이디어와 판단에 더 집중하게 돼요",
         "코드를 쓰고 고치는 시간이 줄어 작은 팀도 더 많은 걸 만들 수 있게 될 거예요",
         "AI와 함께 일하는 방식이 개발자의 기본 업무 습관이 될 거예요"),
        ("내 업무 중 어떤 단계를 바로 AI에게 넘길 수 있는지", "실수했을 때 어떻게 바로잡는지", "기존 도구와 함께 쓸 수 있는지"),
    ),
}


def _variant(item: dict[str, Any], n: int, salt: str) -> int:
    return int(hashlib.md5(f"{salt}:{item.get('id')}".encode()).hexdigest(), 16) % n


def vision_text(item: dict[str, Any]) -> str:
    pm = item.get("planning_meta") if isinstance(item.get("planning_meta"), dict) else {}
    futures, watches = VISION_BY_SIGNAL.get(str(pm.get("signal_type") or ""), VISION_BY_SIGNAL["industry_shift"])
    future = futures[_variant(item, len(futures), "f")]
    watch = watches[_variant(item, len(watches), "w")]
    subject = _subject(item)
    lead = f"{subject} 소식처럼 이런 변화가 이어지면, " if subject and len(subject) <= 24 else "이런 변화가 이어지면, "
    return f"{lead}앞으로 {future}. 우리는 {watch}에 주목해 볼 수 있어요."


# ---------------------------------------------------------------- 동일 사건 묶음

CLUSTER_WINDOW = timedelta(hours=36)
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9.+-]{2,}|[가-힣]{2,}|\d+(?:\.\d+)+")
STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "new", "now", "how", "what", "why", "you", "your",
    "are", "its", "into", "about", "using", "via", "will", "can", "has", "have", "our", "release", "released",
    "새", "버전", "공개", "출시", "소식", "발표", "이야기", "기록", "가이드", "실전", "있어요", "했어요", "됐어요",
}
GENERIC_ENTITIES = {
    "ai", "llm", "github", "x", "openai", "google", "anthropic", "meta", "microsoft", "apple", "nvidia",
    "claude", "gemini", "gpt", "chatgpt", "hugging face", "huggingface", "deepseek", "qwen",
}


def _parse_dt(raw: Any) -> Optional[datetime]:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _tokens(item: dict[str, Any]) -> set[str]:
    blob = f"{item.get('original_title') or ''} {item.get('title_ko') or ''}"
    return {t.lower() for t in TOKEN_RE.findall(blob) if t.lower() not in STOPWORDS}


def _specific_entities(item: dict[str, Any]) -> set[str]:
    out = set()
    for e in item.get("entities") or []:
        name = str(e.get("name") if isinstance(e, dict) else e or "").strip().lower()
        if name and name not in GENERIC_ENTITIES and len(name) >= 3:
            out.add(name)
    return out


def same_story(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if a.get("platform_id") == b.get("platform_id") and a.get("platform_id") not in {"x", "hacker-news"}:
        return False                       # 같은 매체의 연속 글은 묶지 않는다
    da = _parse_dt(a.get("published_at")) or _parse_dt(a.get("created_at"))
    db = _parse_dt(b.get("published_at")) or _parse_dt(b.get("created_at"))
    if not da or not db or abs(da - db) > CLUSTER_WINDOW:
        return False
    ta, tb = _tokens(a), _tokens(b)
    inter = len(ta & tb)
    jac = inter / max(1, len(ta | tb))
    shared = _specific_entities(a) & _specific_entities(b)
    if jac >= 0.5 and inter >= 3:
        return True
    if shared and jac >= 0.2 and inter >= 2:
        return True
    return len(shared) >= 2 and inter >= 1


def assign_clusters(items: list[dict[str, Any]]) -> int:
    """union-find 로 동일 사건을 묶고 related_articles / cluster_size 를 채운다. 묶인 그룹 수 반환."""
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if same_story(items[i], items[j]):
                parent[find(i)] = find(j)

    groups: dict[int, list[int]] = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(i)

    multi = 0
    for members in groups.values():
        if len(members) > 1:
            multi += 1
        for i in members:
            it = items[i]
            it["related_articles"] = [
                {
                    "id": items[j].get("id"),
                    "title_ko": items[j].get("hook_title") or items[j].get("title_ko"),
                    "platform_id": items[j].get("platform_id"),
                    "canonical_url": items[j].get("canonical_url"),
                    "published_at": items[j].get("published_at"),
                }
                for j in members
                if j != i
            ]
            platforms = {str(items[j].get("platform_id")) for j in members}
            platforms.update(str(p) for p in it.get("source_platforms") or [])
            it["cluster_size"] = max(len(members), len(platforms))
    return multi


# ---------------------------------------------------------------- 진입점


def enrich_snapshot_items(
    items: list[dict[str, Any]],
    *,
    image_cache: dict[str, Any],
    now: Optional[datetime] = None,
    fetch_og: bool = True,
    client_factory: Callable[[], httpx.Client] = make_image_client,
) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    for it in items:
        for key in ("hook_title", "title_ko"):
            if it.get(key):
                it[key] = conversational_title(str(it[key]))
        for key in ("what_ko", "why_ko", "context_ko"):
            if it.get(key):
                it[key] = conversational_paragraph(it[key])
        it["vision_ko"] = vision_text(it)
    boilerplate = find_boilerplate(items)
    for it in items:
        it["easy_summary_ko"] = easy_summary(it, boilerplate)
    stats = assign_images(items, image_cache, now=now, client_factory=client_factory, fetch_og=fetch_og)
    stats["clusters"] = assign_clusters(items)
    return stats

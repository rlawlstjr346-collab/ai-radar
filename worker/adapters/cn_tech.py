"""중국 AI·인디빌더 5대 핵심 소스 0원 자동 수집 어댑터 (홈서버·유료 API 없이 GitHub Actions 단독 동작).

대상 5대 소스 (소스별 timeout 6초 + 브라우저 헤더 + 다중 폴백 + 개별 장애 완전 격리):
1. QbitAI · 양자위 (qbitai)       — 공식 RSS → Google News CN RSS 폴백
2. Synced · 기기지심 (jiqizhixin)  — 공식 RSS(XML 시) → Google News CN(机器之心) RSS → Synced 영문 RSS 폴백
3. 36Kr AI (36kr-ai)              — 공식 36Kr AI 트랙 JSON API + 실시간 쾌보(AI 필터) → RSS 폴백
4. V2EX · 인디빌더 (v2ex)          — 공식 무료 JSON API (node=create 창작/런칭 + node=ai/aigc/claude/openai)
5. Juejin · 굴진 (juejin)          — 공식 무료 추천/AI 카테고리 JSON API (최신+추천) → AI 핫랭크 JSON 폴백

순도 필터:
- 연예·부동산·단순 주가·전기차 가십·채용 광고·중고거래 100% 차단
- AI 모델·오픈소스(开源)·에이전트·로컬 LLM·신규 웹/앱/확장프로그램 런칭(独立开发/GitHub/데모)만 통과
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import feedparser
import httpx

from adapters.base import BaseAdapter, parse_dt
from collector.classify import classify_news
from collector.models import RawItem, SourceConfig
from collector.normalize import strip_html
from pipeline.curator import is_blocked_noise

log = logging.getLogger("ai_radar.cn_tech")

CN_TIMEOUT = httpx.Timeout(6.0, connect=4.0)
CN_LOOKBACK_DAYS = 14
MAX_ITEMS_PER_SOURCE = 12

CN_BROWSER_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# ── 엄격한 노이즈 차단 (연예·부동산·단순 주가·전기차 가십·채용·광고·중고거래 100% 차단) ──
CN_BLOCKED_NOISE_RE = re.compile(
    r"(娱乐|明星|八卦|综艺|电影票房|演唱会|离婚|绯闻|热搜榜|"
    r"房产|楼市|买房|租房|房价|物业费|二手房|学区房|"
    r"A股|涨停|跌停|炒股|基金定投|理财产品|黄金价格|茅台|白酒|"
    r"招聘|内推|求职|社招|校招|高薪诚聘|猎头|面试经验|裁员赔偿|跳槽|"
    r"出闲置|二手转让|卖号|拼车|拼团|优惠券|代购|推广广告|办信用卡|宽带推荐|求推荐手机|"
    r"电动车销量|新能源车销量|汽车销量|蔚来销量|小鹏销量|理想汽车销量|比亚迪销量|小米汽车交付|特斯拉降价|车展新车)",
    re.I,
)

# ── 핵심 AI·모델·오픈소스·연구·하드웨어 시그널 ─────────────────────────────────
CN_AI_SIGNAL_RE = re.compile(
    r"(\bAI\b|AIGC|\bLLM\b|大模型|大语言模型|语言模型|多模态|智能体|\bAgents?\b|Agentic|"
    r"开源模型|开源|推理引擎|推理模型|算力|端侧大模型|本地部署|本地\s*LLM|"
    r"Qwen|通义千问|千问|DeepSeek|深度求索|Kimi|月之暗面|GLM|智谱|MiniMax|海螺|"
    r"豆包|ByteDance\s*Seed|混元|Hunyuan|文心|ERNIE|百川|零一万物|阶跃星辰|StepFun|"
    r"OpenAI|ChatGPT|GPT-?\d|Claude|Anthropic|Gemini|DeepMind|Llama|Mistral|Grok|Sora|Kling|可灵|"
    r"Cursor|Windsurf|Codex|\bMCP\b|\bRAG\b|vLLM|Ollama|ComfyUI|Diffusers|FLUX|LoRA|"
    r"具身智能|人形机器人|机器人模型|自动驾驶.*(?:大模型|AI|端到端)|"
    r"微调|蒸馏|量化|注意力机制|FlashAttention|Transformer|MoE|Diffusion|Token|arXiv|论文|基准测试|Benchmark|"
    r"NVIDIA|英伟达|GPU|NPU|AI芯片|算力集群|人工智能|机器学习|深度学习|神经网络|提示词|Prompt|Vibe\s*Coding)",
    re.I,
)

# ── 신생·1인 개발자 런칭 시그널 (V2EX / Juejin 기획 자판기 핵심 재료) ─────────
CN_BUILDER_LAUNCH_RE = re.compile(
    r"(独立开发|开源|开源了|发布了|上线了|做了个|写了个|开发了一个|自研|副业项目|个人项目|"
    r"Chrome\s*插件|浏览器扩展|浏览器插件|VS\s*Code\s*插件|CLI\s*工具|桌面客户端|"
    r"Web\s*应用|SaaS|App\s*上线|小程序|效率工具|自动化工具|工作流|Workflow|"
    r"github\.com/|huggingface\.co/|demo|在线体验|免费开源|MIT\s*协议|Apache\s*2\.0)",
    re.I,
)

# ── 제품·데모·코드 실체 신호 (단순 잡담/질문 배제용) ────────────────────────────
CN_PRODUCT_SUBSTANCE_RE = re.compile(
    r"(github\.com/|gitlab\.com/|huggingface\.co/|https?://[a-z0-9.-]+\.[a-z]{2,}|"
    r"开源|插件|扩展|工具|App|Web|SaaS|客户端|API|SDK|CLI|MCP|Agent|AI|LLM|大模型|机器人|自动化|部署)",
    re.I,
)

# 초강력 AI 핵심 모델명 (노이즈 단어가 우연히 섞여도 AI 속보면 예외 통과)
CN_CORE_AI_OVERRIDE_RE = re.compile(
    r"(DeepSeek|Qwen|通义千问|Kimi|GLM|智谱|OpenAI|Anthropic|Claude|Gemini|大模型|大语言模型|开源模型|智能体|MCP)",
    re.I,
)


def is_cn_ai_builder_relevant(title: str, body: str = "", *, kind: str = "media") -> bool:
    """중국 AI 속보 매체(media) 및 1인 개발자 런칭 포럼(v2ex/juejin) 엄격 순도 필터."""
    title_s = (title or "").strip()
    body_s = (body or "")[:1200]
    hay = f"{title_s} {body_s}"
    if not title_s or len(title_s) < 6:
        return False
    if is_blocked_noise(title_s, body_s):
        return False
    if CN_BLOCKED_NOISE_RE.search(title_s) and not CN_CORE_AI_OVERRIDE_RE.search(title_s):
        return False
    if CN_BLOCKED_NOISE_RE.search(body_s[:400]) and not CN_CORE_AI_OVERRIDE_RE.search(title_s):
        return False

    if kind == "v2ex":
        # V2EX: AI 관련이거나, 명확한 1인 개발/오픈소스/신규 웹·앱·확장프로그램 런칭(링크·실체 포함)
        if CN_AI_SIGNAL_RE.search(title_s):
            return True
        if CN_BUILDER_LAUNCH_RE.search(title_s) and (
            CN_AI_SIGNAL_RE.search(hay) or CN_PRODUCT_SUBSTANCE_RE.search(hay)
        ):
            return True
        return False

    if kind == "juejin":
        # Juejin: AI·LLM·에이전트·오픈소스·로컬 모델·AI 기반 1인 개발 실전 글만 통과
        if CN_AI_SIGNAL_RE.search(title_s):
            return True
        if CN_BUILDER_LAUNCH_RE.search(title_s) and CN_AI_SIGNAL_RE.search(body_s[:600]):
            return True
        return False

    # media (QbitAI, Synced, 36Kr AI): 명확한 AI/오픈소스/논문/하드웨어 시그널 필수
    return bool(CN_AI_SIGNAL_RE.search(title_s) or CN_AI_SIGNAL_RE.search(body_s[:500]))


def _parse_cn_timestamp(val: Any) -> Optional[datetime]:
    """초/밀리초 epoch 또는 문자열 시각을 UTC datetime 으로 변환."""
    if val is None or val == "":
        return None
    if isinstance(val, (int, float)):
        ts = float(val)
        if ts > 1e12:
            ts /= 1000.0
        if ts > 1e8:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        return None
    if isinstance(val, str) and val.strip().isdigit():
        return _parse_cn_timestamp(int(val.strip()))
    return parse_dt(val)


def _extract_github_or_demo_flags(text: str) -> tuple[bool, bool]:
    low = (text or "").lower()
    has_gh = "github.com/" in low
    has_demo = bool(re.search(r"https?://(?!www\.v2ex\.com|juejin\.cn|36kr\.com|www\.qbitai\.com)\S+", low))
    return has_gh, has_demo


class CNTechAdapter(BaseAdapter):
    """중국 3대 AI 속보 매체(QbitAI·Synced·36Kr AI) + 2대 인디빌더 포럼(V2EX·Juejin) 통합 어댑터."""

    endpoint_markers = (
        "qbitai.com",
        "jiqizhixin.com",
        "syncedreview.com",
        "36kr.com",
        "v2ex.com/api/topics",
        "api.juejin.cn",
    )

    def __init__(self, source: SourceConfig, client: httpx.Client, guard=None) -> None:
        super().__init__(source, client, guard=guard)
        self.skipped: list[str] = []

    def _safe_get(self, url: str, *, headers: Optional[dict[str, str]] = None) -> Optional[httpx.Response]:
        hdrs = dict(CN_BROWSER_HEADERS)
        if headers:
            hdrs.update(headers)
        try:
            resp = self.client.get(url, headers=hdrs, timeout=CN_TIMEOUT)
            if resp.status_code >= 400:
                self.skipped.append(f"{url} -> HTTP {resp.status_code}")
                return None
            return resp
        except Exception as exc:
            self.skipped.append(f"{url} -> {type(exc).__name__}")
            log.debug("cn_tech GET failed (%s): %s", url, exc)
            return None

    def _safe_post(
        self,
        url: str,
        payload: dict[str, Any],
        *,
        headers: Optional[dict[str, str]] = None,
    ) -> Optional[httpx.Response]:
        hdrs = dict(CN_BROWSER_HEADERS)
        hdrs["Content-Type"] = "application/json"
        if headers:
            hdrs.update(headers)
        try:
            resp = self.client.post(url, json=payload, headers=hdrs, timeout=CN_TIMEOUT)
            if resp.status_code >= 400:
                self.skipped.append(f"{url} -> HTTP {resp.status_code}")
                return None
            return resp
        except Exception as exc:
            self.skipped.append(f"{url} -> {type(exc).__name__}")
            log.debug("cn_tech POST failed (%s): %s", url, exc)
            return None

    def fetch(self) -> list[RawItem]:
        pid = self.source.platform_id
        ep = self.source.endpoint
        if pid == "qbitai" or "qbitai.com" in ep:
            return self._fetch_qbitai()
        if pid == "jiqizhixin" or "jiqizhixin.com" in ep or "syncedreview.com" in ep:
            return self._fetch_synced()
        if pid == "36kr-ai" or "36kr.com" in ep:
            return self._fetch_36kr()
        if pid == "v2ex" or "v2ex.com" in ep:
            return self._fetch_v2ex()
        if pid == "juejin" or "juejin.cn" in ep:
            return self._fetch_juejin()
        return []

    def _parse_rss_items(
        self,
        raw_bytes: bytes,
        *,
        cn_source: str,
        kind: str = "media",
        engagement: float = 115.0,
        strip_title_suffix: Optional[str] = None,
    ) -> list[RawItem]:
        text_head = raw_bytes[:300].decode("utf-8", errors="ignore").lstrip().lower()
        if text_head.startswith("<!doctype html") or text_head.startswith("<html"):
            return []
        feed = feedparser.parse(raw_bytes)
        if not feed.entries:
            return []
        cutoff = datetime.now(timezone.utc) - timedelta(days=CN_LOOKBACK_DAYS)
        out: list[RawItem] = []
        seen_urls: set[str] = set()
        for e in feed.entries:
            link = (e.get("link") or "").strip()
            title = (e.get("title") or "").strip()
            if strip_title_suffix and title.endswith(strip_title_suffix):
                title = title[: -len(strip_title_suffix)].strip(" -|")
            if not link or not title or link in seen_urls:
                continue
            pub = (
                parse_dt(e.get("published_parsed"))
                or parse_dt(e.get("published"))
                or parse_dt(e.get("updated_parsed"))
                or parse_dt(e.get("updated"))
            )
            if pub and pub < cutoff:
                continue
            raw_content = (e.get("content") or [{}])[0].get("value") or e.get("summary") or ""
            body = strip_html(raw_content, 4000)
            if not is_cn_ai_builder_relevant(title, body, kind=kind):
                continue
            seen_urls.add(link)
            has_gh, has_demo = _extract_github_or_demo_flags(f"{title} {body}")
            out.append(
                self.item(
                    category=classify_news(title, self.source.default_category),
                    url=link,
                    title=title,
                    body=body,
                    metrics={
                        "feed": "cn_ai_media",
                        "cn_source": cn_source,
                        "has_github": has_gh,
                        "has_demo": has_demo,
                    },
                    engagement=engagement,
                    published_at=pub,
                )
            )
            if len(out) >= MAX_ITEMS_PER_SOURCE:
                break
        return out

    # ── 1. QbitAI · 양자위 (量子位) ───────────────────────────────────────────
    def _fetch_qbitai(self) -> list[RawItem]:
        candidates = (
            "https://www.qbitai.com/feed",
            "https://news.google.com/rss/search?q=%22%E9%87%8F%E5%AD%90%E4%BD%8D%22+AI+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
        )
        for url in candidates:
            resp = self._safe_get(url, headers={"Referer": "https://www.qbitai.com/"})
            if not resp:
                continue
            items = self._parse_rss_items(
                resp.content,
                cn_source="QbitAI",
                kind="media",
                engagement=125.0,
                strip_title_suffix=" - 量子位",
            )
            if items:
                return items
        return []

    # ── 2. Synced · 기기지심 (机器之心) ───────────────────────────────────────
    def _fetch_synced(self) -> list[RawItem]:
        candidates = (
            ("https://www.jiqizhixin.com/rss", " - 机器之心"),
            (
                "https://news.google.com/rss/search?q=%22%E6%9C%BA%E5%99%A8%E4%B9%8B%E5%BF%83%22+AI+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
                " - 机器之心",
            ),
            ("https://syncedreview.com/feed/", None),
        )
        for url, suffix in candidates:
            resp = self._safe_get(url, headers={"Referer": "https://www.jiqizhixin.com/"})
            if not resp:
                continue
            items = self._parse_rss_items(
                resp.content,
                cn_source="Synced",
                kind="media",
                engagement=125.0,
                strip_title_suffix=suffix,
            )
            if items:
                return items
        return []

    # ── 3. 36Kr AI (36氪 AI 트랙 + 실시간 AI 쾌보) ───────────────────────────
    def _fetch_36kr(self) -> list[RawItem]:
        now_ms = int(time.time() * 1000)
        cutoff = datetime.now(timezone.utc) - timedelta(days=CN_LOOKBACK_DAYS)
        out: list[RawItem] = []
        seen_urls: set[str] = set()
        kr_headers = {"Referer": "https://36kr.com/information/AI/", "Origin": "https://36kr.com"}

        # Primary 1: 공식 36Kr AI 트랙 피드 API
        resp = self._safe_post(
            "https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow",
            {
                "partner_id": "web",
                "timestamp": now_ms,
                "param": {
                    "subnavType": 1,
                    "subnavNick": "AI",
                    "pageSize": 20,
                    "pageEvent": 0,
                    "siteId": 1,
                    "platformId": 2,
                },
            },
            headers=kr_headers,
        )
        if resp is not None:
            try:
                rows = ((resp.json().get("data") or {}).get("itemList") or [])
                for row in rows:
                    mat = row.get("templateMaterial") or {}
                    item_id = row.get("itemId") or mat.get("itemId")
                    title = strip_html(str(mat.get("widgetTitle") or ""), 240)
                    summary = strip_html(str(mat.get("summary") or ""), 1500)
                    if not item_id or not title:
                        continue
                    url = f"https://36kr.com/p/{item_id}"
                    if url in seen_urls:
                        continue
                    pub = _parse_cn_timestamp(mat.get("publishTime"))
                    if pub and pub < cutoff:
                        continue
                    if not is_cn_ai_builder_relevant(title, summary, kind="media"):
                        continue
                    seen_urls.add(url)
                    thumb = mat.get("widgetImage")
                    has_gh, has_demo = _extract_github_or_demo_flags(f"{title} {summary}")
                    out.append(
                        self.item(
                            category=classify_news(title, self.source.default_category),
                            url=url,
                            title=title,
                            body=summary,
                            thumbnail_url=thumb if isinstance(thumb, str) and thumb.startswith("https://") else None,
                            metrics={
                                "feed": "cn_ai_media",
                                "cn_source": "36Kr AI",
                                "author_name": str(mat.get("authorName") or ""),
                                "has_github": has_gh,
                                "has_demo": has_demo,
                            },
                            engagement=120.0,
                            published_at=pub,
                        )
                    )
                    if len(out) >= MAX_ITEMS_PER_SOURCE:
                        break
            except Exception as exc:
                self.skipped.append(f"36kr subNav parse -> {type(exc).__name__}")

        # Secondary: 36Kr 실시간 쾌보(newsflash)에서 AI 속보 추가 포착
        if len(out) < MAX_ITEMS_PER_SOURCE:
            resp2 = self._safe_post(
                "https://gateway.36kr.com/api/mis/nav/newsflash/flow",
                {
                    "partner_id": "web",
                    "timestamp": now_ms,
                    "param": {"pageSize": 20, "pageEvent": 0, "siteId": 1, "platformId": 2},
                },
                headers=kr_headers,
            )
            if resp2 is not None:
                try:
                    rows = ((resp2.json().get("data") or {}).get("itemList") or [])
                    for row in rows:
                        mat = row.get("templateMaterial") or {}
                        item_id = row.get("itemId") or mat.get("itemId")
                        title = strip_html(str(mat.get("widgetTitle") or ""), 240)
                        summary = strip_html(str(mat.get("widgetContent") or mat.get("summary") or ""), 1500)
                        if not item_id or not title:
                            continue
                        url = f"https://36kr.com/newsflashes/{item_id}"
                        if url in seen_urls:
                            continue
                        pub = _parse_cn_timestamp(mat.get("publishTime"))
                        if pub and pub < cutoff:
                            continue
                        if not is_cn_ai_builder_relevant(title, summary, kind="media"):
                            continue
                        seen_urls.add(url)
                        out.append(
                            self.item(
                                category=classify_news(title, self.source.default_category),
                                url=url,
                                title=title,
                                body=summary,
                                metrics={"feed": "cn_ai_media", "cn_source": "36Kr AI"},
                                engagement=115.0,
                                published_at=pub,
                            )
                        )
                        if len(out) >= MAX_ITEMS_PER_SOURCE:
                            break
                except Exception as exc:
                    self.skipped.append(f"36kr newsflash parse -> {type(exc).__name__}")

        if out:
            return out

        # Fallback: RSS
        for url in (
            "https://36kr.com/feed",
            "https://news.google.com/rss/search?q=site:36kr.com+AI+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
        ):
            r = self._safe_get(url, headers={"Referer": "https://36kr.com/"})
            if not r:
                continue
            items = self._parse_rss_items(r.content, cn_source="36Kr AI", kind="media", engagement=115.0)
            if items:
                return items
        return []

    # ── 4. V2EX · 인디빌더 (create 창작/런칭 + ai/aigc/claude/openai 노드) ────
    def _fetch_v2ex(self) -> list[RawItem]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=CN_LOOKBACK_DAYS)
        out: list[RawItem] = []
        seen_urls: set[str] = set()
        nodes = ("create", "ai", "aigc", "claude", "openai")
        ai_node_hits = 0

        for node in nodes:
            # ai 노드에서 이미 충분히 가져왔으면 claude/openai 추가 요청 절약
            if node in ("claude", "openai") and ai_node_hits >= 5:
                continue
            url = f"https://www.v2ex.com/api/topics/show.json?node_name={node}"
            resp = self._safe_get(url, headers={"Referer": f"https://www.v2ex.com/go/{node}"})
            if resp is None:
                continue
            try:
                topics = resp.json()
            except Exception as exc:
                self.skipped.append(f"v2ex:{node} json -> {type(exc).__name__}")
                continue
            if not isinstance(topics, list):
                continue

            for t in topics:
                if not isinstance(t, dict):
                    continue
                tid = t.get("id")
                title = strip_html(str(t.get("title") or ""), 240)
                content = strip_html(str(t.get("content") or ""), 2500)
                link = str(t.get("url") or (f"https://www.v2ex.com/t/{tid}" if tid else "")).strip()
                if not link or not title or link in seen_urls:
                    continue
                pub = _parse_cn_timestamp(t.get("created"))
                if pub and pub < cutoff:
                    continue
                if not is_cn_ai_builder_relevant(title, content, kind="v2ex"):
                    continue
                seen_urls.add(link)
                replies = int(t.get("replies") or 0)
                member = (t.get("member") or {}).get("username") if isinstance(t.get("member"), dict) else ""
                has_gh, has_demo = _extract_github_or_demo_flags(f"{title} {content}")
                cat = "dev" if (has_gh or re.search(r"(开源|MCP|CLI|SDK|API|Agent|代码|编码)", f"{title} {content[:300]}", re.I)) else "social"
                out.append(
                    self.item(
                        category=cat,
                        url=link,
                        title=title,
                        body=content,
                        metrics={
                            "feed": "cn_indie_launch",
                            "cn_source": "V2EX",
                            "node_name": node,
                            "replies": replies,
                            "author_name": str(member or ""),
                            "has_github": has_gh,
                            "has_demo": has_demo,
                        },
                        engagement=85.0 + min(120.0, replies * 3.0) + (20.0 if has_gh else 0.0),
                        published_at=pub,
                    )
                )
                if node != "create":
                    ai_node_hits += 1
                if len(out) >= MAX_ITEMS_PER_SOURCE:
                    break
            if len(out) >= MAX_ITEMS_PER_SOURCE:
                break

        out.sort(key=lambda x: x.published_at or cutoff, reverse=True)
        return out[:MAX_ITEMS_PER_SOURCE]

    # ── 5. Juejin · 굴진 (掘金 AI 카테고리 공식 추천·최신 + 핫랭크 폴백) ──────
    def _fetch_juejin(self) -> list[RawItem]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=CN_LOOKBACK_DAYS)
        out: list[RawItem] = []
        seen_urls: set[str] = set()
        jj_headers = {"Referer": "https://juejin.cn/ai", "Origin": "https://juejin.cn"}
        ai_cate_id = "6809637773935378440"

        # Primary: 공식 추천/AI 카테고리 JSON API (sort_type=300 최신 우선 → 200 추천 보강)
        for sort_type in (300, 200):
            if len(out) >= MAX_ITEMS_PER_SOURCE:
                break
            resp = self._safe_post(
                "https://api.juejin.cn/recommend_api/v1/article/recommend_cate_feed",
                {
                    "id_type": 2,
                    "sort_type": sort_type,
                    "cate_id": ai_cate_id,
                    "cursor": "0",
                    "limit": 20,
                },
                headers=jj_headers,
            )
            if resp is None:
                continue
            try:
                rows = resp.json().get("data") or []
            except Exception as exc:
                self.skipped.append(f"juejin sort={sort_type} json -> {type(exc).__name__}")
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                info = row.get("article_info") or {}
                aid = str(row.get("article_id") or info.get("article_id") or "").strip()
                title = strip_html(str(info.get("title") or ""), 240)
                brief = strip_html(str(info.get("brief_content") or ""), 2000)
                if not aid or not title:
                    continue
                url = f"https://juejin.cn/post/{aid}"
                if url in seen_urls:
                    continue
                pub = _parse_cn_timestamp(info.get("ctime") or info.get("rtime"))
                if pub and pub < cutoff:
                    continue
                if not is_cn_ai_builder_relevant(title, brief, kind="juejin"):
                    continue
                seen_urls.add(url)
                digg = int(info.get("digg_count") or 0)
                views = int(info.get("view_count") or 0)
                comments = int(info.get("comment_count") or 0)
                author = ((row.get("author_user_info") or {}).get("user_name") or "") if isinstance(row.get("author_user_info"), dict) else ""
                has_gh, has_demo = _extract_github_or_demo_flags(f"{title} {brief}")
                out.append(
                    self.item(
                        category=classify_news(title, self.source.default_category),
                        url=url,
                        title=title,
                        body=brief,
                        metrics={
                            "feed": "cn_indie_launch" if CN_BUILDER_LAUNCH_RE.search(f"{title} {brief}") else "cn_ai_media",
                            "cn_source": "Juejin",
                            "digg_count": digg,
                            "view_count": views,
                            "replies": comments,
                            "author_name": str(author),
                            "has_github": has_gh,
                            "has_demo": has_demo,
                        },
                        engagement=85.0 + min(120.0, digg * 2.5 + comments * 2.0),
                        published_at=pub,
                    )
                )
                if len(out) >= MAX_ITEMS_PER_SOURCE:
                    break

        # Fallback: 공식 Juejin AI 핫랭크 GET API
        if not out:
            resp = self._safe_get(
                f"https://api.juejin.cn/content_api/v1/content/article_rank?category_id={ai_cate_id}&type=hot",
                headers=jj_headers,
            )
            if resp is not None:
                try:
                    rows = resp.json().get("data") or []
                    for row in rows:
                        content = row.get("content") or {}
                        counter = row.get("content_counter") or {}
                        aid = str(content.get("content_id") or "").strip()
                        title = strip_html(str(content.get("title") or ""), 240)
                        brief = strip_html(str(content.get("brief") or ""), 1500)
                        if not aid or not title:
                            continue
                        url = f"https://juejin.cn/post/{aid}"
                        if url in seen_urls or not is_cn_ai_builder_relevant(title, brief, kind="juejin"):
                            continue
                        seen_urls.add(url)
                        pub = _parse_cn_timestamp(content.get("ctime"))
                        digg = int(counter.get("like") or 0)
                        out.append(
                            self.item(
                                category=classify_news(title, self.source.default_category),
                                url=url,
                                title=title,
                                body=brief,
                                metrics={
                                    "feed": "cn_ai_media",
                                    "cn_source": "Juejin",
                                    "digg_count": digg,
                                },
                                engagement=90.0 + min(100.0, digg * 2.0),
                                published_at=pub,
                            )
                        )
                        if len(out) >= MAX_ITEMS_PER_SOURCE:
                            break
                except Exception as exc:
                    self.skipped.append(f"juejin rank json -> {type(exc).__name__}")

        out.sort(key=lambda x: x.published_at or cutoff, reverse=True)
        return out[:MAX_ITEMS_PER_SOURCE]

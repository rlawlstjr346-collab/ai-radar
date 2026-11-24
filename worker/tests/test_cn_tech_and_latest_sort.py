"""중국 AI·인디빌더 5대 핵심 소스(cn_tech) + 무조건 최신순 최우선 정렬 + 100% 한국어 검증 게이트 단위 테스트."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.cn_tech import CNTechAdapter, is_cn_ai_builder_relevant  # noqa: E402
from collector.models import RawItem, SourceConfig  # noqa: E402
from pipeline.merge import group_raw_items  # noqa: E402
from pipeline.snapshot import build_and_save_snapshot  # noqa: E402
from pipeline.translator import ArticleTranslator, contains_untranslated_cjk  # noqa: E402


def _src(pid: str, endpoint: str, method: str = "api", cat: str = "industry") -> SourceConfig:
    return SourceConfig(id=f"s-{pid}", platform_id=pid, name=pid, endpoint=endpoint, method=method, default_category=cat)


def test_cn_strict_ai_and_builder_purity_filter():
    # AI 속보·오픈소스·인디빌더 런칭 통과
    assert is_cn_ai_builder_relevant("DeepSeek发布新一代开源推理大模型，成本直降70%", "", kind="media") is True
    assert is_cn_ai_builder_relevant("Qwen3-32B本地部署实测：消费级显卡每秒80 Token", "", kind="media") is True
    assert is_cn_ai_builder_relevant("独立开发了一个开源AI浏览器插件，支持MCP自动总结网页", "https://github.com/dev/mcp-ext", kind="v2ex") is True
    assert is_cn_ai_builder_relevant("实测Claude Code与Kimi代码生成对比", "支持本地Agent工作流", kind="juejin") is True

    # 연예·부동산·주가·전기차 가십·채용 광고 100% 차단
    assert is_cn_ai_builder_relevant("某明星演唱会热搜八卦引发娱乐圈讨论", "", kind="media") is False
    assert is_cn_ai_builder_relevant("一线城市楼市房价走势与买房租房指南", "", kind="media") is False
    assert is_cn_ai_builder_relevant("A股涨停潮：白酒基金定投理财产品分析", "", kind="media") is False
    assert is_cn_ai_builder_relevant("小米汽车交付量与比亚迪销量月度对比", "", kind="media") is False
    assert is_cn_ai_builder_relevant("[招聘] 上海高薪诚聘前端工程师，支持内推", "", kind="v2ex") is False
    assert is_cn_ai_builder_relevant("出闲置二手转让一台显示器", "", kind="v2ex") is False


def test_cn_tech_adapter_collects_all_5_sources_with_fallbacks():
    now = datetime.now(timezone.utc)
    now_ts = int(now.timestamp())
    now_ms = now_ts * 1000
    rfc_now = now.strftime("%a, %d %b %Y %H:%M:%S +0000")

    qbitai_xml = (
        f"<?xml version='1.0' encoding='UTF-8'?><rss version='2.0'><channel><title>量子位</title>"
        f"<item><title>国产端侧大模型Qwen3-32B开源实测</title><link>https://www.qbitai.com/2026/11/1001.html</link>"
        f"<description>每秒80 Token本地推理加速。</description><pubDate>{rfc_now}</pubDate></item>"
        f"<item><title>某明星演唱会票房破纪录</title><link>https://www.qbitai.com/2026/11/1002.html</link>"
        f"<description>娱乐八卦新闻。</description><pubDate>{rfc_now}</pubDate></item>"
        f"</channel></rss>"
    )
    synced_gnews_xml = (
        f"<?xml version='1.0' encoding='UTF-8'?><rss version='2.0'><channel><title>Google News</title>"
        f"<item><title>DeepSeek与FlashAttention最新推理架构论文解读 - 机器之心</title>"
        f"<link>https://news.google.com/rss/articles/synced-1</link>"
        f"<description>最新AI大模型推理论文。</description><pubDate>{rfc_now}</pubDate></item>"
        f"</channel></rss>"
    )
    kr_json = {
        "code": 0,
        "data": {
            "itemList": [
                {
                    "itemId": 99001,
                    "templateMaterial": {
                        "itemId": 99001,
                        "widgetTitle": "智谱GLM与月之暗面Kimi新一轮Agent开源生态竞争",
                        "summary": "AI大模型多模态推理成本下降。",
                        "publishTime": now_ms,
                        "authorName": "36氪AI",
                    },
                },
                {
                    "itemId": 99002,
                    "templateMaterial": {
                        "itemId": 99002,
                        "widgetTitle": "一线城市楼市二手房交易报告",
                        "summary": "房产市场波动。",
                        "publishTime": now_ms,
                    },
                },
            ]
        },
    }
    v2ex_create = [
        {
            "id": 123456,
            "title": "独立开发并开源了一个本地 AI Agent 浏览器扩展",
            "url": "https://www.v2ex.com/t/123456",
            "content": "支持 Qwen 和 Claude MCP，源码在 https://github.com/indie/ai-ext",
            "created": now_ts - 600,
            "replies": 24,
            "member": {"username": "indie_dev"},
        },
        {
            "id": 123457,
            "title": "出闲置机械键盘一台",
            "url": "https://www.v2ex.com/t/123457",
            "content": "二手转让",
            "created": now_ts - 600,
            "replies": 2,
            "member": {"username": "seller"},
        },
    ]
    juejin_json = {
        "err_no": 0,
        "data": [
            {
                "article_id": "7711297298265800730",
                "article_info": {
                    "article_id": "7711297298265800730",
                    "title": "MCP Code Mode 实测：AI Agent 工具调用省 84% Token",
                    "brief_content": "基于 DeepSeek 与 Claude 实测开源 Agent 工作流。",
                    "ctime": str(now_ts - 900),
                    "digg_count": 48,
                    "view_count": 1200,
                    "comment_count": 11,
                },
                "author_user_info": {"user_name": "ai_builder"},
            }
        ],
    }

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "qbitai.com/feed" in u:
            return httpx.Response(200, text=qbitai_xml)
        if "jiqizhixin.com/rss" in u:
            # 공식 URL이 HTML을 돌려줘도 Google News RSS 폴백으로 자동 복구
            return httpx.Response(200, text="<!DOCTYPE html><html><body>SPA</body></html>")
        if "news.google.com/rss/search" in u:
            return httpx.Response(200, text=synced_gnews_xml)
        if "gateway.36kr.com/api/mis/nav/ifm/subNav/flow" in u:
            return httpx.Response(200, json=kr_json)
        if "gateway.36kr.com/api/mis/nav/newsflash/flow" in u:
            return httpx.Response(200, json={"code": 0, "data": {"itemList": []}})
        if "v2ex.com/api/topics/show.json" in u:
            if "node_name=create" in u:
                return httpx.Response(200, json=v2ex_create)
            if "node_name=ai" in u:
                return httpx.Response(404, json={"status": "error"})
            return httpx.Response(200, json=[])
        if "api.juejin.cn" in u:
            return httpx.Response(200, json=juejin_json)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    qb = CNTechAdapter(_src("qbitai", "https://www.qbitai.com/feed", "rss", "industry"), client).fetch()
    sy = CNTechAdapter(_src("jiqizhixin", "https://www.jiqizhixin.com/rss", "rss", "research"), client).fetch()
    kr = CNTechAdapter(_src("36kr-ai", "https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow", "api", "industry"), client).fetch()
    vx = CNTechAdapter(_src("v2ex", "https://www.v2ex.com/api/topics/show.json?node_name=create", "api", "social"), client).fetch()
    jj = CNTechAdapter(_src("juejin", "https://api.juejin.cn/recommend_api/v1/article/recommend_cate_feed", "api", "dev"), client).fetch()

    assert len(qb) == 1 and "Qwen3" in qb[0].title
    assert len(sy) == 1 and "DeepSeek" in sy[0].title and not sy[0].title.endswith("机器之心")
    assert len(kr) == 1 and "GLM" in kr[0].title
    assert len(vx) == 1 and vx[0].metrics["feed"] == "cn_indie_launch" and vx[0].metrics["has_github"] is True
    assert len(jj) == 1 and "84% Token" in jj[0].title


def test_latest_first_sorting_micro_interleaving_and_100pct_korean_gate(tmp_path: Path):
    now = datetime(2026, 11, 24, 3, 30, 0, tzinfo=timezone.utc)
    snap_path = tmp_path / "live-feed.json"
    planning_path = tmp_path / "data" / "planning-feed.json"
    platforms = {
        "the-verge-ai": {"id": "the-verge-ai", "name": "The Verge AI", "region": "global"},
        "v2ex": {"id": "v2ex", "name": "V2EX · 인디빌더", "region": "cn"},
        "qbitai": {"id": "qbitai", "name": "QbitAI · 양자위", "region": "cn"},
    }

    def fake_tr(text: str) -> str:
        if "独立开发" in text:
            return "로컬 AI 에이전트 Chrome 확장프로그램 오픈소스 공개"
        if "Qwen3" in text:
            return "Qwen3 온디바이스 추론 속도 초당 80토큰 돌파"
        return "AI 에이전트 실전 업데이트 요약 내용입니다."

    raws = [
        # 4시간 전 초고점수 The Verge 기사 — 예전에는 상단을 막았지만 이제 최신 기사 아래로 내려가야 함
        RawItem(
            source_id="s1",
            source_name="The Verge AI",
            platform_id="the-verge-ai",
            category="industry",
            url="https://www.theverge.com/ai/old-high-score",
            title="4시간 전 고점수 빅테크 뉴스",
            body="빅테크 AI 전략 변화 분석입니다.",
            engagement=900.0,
            published_at=now - timedelta(hours=4),
        ),
        # 10분 전 V2EX 중국어 인디빌더 기사 (낮은 점수여도 무조건 1위!)
        RawItem(
            source_id="s2",
            source_name="V2EX",
            platform_id="v2ex",
            category="social",
            url="https://www.v2ex.com/t/999001",
            title="独立开发开源AI浏览器扩展插件",
            body="支持本地Qwen模型与MCP协议。",
            metrics={"feed": "cn_indie_launch", "cn_source": "V2EX", "has_github": True, "replies": 15},
            engagement=80.0,
            published_at=now - timedelta(minutes=10),
        ),
        # 동일 출처(qbitai) 3개 연속(15분, 20분, 25분 전) + 30분 전 the-verge → 3번째 qbitai 만 미세 인터리빙
        RawItem(
            source_id="s3",
            source_name="QbitAI",
            platform_id="qbitai",
            category="industry",
            url="https://www.qbitai.com/2026/11/a1.html",
            title="Qwen3本地推理实测突破80Token",
            body="国产开源大模型端侧推理提速。",
            metrics={"feed": "cn_ai_media", "cn_source": "QbitAI"},
            engagement=100.0,
            published_at=now - timedelta(minutes=15),
        ),
        RawItem(
            source_id="s3",
            source_name="QbitAI",
            platform_id="qbitai",
            category="industry",
            url="https://www.qbitai.com/2026/11/a2.html",
            title="Qwen3多模态开源发布2",
            body="支持图像与语音多模态理解。",
            metrics={"feed": "cn_ai_media", "cn_source": "QbitAI"},
            engagement=100.0,
            published_at=now - timedelta(minutes=20),
        ),
        RawItem(
            source_id="s3",
            source_name="QbitAI",
            platform_id="qbitai",
            category="industry",
            url="https://www.qbitai.com/2026/11/a3.html",
            title="Qwen3推理量化方案3",
            body="显存占用下降一半。",
            metrics={"feed": "cn_ai_media", "cn_source": "QbitAI"},
            engagement=100.0,
            published_at=now - timedelta(minutes=25),
        ),
        RawItem(
            source_id="s1",
            source_name="The Verge AI",
            platform_id="the-verge-ai",
            category="industry",
            url="https://www.theverge.com/ai/recent-30m",
            title="30분 전 신규 에이전트 도구 출시",
            body="개발자용 에이전트 워크플로 업데이트입니다.",
            engagement=90.0,
            published_at=now - timedelta(minutes=30),
        ),
    ]
    cands = list(group_raw_items(raws).values())
    tr = ArticleTranslator(translate_text_fn=fake_tr, anthropic_api_key="", gemini_api_key="", delay_sec=0)
    payload, changed = build_and_save_snapshot(
        snap_path,
        cands,
        platforms=platforms,
        now=now,
        planning_path=planning_path,
        translator=tr,
    )
    assert changed is True
    items = payload["items"]

    # 1) 10분 전 V2EX 기사가 4시간 전 초고점수 The Verge 기사를 누르고 무조건 1위!
    assert items[0]["platform_id"] == "v2ex"
    assert items[-1]["canonical_url"] == "https://theverge.com/ai/old-high-score"

    # 2) 동일 출처(qbitai)가 3연속 붙지 않고 3번째 자리에 다른 출처가 미세 인터리빙됨
    pids = [it["platform_id"] for it in items]
    for i in range(len(pids) - 2):
        assert not (pids[i] == pids[i + 1] == pids[i + 2]), pids

    # 3) 한국어 피드에 중국어 한자·일본어 가나 잔존 0건 + original_title 보존
    for it in items:
        for f in ("hook_title", "title_ko", "context_ko", "what_ko", "why_ko", "highlight_summary"):
            assert not contains_untranslated_cjk(str(it.get(f) or "")), f"{it['id']}.{f}: {it.get(f)}"
        for sec in it["easy_original"]["sections"]:
            assert not contains_untranslated_cjk(sec["heading"])
            assert not contains_untranslated_cjk(sec["body"])
    assert items[0]["original_title"] == "独立开发开源AI浏览器扩展插件"

    # 4) planning-feed.json 에 중국 인디빌더 planning_meta 정교하게 반영
    planning = json.loads(planning_path.read_text(encoding="utf-8"))
    v2ex_sig = next(s for s in planning["signals"] if s["platform_id"] == "v2ex")
    assert v2ex_sig["planning_meta"]["signal_type"] == "open_source_trend"
    assert "중국 인디빌더" in v2ex_sig["planning_meta"]["benchmark_point"]

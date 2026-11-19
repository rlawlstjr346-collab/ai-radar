from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector.normalize import canonicalize_url, make_dedup_key, strip_html  # noqa: E402
from collector.scoring import importance_score, recency_factor  # noqa: E402


@pytest.mark.parametrize("raw, expected", [
    ("https://www.Example.com/post/?utm_source=x&utm_medium=y&id=3&fbclid=abc#frag", "https://example.com/post?id=3"),
    ("http://example.com:443/a//b/", "https://example.com/a/b"),
    ("https://arxiv.org/pdf/2611.01234v3.pdf", "https://arxiv.org/abs/2611.01234"),
    ("https://arxiv.org/html/2611.01234v2", "https://arxiv.org/abs/2611.01234"),
    ("example.com/x?b=2&a=1", "https://example.com/x?a=1&b=2"),
])
def test_canonicalize(raw, expected):
    assert canonicalize_url(raw) == expected


@pytest.mark.parametrize("url, key", [
    ("https://arxiv.org/abs/2611.01234v2", "arxiv:2611.01234"),
    ("https://huggingface.co/papers/2611.01234", "arxiv:2611.01234"),
    ("https://www.alphaxiv.org/abs/2611.01234", "arxiv:2611.01234"),
    ("https://github.com/Ollama/Ollama", "gh:ollama/ollama"),
    ("https://github.com/vllm-project/vllm/tree/main/docs", "gh:vllm-project/vllm"),
    ("https://github.com/ollama/ollama/releases/tag/v0.5.0", "gh:ollama/ollama@v0.5.0"),
])
def test_dedup_key_rules(url, key):
    assert make_dedup_key(url) == key


def test_same_article_with_tracking_params_gets_same_key():
    a = make_dedup_key("https://openai.com/index/foo?utm_source=hn")
    b = make_dedup_key("https://www.openai.com/index/foo/")
    assert a == b and a.startswith("url:")


def test_github_reserved_paths_are_not_repos():
    assert make_dedup_key("https://github.com/topics/llm").startswith("url:")


def test_strip_html():
    assert strip_html("<p>Hello&nbsp;<b>world</b></p><p>Next</p>") == "Hello\xa0world\nNext"


def test_scoring_orders_by_engagement_sources_and_recency():
    now = datetime(2026, 11, 19, tzinfo=timezone.utc)
    fresh = now - timedelta(hours=1)
    old = now - timedelta(days=10)
    assert importance_score(100, 1, fresh, now) > importance_score(10, 1, fresh, now)
    assert importance_score(50, 2, fresh, now) - importance_score(50, 1, fresh, now) == pytest.approx(6.0)
    assert importance_score(50, 1, fresh, now) > importance_score(50, 1, old, now)
    assert recency_factor(None) == 0.5
    assert importance_score(-5, 0, None, now) >= 0

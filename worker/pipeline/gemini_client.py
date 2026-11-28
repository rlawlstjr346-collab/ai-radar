"""Gemini 호출 공용 클라이언트 — 키 형식(AQ. / AIza)과 엔드포인트를 자동 감지하고 모델 체인으로 폴백한다.

엔드포인트 후보 (앞에서부터 시도, 한 번 실패한 경로는 이번 실행 동안 건너뜀):
- Vertex AI Express (`AQ.` 키일 때만 먼저): aiplatform.googleapis.com …:generateContent?key=
- Gemini API Interactions (3.x 세대 기본): generativelanguage.googleapis.com/v1beta/interactions
- Gemini API generateContent (2.x 세대): generativelanguage.googleapis.com/v1beta/models/{m}:generateContent

키 값은 로그·예외 메시지에 절대 남기지 않는다.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger("ai_radar.gemini")

GENLANG = "https://generativelanguage.googleapis.com/v1beta"
VERTEX = "https://aiplatform.googleapis.com/v1/publishers/google/models"
API_REVISION = "2026-05-20"
DEFAULT_TEXT_MODELS = ("gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite")
DEFAULT_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
RETRYABLE = {429, 500, 502, 503, 504}


class GeminiUnavailable(RuntimeError):
    pass


def _redact(text: str, key: str) -> str:
    return text.replace(key, "***") if key else text


@dataclass
class GeminiClient:
    api_key: str
    models: tuple[str, ...] = DEFAULT_TEXT_MODELS
    client: httpx.Client = field(default_factory=lambda: httpx.Client(timeout=DEFAULT_TIMEOUT))
    dead_routes: set[str] = field(default_factory=set)
    calls: int = 0

    @classmethod
    def from_env(cls) -> Optional["GeminiClient"]:
        key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not key:
            return None
        models = tuple(m.strip() for m in (os.getenv("GEMINI_MODELS") or "").split(",") if m.strip()) or DEFAULT_TEXT_MODELS
        return cls(api_key=key, models=models)

    # ── 요청 경로 ───────────────────────────────────────────────────────
    def _routes(self, model: str) -> list[str]:
        routes = ["interactions", "generate"]
        if self.api_key.startswith("AQ."):
            routes.insert(0, "vertex")                 # Vertex AI Express 키일 수 있어 먼저 시도
        return [r for r in routes if f"{r}:{model}" not in self.dead_routes and r not in self.dead_routes]

    def _post(self, route: str, model: str, parts: list[dict[str, Any]], json_mode: bool) -> str:
        headers = {"Content-Type": "application/json", "x-goog-api-key": self.api_key}
        if route == "interactions":
            body: dict[str, Any] = {"model": model, "input": [
                {"type": "text", "text": p["text"]} if "text" in p else
                {"type": "image", "data": p["data"], "mime_type": p["mime_type"]}
                for p in parts
            ]}
            if json_mode:
                body["response_format"] = {"type": "text", "mime_type": "application/json"}
            resp = self.client.post(f"{GENLANG}/interactions", headers={**headers, "Api-Revision": API_REVISION}, json=body)
        else:
            gparts = [{"text": p["text"]} if "text" in p else {"inline_data": {"mime_type": p["mime_type"], "data": p["data"]}} for p in parts]
            body = {"contents": [{"role": "user", "parts": gparts}]}
            if json_mode:
                body["generationConfig"] = {"responseMimeType": "application/json"}
            url = f"{VERTEX}/{model}:generateContent" if route == "vertex" else f"{GENLANG}/models/{model}:generateContent"
            resp = self.client.post(url, headers=headers, json=body)
        self.calls += 1
        if resp.status_code != 200:
            raise httpx.HTTPStatusError(f"{route} {model} -> {resp.status_code}", request=resp.request, response=resp)
        return _extract_text(resp.json())

    def generate(self, parts: list[dict[str, Any]], *, json_mode: bool = False) -> tuple[str, str]:
        """(텍스트, 사용 모델). 모든 모델·경로가 실패하면 GeminiUnavailable."""
        last = "no route"
        for model in self.models:
            for route in self._routes(model):
                for attempt in range(3):
                    try:
                        return self._post(route, model, parts, json_mode), model
                    except httpx.HTTPStatusError as e:
                        code = e.response.status_code
                        last = f"{route}/{model}: HTTP {code}"
                        if code in RETRYABLE and attempt < 2:
                            time.sleep(4 * (attempt + 1))
                            continue
                        if code == 403 and route == "vertex":
                            self.dead_routes.add("vertex")      # 프로젝트에서 Vertex 미사용 → 이후 전부 건너뜀
                        else:
                            self.dead_routes.add(f"{route}:{model}")
                        break
                    except (httpx.HTTPError, ValueError, KeyError) as e:
                        last = f"{route}/{model}: {type(e).__name__}"
                        self.dead_routes.add(f"{route}:{model}")
                        break
        raise GeminiUnavailable(_redact(last, self.api_key))

    def generate_json(self, prompt: str, image: Optional[tuple[bytes, str]] = None) -> tuple[Any, str]:
        parts: list[dict[str, Any]] = [{"text": prompt}]
        if image is not None:
            parts.append({"data": base64.b64encode(image[0]).decode(), "mime_type": image[1]})
        text, model = self.generate(parts, json_mode=True)
        return parse_json_loose(text), model


def _extract_text(payload: dict[str, Any]) -> str:
    """Interactions(steps/output_text) · generateContent(candidates) 응답 모두에서 마지막 모델 텍스트."""
    inter = payload.get("interaction") if isinstance(payload.get("interaction"), dict) else payload
    if isinstance(inter.get("output_text"), str) and inter["output_text"].strip():
        return inter["output_text"]
    for step in reversed(inter.get("steps") or inter.get("outputs") or []):
        if isinstance(step, dict) and step.get("type") in ("model_output", "text", None):
            texts = [c.get("text", "") for c in step.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"]
            if not texts and isinstance(step.get("text"), str):
                texts = [step["text"]]
            if any(t.strip() for t in texts):
                return "".join(texts)
    for cand in payload.get("candidates") or []:
        parts = (cand.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        if text.strip():
            return text
    raise ValueError("empty model output")


FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.S)


def parse_json_loose(text: str) -> Any:
    t = FENCE_RE.sub("", text.strip())
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start = min((i for i in (t.find("["), t.find("{")) if i >= 0), default=-1)
        end = max(t.rfind("]"), t.rfind("}"))
        if start >= 0 and end > start:
            return json.loads(t[start:end + 1])
        raise ValueError("model did not return JSON")

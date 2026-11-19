"""샘플 원문 2개(어려운 논문 / 크리에이티브 툴)로 요약기를 실제 호출해 결과를 확인한다.

사용법 (worker/ 폴더에서):
    python scripts/run_summarizer_samples.py              # 전체 샘플
    python scripts/run_summarizer_samples.py paper_hard   # 하나만

필요: ANTHROPIC_API_KEY (또는 `ant auth login` 프로필)
DB 에는 쓰지 않는다. 결과는 tests/output/<sample>.json 으로 저장.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WORKER_DIR))


def load_dotenv(path: Path) -> None:
    """ai-radar/.env (gitignore 대상) 의 KEY=VALUE 를 환경변수로. 이미 설정된 값은 덮어쓰지 않음."""
    import os
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(WORKER_DIR.parent / ".env")

from summarizer import Summarizer  # noqa: E402
from summarizer_schema import SummaryInput  # noqa: E402

SAMPLES_DIR = WORKER_DIR / "tests" / "samples"
OUTPUT_DIR = WORKER_DIR / "tests" / "output"

# Haiku 5.5 단가 (USD / 1M tokens, 프롬프트 100K 이하 기준)
PRICE_IN, PRICE_OUT = 0.10, 0.50
PRICE_CACHE_READ, PRICE_CACHE_WRITE = PRICE_IN * 0.1, PRICE_IN * 1.25

DIFFICULTY_LABEL = {1: "🌱 완전입문", 2: "⚡ 교양실전", 3: "🔥 개발심화"}

# 테스트용 기존 용어 사전 (실서비스에선 DB glossary 를 fetch_glossary 로 읽어옴)
DEMO_GLOSSARY = [
    {"term": "lora", "display_name": "LoRA (Low-Rank Adaptation)",
     "easy_def": "거대한 AI 전체를 다시 가르치는 대신, 작은 메모장 한 장만 덧붙여서 새 버릇을 들이는 방법이에요."},
    {"term": "llm", "display_name": "LLM (대규모 언어 모델)",
     "easy_def": "인터넷의 엄청난 글을 읽고 다음에 올 단어를 맞히도록 훈련된, 말 잘하는 AI예요."},
]


def estimate_cost(usage: dict) -> float:
    return (
        usage.get("input_tokens", 0) * PRICE_IN
        + usage.get("output_tokens", 0) * PRICE_OUT
        + usage.get("cache_read_input_tokens", 0) * PRICE_CACHE_READ
        + usage.get("cache_creation_input_tokens", 0) * PRICE_CACHE_WRITE
    ) / 1_000_000


def print_card(name: str, result) -> None:
    o = result.output
    line = "─" * 72
    print(f"\n{line}\n▶ {name}   [{DIFFICULTY_LABEL[o.difficulty]}]   model={result.model}\n{line}")
    print(f"📰 {o.hook_title}\n")
    print(f"[원래는요]\n{o.context_ko}\n")
    print(f"[무슨 일이냐면요]\n{o.what_ko}\n")
    if o.analogy_ko:
        print(f"[쉽게 비유하자면요]\n{o.analogy_ko}\n")
    print(f"[왜 중요할까요?]\n{o.why_ko}\n")
    if o.caveats_ko:
        print(f"[참고할 점]\n{o.caveats_ko}\n")
    if o.terms:
        print("[외계어 사전]")
        for t in o.terms:
            print(f"  · {t.term} → {t.easy}")
        print()
    print("[엔티티] " + ", ".join(f"{e.name}({e.kind}:{'/'.join(e.tags)})" for e in o.extracted_entities))
    print("\n[_fact_sheet]")
    print(json.dumps(o.fact_sheet.model_dump(), ensure_ascii=False, indent=2))
    print(f"\n[warnings] {result.warnings or '없음 ✅'}")
    print(f"[usage] {result.usage}  ≈ ${estimate_cost(result.usage):.5f}")


def main(argv: list[str]) -> int:
    names = argv or sorted(p.stem for p in SAMPLES_DIR.glob("*.json"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summarizer = Summarizer()
    failed = 0

    for name in names:
        raw = json.loads((SAMPLES_DIR / f"{name}.json").read_text(encoding="utf-8"))
        raw.pop("_note", None)
        item = SummaryInput(**raw)
        try:
            result = summarizer.summarize(item, glossary=DEMO_GLOSSARY)
        except Exception as e:  # 샘플 하나 실패해도 나머지는 계속
            failed += 1
            print(f"\n✗ {name}: {type(e).__name__}: {e}")
            continue

        print_card(name, result)
        payload = {
            "llm_output": result.output.model_dump(by_alias=True),
            "summaries_row": result.to_summary_row(item_id="<item-uuid>"),
            "glossary_rows": result.to_glossary_rows(),
            "warnings": result.warnings,
            "usage": result.usage,
            "model": result.model,
            "prompt_version": result.prompt_version,
        }
        (OUTPUT_DIR / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    return 1 if failed else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")   # 윈도우 콘솔(cp949)에서 이모지 출력 깨짐 방지
    raise SystemExit(main(sys.argv[1:]))

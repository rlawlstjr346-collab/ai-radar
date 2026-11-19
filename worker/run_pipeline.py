"""AI Radar 수집·요약 워커 진입점.

    python worker/run_pipeline.py                 # 운영: Supabase 저장 + 상위 N 요약 + TTL 정리
    python worker/run_pipeline.py --dry-run       # 키 없이: 실제 공개 API 수집 → 정규화·중복제거·점수 → 콘솔 출력
    python worker/run_pipeline.py --no-summarize  # 수집만

환경변수 (운영): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY(없으면 요약 생략)
선택: SUMMARY_TOP_N(실행당 신규 요약 상한, 기본 4), DAILY_SUMMARY_CAP(하루 상한, 기본 96)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER_DIR))

from pipeline.runner import DEFAULT_DAILY_CAP, DEFAULT_TOP_N, PipelineReport, run_pipeline  # noqa: E402
from pipeline.store import MemoryStore, SupabaseStore  # noqa: E402


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def print_report(report: PipelineReport, show: int, dry_run: bool) -> None:
    now = datetime.now(timezone.utc)
    print("\n=== 1) 소스별 수집 결과 ===")
    for run in report.sources:
        status = f"✗ {run.error}" if run.error else f"✓ {len(run.items):>3}건"
        print(f"  {run.source.platform_id:<16} {run.source.name:<30} {status}")
        for note in run.notes:
            print(f"  {'':<16} └ 건너뜀: {note}")

    raw_total = sum(len(r.items) for r in report.sources)
    multi = [c for c in report.candidates if c.source_count > 1]
    print(f"\n=== 2) 정규화·중복 제거: 원본 {raw_total}건 → 고유 이슈 {len(report.candidates)}건 "
          f"(여러 소스 동시 등장 {len(multi)}건) ===")
    for c in multi[:8]:
        print(f"  ×{c.source_count} {c.dedup_key:<28} {c.title[:60]}  ← {', '.join(c.source_names)}")
    print(f"  저장: {report.persist}")

    print(f"\n=== 3) 중요도 상위 {show}개 (요약 후보) ===")
    print(f"  {'점수':>6}  {'소스':>3}  {'분야':<8} {'플랫폼':<15} 제목")
    for c in report.candidates[:show]:
        print(f"  {c.score(now):>6.2f}  ×{c.source_count:<2}  {c.category:<8} {c.platform_id:<15} {c.title[:70]}")

    by_cat: dict[str, int] = {}
    for c in report.candidates:
        by_cat[c.category] = by_cat.get(c.category, 0) + 1
    print(f"\n  분야별 고유 이슈 수: {by_cat}")

    print("\n=== 4) 요약 ===")
    if report.summary_skipped_reason:
        print(f"  건너뜀: {report.summary_skipped_reason}")
    print(f"  요약 완료 {len(report.summarized)}건, 실패 {len(report.summary_errors)}건")
    for e in report.summary_errors[:5]:
        print(f"  ✗ {e}")
    print(f"\n=== 5) TTL 정리: {report.lifecycle or '건너뜀'} ===")
    if dry_run:
        print("\n(dry-run: DB 쓰기·LLM 호출 없이 끝났어요)")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="AI Radar collector & summarizer")
    ap.add_argument("--dry-run", action="store_true", help="DB/LLM 없이 실제 수집·정규화·점수까지만")
    ap.add_argument("--no-summarize", action="store_true")
    ap.add_argument("--show", type=int, default=20, help="콘솔에 보여줄 상위 후보 수")
    args = ap.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv(WORKER_DIR.parent / ".env")

    top_n = int(os.getenv("SUMMARY_TOP_N", DEFAULT_TOP_N))
    daily_cap = int(os.getenv("DAILY_SUMMARY_CAP", DEFAULT_DAILY_CAP))

    if args.dry_run:
        store = MemoryStore()
        summarizer = None
    else:
        missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not os.getenv(k)]
        if missing:
            print(f"환경변수 {', '.join(missing)} 가 없어요. 키 없이 확인하려면 --dry-run 으로 실행하세요.")
            return 2
        store = SupabaseStore.from_env()
        summarizer = None
        if not args.no_summarize and os.getenv("ANTHROPIC_API_KEY"):
            from summarizer import Summarizer
            summarizer = Summarizer()

    report = run_pipeline(store, summarizer=summarizer, top_n=top_n, daily_cap=daily_cap,
                          run_lifecycle=not args.dry_run)
    print_report(report, args.show, args.dry_run)

    ok_sources = sum(1 for r in report.sources if not r.error)
    if ok_sources == 0:
        print("\n모든 소스가 실패했어요.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

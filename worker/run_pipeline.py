"""AI Radar 수집·요약 워커 진입점.

    python worker/run_pipeline.py                                    # 운영: Supabase 저장 + 상위 N 요약 + TTL 정리
    python worker/run_pipeline.py --snapshot-json web/public/live-feed.json  # 방생형 무서버: JSON 스냅샷 저장
    python worker/run_pipeline.py --dry-run                          # 키 없이: 실제 공개 API 수집 → 정규화·중복제거·점수 → 콘솔 출력
    python worker/run_pipeline.py --no-summarize                     # 수집만

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

from adapters.base import FeedGuard  # noqa: E402
from pipeline.runner import DEFAULT_DAILY_CAP, DEFAULT_TOP_N, PipelineReport, run_pipeline  # noqa: E402
from pipeline.snapshot import build_and_save_snapshot  # noqa: E402
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
        if run.error:
            status = f"✗ {run.error}"
        elif run.skipped_reason:
            status = f"↷ {run.skipped_reason}"
        else:
            status = f"✓ {len(run.items):>3}건"
        print(f"  {run.source.platform_id:<16} {run.source.name:<30} {status}")
        for note in run.notes:
            print(f"  {'':<16} └ 참고: {note}")

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
    ap.add_argument("--snapshot-json", type=Path, default=None, help="방생형 무서버 JSON 스냅샷 출력 경로 (예: web/public/live-feed.json)")
    ap.add_argument("--meta-json", type=Path, default=None, help="ETag/Last-Modified/Circuit Breaker 메타 파일 경로")
    ap.add_argument("--planning-json", type=Path, default=None, help="하위 AI 기획팀 에이전트용 피드 JSON 출력 경로 (예: web/public/data/planning-feed.json)")
    ap.add_argument("--force-github", action="store_true", help="GitHub 1시간 주기 게이트를 무시하고 즉시 수집")
    ap.add_argument("--no-summarize", action="store_true")
    ap.add_argument("--show", type=int, default=20, help="콘솔에 보여줄 상위 후보 수")
    args = ap.parse_args(argv)

    if args.force_github:
        os.environ["FORCE_GITHUB_COLLECT"] = "1"

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv(WORKER_DIR.parent / ".env")

    top_n = int(os.getenv("SUMMARY_TOP_N", DEFAULT_TOP_N))
    daily_cap = int(os.getenv("DAILY_SUMMARY_CAP", DEFAULT_DAILY_CAP))

    snapshot_mode = args.snapshot_json is not None
    meta_path = args.meta_json
    if meta_path is None and snapshot_mode:
        meta_path = args.snapshot_json.parent / "live-feed-meta.json"
    guard = FeedGuard(meta_path=meta_path) if (meta_path is not None or snapshot_mode) else FeedGuard()

    if args.dry_run or snapshot_mode:
        store = MemoryStore()
        summarizer = None
        if snapshot_mode and not args.no_summarize and os.getenv("ANTHROPIC_API_KEY"):
            from summarizer import Summarizer
            summarizer = Summarizer()
    else:
        missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not os.getenv(k)]
        if missing:
            print(f"환경변수 {', '.join(missing)} 가 없어요. 키 없이 확인하려면 --dry-run 또는 --snapshot-json 으로 실행하세요.")
            return 2
        store = SupabaseStore.from_env()
        summarizer = None
        if not args.no_summarize and os.getenv("ANTHROPIC_API_KEY"):
            from summarizer import Summarizer
            summarizer = Summarizer()

    report = run_pipeline(store, summarizer=summarizer, guard=guard, top_n=top_n, daily_cap=daily_cap,
                          run_lifecycle=not (args.dry_run or snapshot_mode))
    print_report(report, args.show, args.dry_run)

    if snapshot_mode:
        summaries_by_dedup: dict[str, dict] = {}
        if isinstance(store, MemoryStore) and store.summaries:
            id_to_dedup = {row["id"]: dk for dk, row in store.items.items()}
            for item_id, srow in store.summaries.items():
                dk = id_to_dedup.get(item_id)
                if dk:
                    summaries_by_dedup[dk] = srow
        planning_path = args.planning_json or (args.snapshot_json.parent / "data" / "planning-feed.json")
        payload, changed = build_and_save_snapshot(
            args.snapshot_json,
            report.candidates,
            summaries_by_dedup=summaries_by_dedup,
            meta_path=meta_path,
            planning_path=planning_path,
        )
        print(f"\n=== 6) 스냅샷 저장: {args.snapshot_json} ({payload['item_count']}건, changed={changed}) ===")
        print(f"       기획팀 피드: {planning_path}")

    ok_or_skipped = sum(1 for r in report.sources if not r.error)
    if ok_or_skipped == 0:
        print("\n모든 소스가 실패했어요.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

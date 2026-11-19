# AI 레이더 (AI Radar)

전 세계 AI 소식을 입문자도 술술 읽히게 풀어주는 뉴닉풍 요약 웹 + 글로벌 AI 플랫폼 도감.

```
supabase/   DB 스키마(001~004) + 26개 플랫폼(7개 카테고리)·13개 수집 소스 시드
worker/     수집 어댑터 · 중복 제거 · 점수 · 뉴닉 톤 요약기(Claude Haiku 5.5) · 유입/퇴장 수문
web/        Next.js 화면 (라이브 피드 / 지난 주요 소식 / 플랫폼 도감 / 1분 요약 ↔ 원본 쉽게 읽기 / 검색 / 공유 링크 / 툴팁 / 바텀시트)
.github/    1시간마다 자동 수집하는 GitHub Actions (실행당 신규 요약 최대 4개, 플랫폼당 2개)
```

## 지금 바로 보기 (키 없이)

```powershell
cd web
npm.cmd install
npm.cmd run dev
```
→ http://localhost:3000 (Supabase 키가 없으면 샘플 데이터로 자동 표시)

수집만 시험해 보기: `.\.venv\Scripts\python worker\run_pipeline.py --dry-run`

## 실서비스로 전환하기 — 키만 넣으면 끝

| 어디에 | 무엇을 | 효과 |
|---|---|---|
| Supabase SQL Editor | `migrations/001_init.sql` → `002_…` → `003_…` → `004_…` → `seed/seed_platforms.sql` 순서로 실행 | DB 준비 |
| `web/.env.local` (`.env.local.example` 복사) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 화면이 샘플 → 실데이터로 |
| `web/.env.local` 또는 배포 환경의 서버 변수 | `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (NEXT_PUBLIC 금지) | [원본 쉽게 읽기]를 처음 누를 때 자동 생성·DB 캐싱 |
| GitHub 저장소 → Settings → Secrets and variables → Actions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` | 1시간마다 자동 수집·요약 |

## 테스트

```powershell
cd worker; ..\.venv\Scripts\python -m pytest -q
cd web; npm.cmd test; npm.cmd run lint; npm.cmd run typecheck; npm.cmd run build
```

## 수집·노출 규칙 (1시간 주기)

- **유입 수문:** 매시 정각 수집 → 이미 있는 이슈는 지표만 갱신(재요약 없음) → 새 요약은 실행당 최대 4개, 같은 플랫폼 최대 2개
- **신선도 정렬:** `importance_score / (수집 후 경과시간 + 2)^1.5` — 방금 들어온 소식이 위로, 시간이 지나면 아래로
- **퇴장 수문:** 0~7일 라이브 피드(최대 60개, 더보기) → 8~30일 '지난 주요 소식' → 31일+ 보관(본문 비우고 제목·링크·엔티티만)

## 읽기 경험 원칙

- **모든 요약은 입문자 기준.** `difficulty` 는 '원문 난이도 해독 배지'(🌱 가벼운 트렌드 → 1분 정리 / ⚡ 개발 실무 문서 → 쉽게 해독 / 🔥 박사급 논문 → 쉽게 해독)이고, 기사를 숨기는 필터로 쓰지 않는다.
- **후킹은 사실로.** 제목은 돈·시간 절약 / 통념 반전 / 당장 무료로 써보기 중 원문이 받쳐 주는 각도만. `benefit_tag` 는 10~16자, 근거 없으면 비운다.
- **[원본 쉽게 읽기]** 는 원문 흐름을 순서대로 풀어 쓴 완독 해설 + 관람 포인트. DB 모드에선 첫 요청 때 1회만 생성하고 `summaries.easy_original_json` 에 영구 캐싱한다.
- 검수용 스냅샷: `cd web && npm run audit:snapshot` → 루트 `AUDIT_SNAPSHOT.md`

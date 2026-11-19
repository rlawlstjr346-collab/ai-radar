// 외부 아키텍트 검수용 AUDIT_SNAPSHOT.md 생성기.
//   npm run audit:snapshot   (Node 22.18+/24 의 TypeScript 타입 제거 기능으로 .ts 데이터를 그대로 읽는다)
// 손으로 옮겨 적지 않고 실제 소스 파일을 읽어 만들기 때문에, 데이터·프롬프트를 바꾼 뒤 다시 실행하면 된다.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const root = join(web, "..");
const load = (p) => import(pathToFileURL(join(web, p)).href);

const { SAMPLE_FEED } = await load("src/data/sample-feed.ts");
const { SAMPLE_EASY_ORIGINAL } = await load("src/data/sample-easy-original.ts");
const { CATEGORY_META, DIFFICULTY_META } = await load("src/lib/categories.ts");
const platforms = JSON.parse(readFileSync(join(web, "src/data/platforms.sample.json"), "utf8"));
const platformName = Object.fromEntries(platforms.map((p) => [p.id, p.name]));

// ① 파일 트리 (git 이 추적하거나 추적 예정인 파일 — node_modules/.next/.env 등 제외)
function fileTree() {
  const files = execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && f !== "AUDIT_SNAPSHOT.md")
    .sort();
  const tree = {};
  for (const f of files) {
    let node = tree;
    for (const part of f.split("/")) node = node[part] ??= {};
  }
  const lines = [];
  const walk = (node, prefix) => {
    const keys = Object.keys(node).sort((a, b) => {
      const da = Object.keys(node[a]).length > 0, db = Object.keys(node[b]).length > 0;
      return da === db ? a.localeCompare(b) : da ? -1 : 1;
    });
    keys.forEach((k, i) => {
      const last = i === keys.length - 1;
      const isDir = Object.keys(node[k]).length > 0;
      lines.push(`${prefix}${last ? "└── " : "├── "}${k}${isDir ? "/" : ""}`);
      if (isDir) walk(node[k], prefix + (last ? "    " : "│   "));
    });
  };
  walk(tree, "");
  return { text: ["ai-radar/", ...lines].join("\n"), count: files.length };
}

const fence = (lang, body) => "````" + lang + "\n" + body.replace(/\s+$/, "") + "\n````";

// ③ 상위 5개 기사 렌더링 텍스트
function renderArticle(item, rank) {
  const easy = SAMPLE_EASY_ORIGINAL[item.id];
  const d = DIFFICULTY_META[item.difficulty];
  const out = [];
  out.push(`### ${rank}. ${item.hook_title}`);
  out.push("");
  out.push(`| 항목 | 값 |`);
  out.push(`|---|---|`);
  out.push(`| id | \`${item.id}\` |`);
  out.push(`| 플랫폼 · 카테고리 | ${platformName[item.platform_id] ?? item.platform_id} · ${CATEGORY_META[item.category].label} |`);
  out.push(`| benefit_tag | ${item.benefit_tag ?? "(없음)"} |`);
  out.push(`| 원문 난이도 해독 배지 | ${d.label} |`);
  out.push(`| importance_score · 수명 | ${item.importance_score} · ${item.lifecycle_status} |`);
  out.push(`| 원문 | ${item.canonical_url} |`);
  out.push("");
  out.push(`**[1분 핵심 요약]**`);
  out.push("");
  out.push(`- **원래는요** — ${item.context_ko}`);
  out.push(`- **무슨 일이냐면요** — ${item.what_ko}`);
  if (item.analogy_ko) out.push(`- **쉽게 비유하자면요** — ${item.analogy_ko}`);
  out.push(`- **왜 중요할까요?** — ${item.why_ko}`);
  if (item.caveats_ko) out.push(`- **참고할 점** — ${item.caveats_ko}`);
  if (item.terms.length) out.push(`- **외계어 툴팁** — ${item.terms.map((t) => `\`${t.term}\`: ${t.easy}`).join(" / ")}`);
  if (item.entities.length) out.push(`- **엔티티** — ${item.entities.map((e) => e.name).join(", ")}`);
  out.push("");
  out.push(`**[원본 쉽게 읽기]** _(${easy.source_note ?? ""})_`);
  out.push("");
  easy.sections.forEach((s, i) => {
    out.push(`${i + 1}. **${s.heading}**  `);
    out.push(`   ${s.body}`);
    if (s.quote) out.push(`   > 원문: ${s.quote}`);
  });
  out.push("");
  out.push(`**🧭 실제 원문 링크 들어가실 때 관람 포인트**`);
  out.push("");
  easy.watch_points.forEach((w) => out.push(`- ${w}`));
  out.push("");
  return out.join("\n");
}

const tree = fileTree();
const covered = SAMPLE_FEED.filter((i) => SAMPLE_EASY_ORIGINAL[i.id]).sort((a, b) => b.importance_score - a.importance_score);
const top5 = covered.slice(0, 5);
const head = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();

const md = `# AI Radar — Audit Snapshot

> 외부 총괄 아키텍트 검수용 스냅샷. \`web/scripts/gen-audit-snapshot.mjs\` 가 실제 소스 파일을 읽어 자동 생성했다.
> 생성 시각: ${new Date().toISOString()} · 기준 커밋: \`${head}\` (+ 작업 트리) · 다시 만들기: \`cd web && npm run audit:snapshot\`

## 요약 수치

| 항목 | 값 |
|---|---|
| 로컬 샘플 기사 | ${SAMPLE_FEED.length}개 (hot ${SAMPLE_FEED.filter((i) => i.lifecycle_status === "hot").length} / warm ${SAMPLE_FEED.filter((i) => i.lifecycle_status === "warm").length}) |
| [원본 쉽게 읽기] 준비된 기사 | ${covered.length}개 — ${covered.map((i) => `\`${i.id}\``).join(", ")} |
| 실전 이득 칩(benefit_tag) | ${SAMPLE_FEED.filter((i) => i.benefit_tag).length}개 기사에만 |
| 원문 난이도 분포 | 🌱1: ${SAMPLE_FEED.filter((i) => i.difficulty === 1).length} · ⚡2: ${SAMPLE_FEED.filter((i) => i.difficulty === 2).length} · 🔥3: ${SAMPLE_FEED.filter((i) => i.difficulty === 3).length} |
| 플랫폼 도감 | ${platforms.length}곳 (자동 수집 ${platforms.filter((p) => p.collect_status === "active").length} · 도감 전용 ${platforms.filter((p) => p.collect_status === "directory_only").length}) |
| 추적 파일 수 | ${tree.count} |

## ① 전체 파일 트리

${fence("text", tree.text)}

## ② 현재 적용된 프롬프트 전문

### 2-1. 카드 요약 프롬프트 — \`worker/prompts/newneek_v1.py\` (수집 워커, 아이템당 LLM 1회)

${fence("python", readFileSync(join(root, "worker/prompts/newneek_v1.py"), "utf8"))}

### 2-2. [원본 쉽게 읽기] 생성 프롬프트 — \`web/src/lib/easy-original-prompt.ts\` (첫 요청 시 1회, 이후 DB 캐시)

${fence("ts", readFileSync(join(web, "src/lib/easy-original-prompt.ts"), "utf8"))}

## ③ 로컬 샘플 상위 5개 기사 — 실제 렌더링 텍스트 전체

선정 기준: [원본 쉽게 읽기]가 준비된 ${covered.length}개 기사 중 \`importance_score\` 상위 5개.
(원문 자동 접근이 막힌 OpenAI 블로그 기사 — 예: GPT-6.2 Astra·Sol — 는 해설을 지어내지 않기 위해 제외했다.)

${top5.map((it, i) => renderArticle(it, i + 1)).join("\n---\n\n")}

## ④ 라우트 및 상태 관리 구조

### 라우트

| 경로 | 종류 | 역할 |
|---|---|---|
| \`/\` | 서버 컴포넌트 (ISR \`revalidate = 600\`) | \`loadRadarData()\` → Supabase(anon) 또는 로컬 샘플 폴백 → \`<RadarApp data>\` |
| \`/?item=<id>\` · \`/?platform=<id>\` | 같은 페이지 + 쿼리 | 공유 링크 / 뒤로가기 시 해당 기사·플랫폼을 바로 연다 (warm 기사는 '지난 주요 소식' 탭으로 자동 전환) |
| \`/api/items/[id]/easy-original\` | Route Handler (\`force-dynamic\`, \`maxDuration 60\`) | [원본 쉽게 읽기] JSON. 샘플 모드: 로컬 데이터. DB 모드: \`summaries.easy_original_json\` 캐시 → 없으면 원문 fetch(SSRF 차단, arXiv 는 /html 전문 우선) → 403/429 등으로 막히면 \`items.raw_body\` → 짧은 발췌 → Claude 1회 → 캐시 저장 |

### 데이터 흐름

\`\`\`text
[GitHub Actions 매시 정각] worker/run_pipeline.py
  수집(13 소스 병렬) → 정규화·dedup_key → 병합(source_count) → 신선도 점수
  → 미요약 hot 중 실행당 4개·플랫폼당 2개 → newneek-v1.1 요약(1회 호출) → summaries (benefit_tag 포함)
  → apply_item_lifecycle(): hot 0~7일 → warm 8~30일 → archived 31일+ (본문·easy_original_json 비움)

[웹] page.tsx (서버) → loadRadarData(): hot 200개(최신순) + warm 60개(중요도순) + platforms
  → RadarApp (클라이언트): hotRankScore = importance / (경과h + 2)^1.5 로 정렬, 최대 60개
  → 상세 패널 [원본 쉽게 읽기] 탭을 처음 열 때만 /api/items/:id/easy-original 호출
\`\`\`

### 클라이언트 상태 (\`web/src/components/RadarApp.tsx\`)

| 상태 | 타입 | 설명 |
|---|---|---|
| \`view\` | \`"feed" \\| "past" \\| "directory"\` | 라이브 피드 / 지난 주요 소식 / 플랫폼 도감 |
| \`category\` | \`CategoryFilter\` | 전체 + 7개 카테고리 |
| \`query\` | \`string\` | 실시간 키워드 검색 (제목·benefit_tag·요약·엔티티 태그·용어·플랫폼명, 공백 구분 AND). \`/\` 포커스, Esc 지우기 |
| \`selection\` | \`{type:"item"\\|"platform", id} \\| null\` | 상세 내용. 와이드 화면 첫 진입 시 TOP SPOTLIGHT 01 기본 선택(URL 미기록). 선택/닫기 시 \`history.pushState\`, \`popstate\` 로 복원. 카드 '선택됨' 표시는 상세가 실제로 보일 때만 |
| \`sheetOpen\` | \`boolean\` | 드로어(768~1359px)·바텀시트(<768px) — 사용자가 직접 누르거나 공유 링크로 왔을 때만 연다 |
| \`now\` | \`number\` | 서버 \`generatedAt\` 로 시작(hydration 일치) 후 1분마다 갱신 — NEW/N시간 전, 신선도 정렬 기준 |
| \`layout\` | \`"wide" \\| "split" \\| "mobile"\` (\`useSyncExternalStore(matchMedia)\`) | ≥1360px 우측 고정 패널 3단 / 768~1359px 슬라이드 드로어 / <768px 바텀시트 — 폭에 맞는 하나만 렌더 (중복 DOM 방지). CSS 그리드는 \`lg:\`(사이드바+피드)·\`wide:\`(+패널) 브레이크포인트로 같은 경계를 쓴다 |
| ItemDetail \`tab\` | \`"summary" \\| "easy"\` | [1분 핵심 요약] / [원본 쉽게 읽기]. 기사가 바뀌면 요약 탭으로 초기화 |
| EasyOriginalView 메모리 캐시 | \`Map<id, response>\` | 같은 세션에서 탭을 오가도 API 재호출 없음 |

### 서버 환경변수

| 변수 | 쓰는 곳 | 없을 때 |
|---|---|---|
| \`NEXT_PUBLIC_SUPABASE_URL\`, \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` | 페이지 데이터 (읽기 전용, RLS) | 로컬 샘플 폴백 |
| \`SUPABASE_SERVICE_ROLE_KEY\`, \`ANTHROPIC_API_KEY\` (서버 전용) | [원본 쉽게 읽기] 생성·캐시 저장 | 캐시된 해설만 제공, 없으면 "생성기 연결 전" 안내 |
`;

writeFileSync(join(root, "AUDIT_SNAPSHOT.md"), md, "utf8");
console.log(`wrote AUDIT_SNAPSHOT.md — ${tree.count} files, top5: ${top5.map((i) => i.id).join(", ")}`);

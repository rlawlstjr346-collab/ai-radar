import type { Category, Difficulty, Entity, FeedItem, Lifecycle, Term } from "@/lib/types";

/**
 * Supabase 환경변수가 없을 때 보여주는 폴백 피드 — 36장.
 *
 * 2026-11-19 에 worker 수집 어댑터(--dry-run 과 같은 경로)로 실제 공개 소스
 * (HF Papers/Models/Spaces, Hacker News, GitHub Releases, Civitai nsfw=false, Bluesky, OpenAI·DeepMind RSS,
 * Anthropic sitemap)에서 가져온 아이템 중 7개 카테고리가 고루 섞이도록 골랐다.
 * 요약은 요약기 프롬프트(newneek-v1) 규칙대로 '수집된 원문 텍스트에 있는 사실만' 써서 작성했다.
 * 원문이 제목뿐인 아이템(일부 HN·Anthropic)은 그렇다고 밝히고 원문 링크로 안내한다.
 *
 * created_at 은 원문 발행 시각(= 그때 수집됐다고 가정)이고, lifecycle_status 는 2026-11-19 기준 스냅샷이다
 * (0~7일 hot, 8~30일 warm). DB 를 연결하면 이 파일은 쓰이지 않는다.
 */

type CardInput = {
  id: string;
  platform: string;
  category: Category;
  url: string;
  score: number;
  at: string;
  sources?: number;
  life?: Lifecycle;
  /** 원문 난이도(해독 배지): 1 가벼운 트렌드 / 2 개발 실무 문서 / 3 박사급 논문 */
  difficulty: Difficulty;
  hook: string;
  /** 10~16자 실전 이득 칩. 원문이 받쳐 주는 이득이 없으면 생략 */
  benefit?: string;
  context: string;
  what: string;
  analogy?: string | null;
  why: string;
  caveats?: string | null;
  terms?: Term[];
  entities?: Entity[];
};

function card(c: CardInput): FeedItem {
  return {
    id: `sample-${c.id}`,
    platform_id: c.platform,
    category: c.category,
    canonical_url: c.url,
    thumbnail_url: null,
    importance_score: c.score,
    source_count: c.sources ?? 1,
    lifecycle_status: c.life ?? "hot",
    published_at: c.at,
    created_at: c.at,
    hook_title: c.hook,
    benefit_tag: c.benefit ?? null,
    context_ko: c.context,
    what_ko: c.what,
    analogy_ko: c.analogy ?? null,
    why_ko: c.why,
    caveats_ko: c.caveats ?? null,
    difficulty: c.difficulty,
    terms: c.terms ?? [],
    entities: c.entities ?? [],
  };
}

const e = (name: string, kind: string, ...tags: string[]): Entity => ({ name, kind, tags });

export const SAMPLE_FEED: FeedItem[] = [
  // ─────────────────────────────── industry · 빅테크·트렌드 ───────────────────────────────
  card({
    id: "gpt-6-2-astra-sol",
    platform: "openai",
    category: "industry",
    url: "https://openai.com/index/introducing-gpt-6-2-astra-sol",
    score: 40.78,
    sources: 2,
    at: "2026-11-17T17:45:00Z",
    difficulty: 1,
    hook: "더 잘하는데 더 싸졌대요: OpenAI 새 모델 Astra·Sol",
    benefit: "더 낮은 비용으로 업무",
    context:
      "OpenAI는 새 모델을 낼 때마다 ChatGPT, 코딩 도구 Codex, 개발자용 API에 차례로 넣어 왔거든요. 이번엔 이름이 두 개짜리 세트로 나왔어요.",
    what:
      "GPT-6.2 Astra와 Sol은 업무용 결과물, 코딩, 컴퓨터 사용 능력이 좋아졌고, 더 적은 비용으로 효율도 올렸대요. ChatGPT Work, Codex, API에서 쓸 수 있어요.",
    analogy: "같은 셰프가 '정식 코스'와 '빠른 점심 메뉴'를 동시에 낸 것처럼, 쓰임새에 따라 고르라는 신호예요!",
    why: "회사에서 ChatGPT를 쓰고 있다면 문서·코드 작업 품질이 바로 달라질 수 있어요. 해커뉴스에서도 댓글이 800개 넘게 달릴 만큼 관심이 컸어요.",
    caveats: "Astra와 Sol이 정확히 어떻게 다른지는 원문에서 확인해야 해요.",
    terms: [{ term: "API", easy: "다른 프로그램이 AI 기능을 빌려 쓸 수 있게 열어 둔 전용 창구예요." }],
    entities: [e("GPT-6.2 Astra", "model", "llm"), e("GPT-6.2 Sol", "model", "llm"), e("Codex", "tool", "coding")],
  }),
  card({
    id: "anthropic-ipo",
    platform: "anthropic",
    category: "industry",
    url: "https://anthropic.com/news/anthropic-prices-initial-public-offering",
    score: 35.56,
    sources: 2,
    at: "2026-11-18T23:26:25Z",
    difficulty: 1,
    hook: "Claude 만든 회사 주식, 11월 19일부터 나스닥에서 거래돼요",
    benefit: "주당 83달러 공모가",
    context:
      "회사가 주식시장에 처음 이름을 올리는 걸 '상장(IPO)'이라고 하거든요. 상장 직전엔 처음 주식을 얼마에 팔지, 즉 공모가를 정해요.",
    what:
      "앤트로픽이 보통주 공모가를 주당 83달러로 정했어요. 모두 9억 8천만 주를 내놓고, 11월 19일부터 나스닥에서 'ANT'라는 이름표로 거래가 시작될 예정이래요.",
    analogy: "인기 맛집이 처음으로 '우리 가게 지분 한 조각은 이 가격이에요' 하고 가격표를 붙인 순간이에요.",
    why: "AI 회사들이 연구소에서 상장 기업으로 바뀌면, 투자자 눈치를 보며 제품을 더 자주, 더 빨리 내놓게 될 수 있어요. 해커뉴스에서도 댓글이 280개 넘게 달렸어요.",
    caveats: "공모는 11월 20일에 마무리될 예정이고, 그 전에 정해진 절차를 거쳐야 해요. 투자 판단은 공식 투자설명서를 직접 확인하세요.",
    terms: [{ term: "IPO", easy: "회사가 처음으로 주식을 일반 사람들에게 파는 '주식시장 데뷔 무대'예요." }],
    entities: [e("Anthropic", "company", "ipo")],
  }),
  card({
    id: "openai-chip-design",
    platform: "openai",
    category: "industry",
    url: "https://openai.com/index/advancing-chip-design-with-our-models",
    score: 33.16,
    sources: 2,
    at: "2026-11-18T00:00:00Z",
    difficulty: 1,
    hook: "AI가 자기가 돌아갈 반도체 설계까지 거들기 시작했어요",
    context:
      "반도체 칩은 아주 작은 회로 수십억 개를 빈틈없이 배치해야 해서, 설계에 전문가들이 엄청난 시간을 쓰거든요.",
    what:
      "OpenAI 모델이 'Jalapeño'라는 칩에 쓰인 회로를 최적화했고, RISC-V 코어 설계도 개선했대요. OpenAI는 이걸 GPT-6 Astra로 AI 칩 설계가 한 걸음 나아간 사례라고 소개했어요.",
    analogy: "도시 설계 AI가 수많은 골목과 신호등 배치를 다시 짜서 차가 덜 막히게 만든 것과 비슷해요!",
    why: "칩 설계가 빨라지면 AI를 돌리는 컴퓨터도 더 빨리 좋아질 수 있어요. 'AI가 AI의 발전 속도를 끌어올리는' 장면이라 업계가 주목하는 이유예요.",
    caveats: "얼마나 좋아졌는지 구체적인 수치는 원문을 봐야 알 수 있어요.",
    terms: [{ term: "RISC-V", easy: "누구나 무료로 가져다 쓸 수 있는 공개형 컴퓨터 두뇌(CPU) 설계 규칙이에요." }],
    entities: [e("GPT-6 Astra", "model", "chip-design"), e("RISC-V", "technique", "hardware")],
  }),
  card({
    id: "sumitomo-life-chatgpt",
    platform: "openai",
    category: "industry",
    url: "https://openai.com/business/customer-stories/sumitomo-life",
    score: 26.51,
    at: "2026-11-18T08:00:00Z",
    difficulty: 1,
    hook: "회사에 AI가 안 퍼진다면? 이 보험사는 임원부터 먼저 썼어요",
    benefit: "사내 AI 정착 노하우",
    context:
      "회사에 새 도구가 들어와도 막상 직원들이 안 쓰는 경우가 많거든요. 그래서 'AI를 어떻게 정착시키냐'가 요즘 기업들의 큰 고민이에요.",
    what:
      "일본 스미토모생명은 ChatGPT Enterprise로 다른 보험사를 조사하고, 제안서를 준비하고, 투자 분석용 코드 초안도 쓴대요. 임원들이 먼저 써 본 게 회사 전체로 퍼지는 데 도움이 됐다고 해요.",
    analogy: "팀장님이 먼저 새 메신저를 쓰기 시작하면 팀원들도 자연스럽게 따라 깔게 되는 것과 같아요.",
    why: "우리 회사에 AI를 들이고 싶다면 '위에서 먼저 써 보기'가 꽤 실용적인 출발점이라는 힌트예요.",
    caveats: "OpenAI가 직접 쓴 고객 사례 글이라, 좋은 점 위주로 소개됐을 수 있어요.",
    terms: [{ term: "ChatGPT Enterprise", easy: "회사 보안 규칙에 맞춰 직원 전체가 함께 쓰도록 만든 기업용 ChatGPT예요." }],
    entities: [e("Sumitomo Life", "company", "insurance"), e("ChatGPT Enterprise", "tool", "enterprise")],
  }),
  card({
    id: "google-ai-answers-traffic",
    platform: "hacker-news",
    category: "industry",
    url: "https://revscope.co/blog/search-seo-geo-2026",
    score: 32.46,
    at: "2026-11-18T00:17:58Z",
    difficulty: 1,
    hook: "검색 결과에 AI 요약이 뜨면, 웹사이트 클릭이 40% 줄었어요",
    benefit: "내 블로그 유입 점검",
    context:
      "예전엔 구글에서 검색하면 링크를 눌러 웹사이트로 들어갔거든요. 요즘은 검색 결과 맨 위에 AI가 답을 바로 정리해서 보여줘요.",
    what:
      "연구자들이 미국 데스크톱 사용자를 무작위로 나눠 한쪽만 AI 요약을 숨겨 봤더니, 요약이 보이는 쪽은 검색 한 번당 바깥 웹사이트 클릭이 0.62번에서 0.37번으로 약 40% 줄었대요. 이 AI 요약은 이제 추적 중인 키워드의 61% 넘게에서 나타나요.",
    analogy: "서점 입구에서 직원이 책 내용을 다 요약해 주면, 손님이 굳이 책장까지 안 가는 것과 비슷해요.",
    why: "블로그나 쇼핑몰을 운영한다면 '검색 순위만 높으면 손님이 온다'는 공식이 흔들리고 있다는 신호예요. 해커뉴스에서도 댓글 540개 넘게 토론이 붙었어요.",
    caveats: "핵심 실험은 아직 동료 검토 전인 논문이고, 데스크톱 검색만 다뤘어요.",
    terms: [{ term: "AI 요약", easy: "검색 결과 맨 위에 AI가 여러 사이트 내용을 모아 답을 미리 정리해 보여주는 칸이에요." }],
    entities: [e("Google AI Overviews", "tool", "search", "seo")],
  }),

  // ─────────────────────────────── dev · 코딩·에이전트 ───────────────────────────────
  card({
    id: "windows-agent-telemetry",
    platform: "hacker-news",
    category: "dev",
    url: "https://xusheng.dev/posts/windows-coding-agent-telemetry",
    score: 31.0,
    at: "2026-11-16T22:58:20Z",
    difficulty: 2,
    hook: "윈도우 11, 내가 쓰는 코딩 AI 목록을 기본 설정으로 보내고 있었어요",
    benefit: "설정 한 번으로 끄기",
    context:
      "운영체제는 오류를 고치려고 사용 기록을 조금씩 모으거든요. 그런데 '어디까지 모아도 되냐'는 늘 민감한 주제예요.",
    what:
      "한 개발자가 윈도우 11 시스템 파일을 뜯어보니, codex·claude·copilot·cursor 같은 코딩 에이전트와 python·gcc 같은 개발 도구를 썼는지 기록하는 부품이 있었대요. '선택적 진단 데이터'가 켜져 있으면 이 기록이 마이크로소프트로 업로드되는데, 그가 테스트한 미국 설정에선 기본으로 켜져 있었어요.",
    analogy: "집 관리 업체가 고장 점검한다고 들어와서, 내가 쓰는 주방 도구 브랜드 목록까지 적어 간 걸 알게 된 기분이에요.",
    why: "설정 → 개인 정보 및 보안 → 진단 및 피드백에서 '선택적 진단 데이터 보내기'를 끄면 돼요. 회사 PC라면 한 번 확인해 볼 만해요.",
    caveats: "기록되는 건 프롬프트나 코드가 아니라 '어떤 도구를 썼는지' 표시예요. 한 사람이 직접 분석한 결과라 다른 지역 설정에선 다를 수 있어요.",
    terms: [{ term: "코딩 에이전트", easy: "말로 시키면 코드를 직접 읽고 고치고 실행까지 해 주는 AI 조수예요." }],
    entities: [e("Windows 11", "platform", "privacy", "telemetry")],
  }),
  card({
    id: "llm-reverse-engineering",
    platform: "hacker-news",
    category: "dev",
    url: "https://slowchronicle.com/posts/llm-assisted-reverse-engineering",
    score: 29.46,
    at: "2026-11-18T22:29:13Z",
    difficulty: 2,
    hook: "설명서 없는 프로그램, 이제 AI랑 같이 뜯어봐요",
    context:
      "이미 만들어진 프로그램을 거꾸로 분석해서 속 구조를 알아내는 걸 '리버스 엔지니어링'이라고 하거든요. 원래는 전문가들도 몇 날 며칠 걸리는 일이에요.",
    what:
      "'LLM의 도움을 받아 리버스 엔지니어링하기'라는 경험담이 해커뉴스에서 200점 넘게 받았어요. AI를 분석 파트너로 쓰는 방법에 개발자들이 관심을 보였어요.",
    analogy: "외국어로 된 레고 설명서 없이 완성품만 보고 조립 순서를 추리할 때, 옆에서 같이 추리해 주는 친구가 생긴 거예요.",
    why: "오래된 사내 프로그램처럼 문서가 사라진 코드를 다뤄야 한다면 참고할 만한 작업 방식이에요.",
    caveats: "구체적인 방법과 한계는 원문 글에 나와 있어요. 남의 소프트웨어를 분석할 땐 라이선스 약관도 꼭 확인하세요.",
    terms: [
      { term: "리버스 엔지니어링", easy: "완성된 물건을 분해해서 어떻게 만들어졌는지 거꾸로 알아내는 일이에요." },
      { term: "LLM", easy: "엄청난 양의 글을 읽고 다음 단어를 맞히도록 훈련된, 말 잘하는 AI예요." },
    ],
    entities: [e("LLM", "technique", "reverse-engineering")],
  }),
  card({
    id: "codex-sandbox",
    platform: "openai",
    category: "dev",
    url: "https://openai.com/index/inside-the-codex-sandbox",
    score: 26.51,
    at: "2026-11-18T08:00:00Z",
    difficulty: 2,
    hook: "AI 코딩 비서에게 내 PC를 맡겨도 될까? 울타리가 있어요",
    benefit: "파일·네트워크 접근 제한",
    context:
      "코딩 AI가 내 컴퓨터에서 명령어를 직접 실행하면 편하지만, 실수로 중요한 파일을 지우거나 인터넷에 뭘 보낼까 봐 걱정되거든요.",
    what:
      "OpenAI가 Codex가 내 컴퓨터에서 명령을 실행하면서도, 사용자가 정한 파일·네트워크 제한을 지키게 만드는 '샌드박스' 구조를 소개했어요. macOS, 리눅스, 윈도우 모두 해당돼요.",
    analogy: "아이에게 놀이터 울타리 안에서는 마음껏 놀게 하고, 도로로는 못 나가게 막아 두는 것과 같아요!",
    why: "AI에게 내 PC 작업을 맡기고 싶은데 불안했다면, 어떤 안전장치가 있는지 알고 쓰는 게 훨씬 마음 편해요.",
    terms: [{ term: "샌드박스", easy: "프로그램이 정해진 울타리 안에서만 움직이도록 가둬 두는 안전 공간이에요." }],
    entities: [e("Codex", "tool", "coding-agent", "security")],
  }),
  card({
    id: "vllm-0-34",
    platform: "github",
    category: "dev",
    url: "https://github.com/vllm-project/vllm/releases/tag/v0.34.0",
    score: 24.05,
    at: "2026-11-18T21:02:33Z",
    difficulty: 2,
    hook: "같은 GPU로 더 많이: vLLM 업데이트로 디코딩 최대 1.95배",
    benefit: "디코딩 최대 1.95배",
    context:
      "vLLM은 회사들이 AI 모델을 많은 사람에게 동시에 서비스할 때 쓰는 오픈소스 엔진이거든요. 업데이트 하나에 서버 비용이 달라질 수 있어요.",
    what:
      "v0.34.0에는 412명이 만든 1,061개의 변경이 들어갔어요. 새 모델 10개를 지원하고, 실제로 남은 메모리를 보고 KV 캐시 크기를 정하는 기능이 기본으로 켜졌어요. 최신 GPU에선 디코딩이 최대 1.95배 빨라졌대요.",
    analogy: "식당이 영업 시작 전에 빈 테이블 수를 직접 세어 보고, 그만큼 예약을 더 받기로 한 셈이에요.",
    why: "AI 서비스를 직접 운영한다면 같은 장비로 더 많은 요청을 처리할 수 있어요. 대신 업데이트 전 안내를 꼭 읽어야 해요.",
    caveats: "기존 설정이 깨질 수 있는 변경(Model Runner V1 제거 등)이 있어서, 릴리스 노트의 '업그레이드 전 확인' 항목을 먼저 보세요.",
    terms: [
      { term: "KV 캐시", easy: "AI가 앞에서 읽은 내용을 다시 계산하지 않으려고 적어 두는 메모장이에요." },
      { term: "디코딩", easy: "AI가 대답을 한 글자씩 이어서 만들어 내는 단계예요." },
    ],
    entities: [e("vLLM", "tool", "inference", "serving"), e("Mistral Large 4", "model", "llm")],
  }),
  card({
    id: "ollama-0-40-16",
    platform: "ollama",
    category: "dev",
    url: "https://github.com/ollama/ollama/releases/tag/v0.40.16",
    score: 17.93,
    at: "2026-11-09T23:45:36Z",
    life: "warm",
    difficulty: 2,
    hook: "맥에서 AI 돌릴 때 메모리 27GB가 남아요",
    benefit: "맥 메모리 27GiB 절약",
    context:
      "Ollama는 명령어 한 줄로 AI 모델을 내 컴퓨터에 깔아 쓰게 해 주는 앱이거든요. 큰 모델은 메모리를 많이 먹어서 늘 고민이었어요.",
    what:
      "v0.40.16에서 에이전트 코딩용 65B 모델 'Ripple Preview'를 바로 받을 수 있게 됐어요. 애플 실리콘 맥에선 Qwen3.8 Flash Next가 메모리를 약 27GiB 덜 쓰게 됐대요.",
    analogy: "같은 짐을 싸는데 압축팩을 써서 캐리어 공간이 확 남은 것과 비슷해요!",
    why: "맥에서 큰 AI 모델이 버벅였다면 업데이트만으로 숨통이 트일 수 있어요.",
    terms: [{ term: "애플 실리콘", easy: "애플이 직접 만든 M 시리즈 칩이에요. CPU와 그래픽 메모리를 함께 나눠 써요." }],
    entities: [e("Ollama", "tool", "local-llm"), e("Ripple Preview", "model", "coding"), e("Qwen3.8 Flash Next", "model", "llm")],
  }),

  // ─────────────────────────────── llm_chat · 챗봇·생산성 ───────────────────────────────
  card({
    id: "gemini-4-neon",
    platform: "google-deepmind",
    category: "llm_chat",
    url: "https://deepmind.google/blog/introducing-gemini-4-neon",
    score: 35.27,
    sources: 2,
    at: "2026-11-18T21:35:43Z",
    difficulty: 1,
    hook: "구글 새 AI 'Neon', 형님 모델보다 작업당 비용 32% 싸요",
    benefit: "작업당 비용 32% 절감",
    context:
      "구글은 Gemini 4 모델들에 원소 이름을 붙여 내놓고 있거든요. Carbon, Hydrogen에 이어 이번엔 Neon이에요.",
    what:
      "Gemini 4 Neon은 가장 어려운 장기 작업용 Carbon과 빠른 일상 작업용 Hydrogen 사이에서 깊이와 효율의 균형을 잡은 모델이에요. 구글은 기본 설정에서 Carbon보다 작업당 비용이 32% 낮다고 했고, 개발자 가격은 입력 100만 토큰당 3달러예요.",
    analogy: "같은 스마트폰 시리즈에서 '최상위 프로'와 '라이트' 사이에 가성비 좋은 중간 모델이 나온 거라고 보면 돼요.",
    why: "구글 AI Pro·Ultra 구독자라면 제미나이 앱 모델 선택 메뉴에서 바로 고를 수 있어요. 해커뉴스에선 댓글 650개 넘게 비교 토론이 벌어졌어요.",
    caveats: "성능 순위는 구글이 공개한 벤치마크 기준이에요. 무료 사용자에게 열리는지는 원문에 없어요.",
    terms: [{ term: "Gemini", easy: "구글이 만든 AI 모델 이름이자 대화형 AI 서비스 이름이에요." }],
    entities: [e("Gemini 4 Neon", "model", "llm"), e("Google DeepMind", "company", "research")],
  }),
  card({
    id: "tencent-hy4-flash",
    platform: "huggingface",
    category: "llm_chat",
    url: "https://huggingface.co/tencent/Hy4-flash",
    score: 29.5,
    at: "2026-11-17T03:44:46Z",
    difficulty: 2,
    hook: "사진 보고 대화하는 텐센트 AI, 허깅페이스에서 바로 받아요",
    benefit: "공개 가중치 다운로드",
    context:
      "요즘 AI 모델은 글만 읽는 게 아니라 사진을 보고 설명하는 것까지 하거든요. 이런 걸 '멀티모달'이라고 불러요.",
    what:
      "텐센트의 Hy4-flash는 이미지와 글을 함께 입력받아 대답하는 대화형 모델이에요. 여러 전문가 중 필요한 부분만 골라 쓰는 MoE 구조래요. 허깅페이스 인기 순위에 올랐어요.",
    analogy: "질문마다 딱 맞는 전문 상담사만 불러오는 콜센터 같은 구조예요!",
    why: "중국 빅테크도 공개 모델 경쟁에 적극적이라는 걸 보여줘요. 개발자라면 무료로 받아서 직접 테스트해 볼 수 있어요.",
    caveats: "라이선스가 '기타(other)'로 표시돼 있어서, 상업적으로 쓰기 전에 조건을 꼭 읽어 보세요.",
    terms: [
      { term: "MoE", easy: "여러 분야 전문가 AI 중 질문에 맞는 몇 명만 골라 부르는 방식이에요." },
      { term: "멀티모달", easy: "글, 사진, 소리처럼 여러 종류의 정보를 한꺼번에 이해하는 능력이에요." },
    ],
    entities: [e("Hy4-flash", "model", "multimodal", "moe"), e("Tencent", "company", "big-tech")],
  }),
  card({
    id: "sensenova-loop-9b",
    platform: "huggingface",
    category: "llm_chat",
    url: "https://huggingface.co/sensenova/SenseNova-Loop-9B",
    score: 27.77,
    at: "2026-11-17T10:16:41Z",
    difficulty: 2,
    hook: "덩치 대신 '반복'으로 깊게 생각하는 90억짜리 작은 AI",
    benefit: "Apache 2.0 상업 이용",
    context:
      "AI 모델은 보통 여러 층을 한 번씩 차례로 통과하며 생각하거든요. 층을 많이 쌓을수록 똑똑해지지만 그만큼 무거워져요.",
    what:
      "SenseNova-Loop-9B는 '루프형 트랜스포머' 방식을 쓴 90억 파라미터 모델이에요. 영어와 중국어를 지원하고, 이미지와 글을 함께 다뤄요. 라이선스는 Apache 2.0이에요.",
    analogy: "계단을 더 높이 쌓는 대신, 같은 계단을 여러 번 오르내리며 운동량을 늘리는 방식이라고 보면 돼요.",
    why: "작은 모델로도 생각을 더 깊게 하려는 새로운 시도라, AI 구조에 관심 있다면 눈여겨볼 만해요.",
    caveats: "레이더가 가져온 건 모델 정보 태그라, 실제 성능 비교는 모델 카드에서 확인해 주세요.",
    terms: [
      { term: "루프형 트랜스포머", easy: "같은 생각 단계를 여러 번 반복해서 돌리는 AI 구조예요." },
      { term: "파라미터", easy: "AI 머릿속에 있는 조절 손잡이 개수예요. 많을수록 표현력이 커져요." },
    ],
    entities: [e("SenseNova-Loop-9B", "model", "looped-transformer", "multimodal")],
  }),
  card({
    id: "inkling-2-small",
    platform: "huggingface",
    category: "llm_chat",
    url: "https://huggingface.co/thinkingmachines/Inkling-2-Small",
    score: 25.76,
    at: "2026-11-04T19:51:05Z",
    life: "warm",
    difficulty: 2,
    hook: "한 달 새 3만 번 내려받힌, 상업 이용도 되는 대화 AI",
    benefit: "상업 이용 가능 라이선스",
    context:
      "누구나 내려받아 쓸 수 있는 '공개 모델'은 다운로드 수가 곧 인기 지표거든요.",
    what:
      "Thinking Machines의 Inkling-2-Small은 그림과 글을 함께 이해하는 대화형 모델이에요. 최근 30일 동안 3만 번 넘게 다운로드됐고, Apache 2.0 라이선스로 공개됐어요.",
    why: "Apache 2.0이라 개인 프로젝트나 회사 서비스에 가져다 쓰기 비교적 자유로워요.",
    caveats: "성능 수치는 모델 카드에 따로 정리돼 있어요.",
    terms: [{ term: "Apache 2.0", easy: "출처와 바꾼 내용만 밝히면 돈 버는 데 써도 되는 사용 허락서예요." }],
    entities: [e("Inkling-2-Small", "model", "multimodal", "open-weights"), e("Thinking Machines", "company", "ai-lab")],
  }),
  card({
    id: "edge0-145b",
    platform: "huggingface",
    category: "llm_chat",
    url: "https://huggingface.co/Edge0/Edge0-145B-NVFP4",
    score: 24.2,
    at: "2026-11-11T05:22:51Z",
    life: "warm",
    difficulty: 2,
    hook: "1450억 파라미터 AI를 4비트로 압축, 더 작은 장비로",
    benefit: "4비트 경량화 모델",
    context:
      "큰 AI 모델은 그대로 돌리면 비싼 서버가 필요하거든요. 그래서 숫자를 덜 정밀하게 저장해 크기를 줄이는 '양자화'를 많이 써요.",
    what:
      "Edge0-145B-NVFP4는 Qwen3.8-Flash-Next를 바탕으로 4비트로 줄인 모델이에요. 에이전트와 코딩 작업을 겨냥했고, 한 달 새 7만 번 넘게 다운로드됐어요.",
    analogy: "고화질 사진을 화질 조금만 양보하고 용량을 확 줄여 휴대폰에 많이 넣는 것과 같아요!",
    why: "큰 모델을 더 작은 장비에서 돌려 보고 싶은 개발자들이 많이 찾고 있다는 신호예요.",
    caveats: "라이선스가 '기타(other)'로 표시돼 있어 사용 조건 확인이 필요해요.",
    terms: [{ term: "양자화", easy: "AI 속 숫자를 덜 정밀하게 저장해서 크기와 메모리 사용량을 줄이는 방법이에요." }],
    entities: [e("Edge0-145B", "model", "quantization", "coding"), e("Qwen3.8-Flash-Next", "model", "llm")],
  }),

  // ─────────────────────────────── research · 논문·신기술 ───────────────────────────────
  card({
    id: "harvard-code-review",
    platform: "hacker-news",
    category: "research",
    url: "https://complexdiscovery.com/harvard-researchers-find-ai-coding-agents-shifted-the-bottleneck-to-code-review",
    score: 28.84,
    at: "2026-11-17T21:16:12Z",
    difficulty: 1,
    hook: "AI가 코드를 빨리 짤수록, 사람 검토가 새 병목이 된대요",
    context:
      "개발 현장에선 누가 쓴 코드를 다른 사람이 읽고 확인하는 '코드 리뷰'를 거쳐야 실제 서비스에 들어가거든요.",
    what:
      "하버드 연구진이 AI 코딩 에이전트를 쓰자 병목이 코드 작성에서 코드 리뷰로 옮겨갔다는 결과를 내놨다는 소식이에요. 해커뉴스에서 댓글이 440개 넘게 달렸어요.",
    analogy: "주방에 요리 로봇이 들어와 음식이 쏟아져 나오니, 이번엔 맛을 보는 셰프 한 명 앞에 접시가 줄을 선 상황이에요.",
    why: "AI로 일을 빨리 끝내도 결국 사람이 확인하는 단계가 남는다는 얘기라, 팀 업무 흐름을 짤 때 참고할 만해요.",
    caveats: "레이더가 가져온 건 기사 제목이에요. 연구 규모와 방법은 원문에서 확인해 주세요.",
    terms: [{ term: "병목", easy: "병 입구가 좁아서 물이 천천히 나오듯, 전체 속도를 붙잡는 가장 좁은 구간이에요." }],
    entities: [e("Harvard", "company", "research"), e("AI coding agents", "technique", "software-engineering")],
  }),
  card({
    id: "claude-black-hole-physics",
    platform: "anthropic",
    category: "research",
    url: "https://anthropic.com/research/claude-black-hole-physics",
    score: 28.07,
    at: "2026-11-18T21:42:44Z",
    difficulty: 3,
    hook: "20년 넘게 아무도 못 끝낸 블랙홀 계산, Claude가 마무리했어요",
    benefit: "물리학 난제 2개 해결",
    context:
      "AI 회사들은 요즘 '과학 연구를 얼마나 도울 수 있나'를 보여주는 사례를 자주 공개하거든요.",
    what:
      "앤트로픽은 Claude Fable 5.2가 블랙홀과 양자 중력에 관한 이론물리학 미해결 문제 두 개를 풀었다고 발표했어요. 그중 하나는 물리학자들이 2003년에 계산 방법만 세워 두고 아무도 끝내지 못한 문제였는데, Claude는 자기 복제본들로 작은 연구팀을 꾸려 계산을 나눠 하고 서로 검산했대요.",
    analogy: "20년 동안 반쯤 풀다 만 거대한 수학 숙제를, AI 조교 여럿이 나눠 풀고 서로 답을 맞춰 본 셈이에요!",
    why: "AI가 문서 정리를 넘어, 사람이 오래 못 푼 과학 계산을 실제로 마무리하는 단계까지 왔다는 사례예요.",
    caveats: "앤트로픽도 두 결과 모두 우리 우주를 직접 설명하거나 당장 실생활에 쓰이는 건 아니라고 밝혔어요.",
    terms: [{ term: "블랙홀", easy: "중력이 너무 세서 빛조차 빠져나오지 못하는 우주 공간이에요." }],
    entities: [e("Claude", "model", "science"), e("Anthropic", "company", "research")],
  }),
  card({
    id: "genie-4",
    platform: "google-deepmind",
    category: "research",
    url: "https://deepmind.google/blog/genie-4-is-now-available",
    score: 27.63,
    at: "2026-11-18T18:13:42Z",
    difficulty: 1,
    hook: "구글 딥마인드 Genie 4, 이제 직접 써볼 수 있대요",
    context:
      "Genie는 구글 딥마인드가 연구해 온 'AI가 만들어 내는 세상' 계열 프로젝트 이름이거든요.",
    what: "구글 딥마인드 공식 블로그에 'Genie 4를 이제 이용할 수 있다'는 공지가 올라왔어요.",
    why: "연구실 안에만 있던 기술이 사람들이 직접 써 보는 단계로 나왔다는 뜻이라, 어떤 걸 할 수 있는지 구경해 볼 만해요.",
    caveats: "레이더가 가져온 건 공지 제목이라, 누가 어떻게 쓸 수 있는지는 원문에서 확인해 주세요.",
    entities: [e("Genie 4", "model", "world-model"), e("Google DeepMind", "company", "research")],
  }),
  card({
    id: "energy-based-reasoners",
    platform: "hacker-news",
    category: "research",
    url: "https://energy-based-reasoners.github.io/",
    score: 29.8,
    at: "2026-11-18T09:29:32Z",
    difficulty: 3,
    hook: "AI의 '생각 비용'을 385배 아낀다는 새 추론법",
    benefit: "추론 효율 385배 주장",
    context:
      "요즘 AI는 어려운 문제를 풀 때 오래 '생각'하느라 계산 비용이 많이 들거든요. 그래서 더 싸게 생각하는 방법을 찾는 연구가 활발해요.",
    what:
      "'Energy-Based Reasoners: 385배 더 효율적인 추론'이라는 연구 페이지가 해커뉴스에서 300점 넘게 받았어요.",
    analogy: "모든 길을 다 걸어 보는 대신, 지도에서 낮은 곳으로 공이 굴러가듯 답을 찾아가는 방식이라고 상상해 보세요.",
    why: "AI 사용료가 내려가려면 이런 '생각 다이어트' 연구가 쌓여야 해요.",
    caveats: "385배는 제목에 나온 숫자예요. 어떤 조건에서 잰 값인지는 원문에서 꼭 확인하세요.",
    terms: [{ term: "추론", easy: "AI가 질문을 받고 답을 만들어 내는 실제 작동 과정이에요." }],
    entities: [e("Energy-Based Reasoners", "technique", "inference", "efficiency")],
  }),
  card({
    id: "jeveration",
    platform: "huggingface",
    category: "research",
    url: "https://arxiv.org/abs/2611.24738",
    score: 25.36,
    at: "2026-11-18T00:00:00Z",
    difficulty: 3,
    hook: "그림 한 장 0.08초, 기존 통합 모델보다 최대 122배 빨라요",
    benefit: "이미지 생성 78ms",
    context:
      "이미지 AI는 보통 여러 단계를 거치며 그림을 조금씩 다듬거든요. 그래서 빠르게 만들기가 어려웠어요.",
    what:
      "Jeveration은 이미 학습된 시각-언어 모델을 그대로 활용해서, 단 한 번의 계산으로 이미지를 만들어요. 512×512 그림 하나를 78ms에 만들고, 기존 통합 모델보다 최대 122배 빠르대요.",
    analogy: "스케치하고 덧칠하고 고치는 대신, 머릿속 그림을 붓질 한 번에 '찰칵' 찍어내는 셈이에요!",
    why: "이미지 생성이 이 정도로 빨라지면, 타자 치는 동시에 그림이 바뀌는 실시간 디자인 도구가 더 흔해질 수 있어요.",
    caveats: "그림 품질은 '경쟁할 만한 수준'이라고 했어요. 최고 품질 모델보다 낫다는 뜻은 아니에요.",
    terms: [{ term: "ms", easy: "밀리초. 1초를 1,000으로 나눈 아주 짧은 시간이에요." }],
    entities: [e("Jeveration", "technique", "image-generation", "single-pass")],
  }),
  card({
    id: "tideway-moe",
    platform: "huggingface",
    category: "research",
    url: "https://arxiv.org/abs/2611.14848",
    score: 23.89,
    at: "2026-11-10T00:00:00Z",
    life: "warm",
    difficulty: 3,
    hook: "램 업그레이드 없이 집 PC로 큰 AI, 응답이 1.97배 빨라져요",
    benefit: "응답속도 평균 1.97배",
    context:
      "개인정보나 비용 때문에 큰 MoE 모델을 내 PC에서 돌리고 싶은 사람이 많거든요. 그런데 집 컴퓨터는 메모리가 부족해서 모델이 그래픽카드, 램, SSD에 흩어져요.",
    what:
      "TIDEWAY는 그래픽카드 메모리와 램을 하나의 큰 메모리처럼 묶어서 관리해요. 평가 결과 전체 응답 시간은 평균 1.97배, 첫 글자가 나오기까지의 시간은 2.40배 빨라졌대요. 허깅페이스 논문 순위에서 업보트 60개를 받았어요.",
    analogy: "물건이 방, 거실, 창고에 흩어져 있을 때, 자주 쓰는 걸 동선대로 다시 정리해서 집안일이 빨라진 거예요!",
    why: "언젠가 내 노트북에서도 큰 AI를 돌리는 날이 더 빨리 올 수 있어요.",
    caveats: "논문 속 실험 장비 기준 결과라, 내 PC에서 체감은 다를 수 있어요.",
    terms: [{ term: "MoE", easy: "여러 분야 전문가 AI 중 질문에 맞는 몇 명만 골라 부르는 방식이에요." }],
    entities: [e("TIDEWAY", "technique", "local-llm", "moe", "inference")],
  }),

  // ─────────────────────────────── video_audio · 영상·사운드 ───────────────────────────────
  card({
    id: "apple-fastframes",
    platform: "huggingface",
    category: "video_audio",
    url: "https://huggingface.co/apple/FastFrames-L",
    score: 28.55,
    at: "2026-11-16T17:21:04Z",
    difficulty: 2,
    hook: "애플도 글로 영상 만드는 AI를 허깅페이스에 공개했어요",
    context:
      "글을 쓰면 영상이 나오는 'text-to-video' 모델은 보통 구글, 오픈AI 같은 회사가 앞장서 왔거든요.",
    what:
      "애플의 FastFrames-L은 Wan2.1 T2V 14B 모델을 바탕으로 다듬은 텍스트-투-비디오 모델이에요. 관련 논문(arXiv 2611.23226)도 함께 연결돼 있어요.",
    analogy: "이미 잘 달리는 자동차 엔진을 가져와서, 애플이 자기 방식대로 튜닝한 차를 내놓은 거예요.",
    why: "애플도 영상 생성 AI 연구를 공개적으로 내놓고 있다는 신호라, 앞으로 애플 기기 속 AI 기능을 짐작해 볼 수 있어요.",
    caveats: "애플 전용 연구 라이선스(apple-amlr)라 상업적 사용은 제한될 수 있어요.",
    terms: [{ term: "텍스트-투-비디오", easy: "글로 장면을 설명하면 AI가 그걸 영상으로 만들어 주는 기술이에요." }],
    entities: [e("FastFrames-L", "model", "text-to-video"), e("Apple", "company", "big-tech"), e("Wan2.1", "model", "video-generation")],
  }),
  card({
    id: "haru-4b",
    platform: "huggingface",
    category: "video_audio",
    url: "https://huggingface.co/higurashi-ai/Haru-4B",
    score: 27.89,
    at: "2026-11-12T11:05:59Z",
    difficulty: 2,
    hook: "말 끊어도 바로 알아듣는 AI 목소리, 한국어까지 공개됐어요",
    benefit: "내 PC GPU로 구동",
    context:
      "대부분의 음성 AI는 내가 말을 끝내야 대답을 시작하거든요. 그래서 대화가 무전기처럼 느껴졌어요.",
    what:
      "Haru-4B는 듣기와 말하기를 동시에 하는 '풀 듀플렉스' 음성-투-음성 모델이에요. 한국어, 영어, 일본어 등 9개 언어를 지원하고, Apache 2.0으로 공개돼서 좋아요 1,400개를 넘겼어요.",
    analogy: "무전기처럼 '오버!' 하고 차례를 기다리는 대신, 전화처럼 자연스럽게 말이 겹쳐도 되는 대화예요.",
    why: "메모리 12GB 정도의 엔비디아 그래픽카드가 있으면 내 PC에서 웹 데모를 띄워 직접 말을 걸어 볼 수 있어요.",
    caveats: "연구용으로 공개된 기본 모델이에요. 목소리는 내가 쓸 권리가 있는 녹음으로만 넣어야 해요.",
    terms: [{ term: "풀 듀플렉스", easy: "전화 통화처럼 듣기와 말하기가 동시에 되는 방식이에요." }],
    entities: [e("Haru-4B", "model", "speech-to-speech", "full-duplex")],
  }),
  card({
    id: "tiny-voca",
    platform: "huggingface",
    category: "video_audio",
    url: "https://huggingface.co/n4ze3m/tiny-voca",
    score: 27.18,
    at: "2026-11-14T15:46:27Z",
    difficulty: 2,
    hook: "인터넷 없이 글 읽어주는 초경량 목소리 AI",
    benefit: "온디바이스 경량 TTS",
    context: "글을 목소리로 읽어 주는 TTS는 보통 모델이 커서 휴대폰이나 작은 기기에서 돌리기 어려웠거든요.",
    what:
      "tiny-voca는 영어 텍스트를 음성으로 바꿔 주는 작은 모델이에요. ONNX와 GGUF 형식으로 배포돼서 다양한 기기에서 돌리기 쉽고, 한 달 새 4,400번 넘게 다운로드됐어요.",
    analogy: "커다란 오디오 장비 대신 주머니에 쏙 들어가는 블루투스 스피커 같은 존재예요!",
    why: "인터넷 없이도 글을 읽어 주는 앱을 만들고 싶다면 가볍게 시작해 볼 수 있어요.",
    caveats: "지금은 영어만 지원해요.",
    terms: [{ term: "TTS", easy: "글자를 사람 목소리로 읽어 주는 기술(Text-to-Speech)이에요." }],
    entities: [e("tiny-voca", "model", "text-to-speech", "on-device")],
  }),
  card({
    id: "longcat-video-avatar",
    platform: "huggingface",
    category: "video_audio",
    url: "https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.6",
    score: 26.36,
    at: "2026-11-13T02:45:33Z",
    difficulty: 2,
    hook: "녹음 파일만 있으면 말하는 아바타 영상이 나와요",
    benefit: "MIT 라이선스 무료",
    context: "말하는 사람 영상을 만들려면 원래 촬영, 녹음, 편집이 다 필요했거든요.",
    what:
      "중국 메이퇀의 LongCat-Video-Avatar-1.6은 음성(과 이미지·텍스트)을 넣으면 그에 맞춰 말하는 아바타 영상을 만들어요. 이어지는 영상 생성도 지원하고 MIT 라이선스로 공개됐어요.",
    analogy: "녹음 파일을 주면 사진 속 인물이 그 말에 맞춰 입을 움직이는 '움직이는 액자' 같은 거예요.",
    why: "강의나 안내 영상을 만들 때 촬영 부담을 크게 줄일 수 있어요.",
    caveats: "실존 인물 얼굴로 영상을 만들 땐 반드시 당사자 동의가 필요해요.",
    terms: [{ term: "MIT 라이선스", easy: "\"출처만 밝히면 마음대로 써도 돼요\"라고 적어 둔 너그러운 사용 허락서예요." }],
    entities: [e("LongCat-Video-Avatar-1.6", "model", "avatar", "video-generation"), e("Meituan", "company", "big-tech")],
  }),
  card({
    id: "inworld-voice-isolator",
    platform: "huggingface",
    category: "video_audio",
    url: "https://huggingface.co/inworld/voice-isolator",
    score: 24.56,
    at: "2026-11-14T02:14:35Z",
    difficulty: 2,
    hook: "카페 소음 낀 녹음, 목소리만 쏙 뽑아내요",
    benefit: "실시간 잡음 제거",
    context: "녹음할 때 에어컨 소리, 키보드 소리가 같이 들어가면 듣기 힘들거든요.",
    what:
      "Inworld의 voice-isolator는 잡음을 지우고 사람 목소리만 남겨 주는 모델이에요. 48kHz 고음질을 지원하고 실시간 스트리밍으로도 쓸 수 있어요. Apache 2.0으로 공개됐어요.",
    analogy: "시끌벅적한 파티장에서 친구 목소리만 또렷하게 들리게 해 주는 마법 귀마개예요!",
    why: "팟캐스트, 온라인 회의 녹음, 유튜브 내레이션을 정리할 때 바로 쓸모가 있어요.",
    terms: [{ term: "실시간 스트리밍", easy: "파일을 다 받을 때까지 기다리지 않고 들어오는 대로 바로 처리하는 방식이에요." }],
    entities: [e("voice-isolator", "model", "noise-suppression"), e("Inworld", "company", "voice-ai")],
  }),
  card({
    id: "zonos3-mini",
    platform: "huggingface",
    category: "video_audio",
    url: "https://huggingface.co/Zyphra/ZONOS3-Mini",
    score: 23.89,
    at: "2026-11-09T05:03:57Z",
    life: "warm",
    difficulty: 2,
    hook: "한 달 11만 번 받힌 목소리 AI, 여러 언어로 읽어줘요",
    benefit: "다국어 음성 합성",
    context: "AI가 글을 읽어 주는 TTS는 이제 목소리 흉내까지 내는 단계로 왔거든요.",
    what:
      "Zyphra의 ZONOS3-Mini는 여러 언어를 지원하는 TTS 모델로, 목소리 복제 기능도 있어요. 한 달 새 11만 번 넘게 다운로드됐어요.",
    why: "오디오북이나 영상 내레이션을 직접 만들어 보고 싶다면 많이 쓰이는 출발점이에요.",
    caveats: "목소리 복제는 반드시 본인 목소리나 허락받은 목소리로만 쓰세요.",
    terms: [{ term: "목소리 복제", easy: "짧은 녹음만으로 그 사람 말투와 음색을 흉내 내는 기술이에요." }],
    entities: [e("ZONOS3-Mini", "model", "text-to-speech", "voice-cloning"), e("Zyphra", "company", "voice-ai")],
  }),

  // ─────────────────────────────── image_design · 이미지·디자인 ───────────────────────────────
  card({
    id: "comfyui-0-46",
    platform: "comfyui",
    category: "image_design",
    url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.46.0",
    score: 24.29,
    at: "2026-11-18T22:55:32Z",
    difficulty: 2,
    hook: "ComfyUI 업데이트, 최신 이미지 모델을 블록 하나로 연결",
    benefit: "MiniMax H3 노드 추가",
    context:
      "ComfyUI는 이미지·영상 AI 기능을 레고 블록(노드)처럼 이어 붙여 쓰는 도구거든요. 새 블록이 추가되면 할 수 있는 일이 늘어나요.",
    what:
      "v0.46.0에서 MiniMax H3 Image 노드와 LTX 영상용 업스케일·리프레임 노드 등이 추가됐어요. 워크플로 템플릿도 업데이트됐고, DirectML 지원은 빠졌어요.",
    analogy: "레고 세트에 새로 나온 부품 봉지가 하나 더 들어온 거예요!",
    why: "ComfyUI를 쓰고 있다면 최신 이미지 모델을 별도 설치 없이 블록으로 바로 끌어다 쓸 수 있어요.",
    caveats: "DirectML 지원이 빠졌으니, 그 방식으로 쓰던 윈도우 사용자는 업데이트 전에 확인하세요.",
    terms: [{ term: "노드", easy: "기능 하나가 담긴 블록이에요. 선으로 이어서 작업 순서를 만들어요." }],
    entities: [e("ComfyUI", "tool", "workflow", "image-generation"), e("MiniMax H3 Image", "model", "image-generation")],
  }),
  card({
    id: "civitai-inpaint-workflow",
    platform: "civitai",
    category: "image_design",
    url: "https://civitai.com/models/128556",
    score: 23.22,
    at: "2026-11-18T18:38:19Z",
    difficulty: 2,
    hook: "그림 전체 말고 망친 부분만 다시: 인페인팅 워크플로",
    benefit: "부분 수정 워크플로",
    context:
      "AI 그림에서 손가락 하나, 배경 한 구석만 고치고 싶을 때가 많거든요. 이렇게 일부만 다시 그리는 걸 '인페인팅'이라고 해요.",
    what:
      "Civitai에 올라온 ComfyUI 인페인팅 워크플로가 MOSS Image 모델용으로 업데이트됐어요. 사용 가이드도 함께 있고, 2만 4천 번 넘게 다운로드됐어요.",
    analogy: "사진 전체를 다시 찍는 대신, 지우개로 한 군데만 지우고 다시 그리는 거예요!",
    why: "이미 마음에 드는 그림을 망치지 않고 부분만 손보고 싶을 때 바로 따라 해 볼 수 있어요.",
    caveats: "AI Radar는 Civitai에서 안전 등급(PG/PG-13) 콘텐츠만 가져와요.",
    terms: [{ term: "인페인팅", easy: "그림의 일부분만 지우고 AI에게 그 부분을 새로 그리게 하는 기술이에요." }],
    entities: [e("ComfyUI", "tool", "workflow"), e("MOSS Image", "model", "image-generation")],
  }),
  card({
    id: "slack-moji",
    platform: "huggingface",
    category: "image_design",
    url: "https://huggingface.co/spaces/cfahlgren1/slack-moji",
    score: 22.46,
    at: "2026-11-16T16:52:00Z",
    difficulty: 1,
    hook: "설치 없이 브라우저에서, 말로 설명하면 이모지가 그려져요",
    benefit: "설치 없이 웹에서 체험",
    context: "팀 메신저에서 쓸 나만의 이모지를 만들려면 보통 그림 실력이 필요했거든요.",
    what:
      "허깅페이스 Space 'Slack Moji'는 원하는 이모지를 글로 설명하면, 작은 AI 모델이 내 브라우저 안에서 바로 그려줘요.",
    analogy: "\"웃는 고양이 커피잔\" 하고 주문하면 즉석에서 스티커를 그려주는 길거리 화가 같아요!",
    why: "설치 없이 웹에서 바로 써 볼 수 있어서 이미지 AI 입문용 장난감으로 딱이에요.",
    caveats: "CC BY-NC 4.0 라이선스라 상업적 사용은 안 돼요.",
    terms: [{ term: "Space", easy: "허깅페이스에서 누구나 웹으로 바로 써 볼 수 있게 올려 둔 AI 데모 앱이에요." }],
    entities: [e("Slack Moji", "tool", "emoji", "in-browser")],
  }),
  card({
    id: "minimax-h3-image",
    platform: "huggingface",
    category: "image_design",
    url: "https://huggingface.co/MiniMaxAI/MiniMax-H3-Image",
    score: 26.78,
    at: "2026-11-03T06:34:36Z",
    life: "warm",
    difficulty: 2,
    hook: "그리기·바꾸기·고치기를 한 모델로, 한 달 76만 다운로드",
    benefit: "생성·편집 올인원",
    context: "이미지 AI는 '새로 그리기'와 '있는 그림 고치기'를 따로 하는 경우가 많았거든요.",
    what:
      "MiniMax-H3-Image는 글로 그림을 만들고, 이미지를 넣어 다른 이미지로 바꾸고, 이미지 편집까지 하는 모델이에요. 한 달 새 76만 번 가까이 다운로드됐고 좋아요도 1,600개를 넘었어요.",
    why: "인기가 높아서 ComfyUI 같은 도구에도 전용 블록이 생기는 등, 써 보기 쉬운 환경이 빠르게 갖춰지고 있어요.",
    caveats: "라이선스가 '기타(other)'로 표시돼 있어 상업적 사용 조건을 꼭 확인하세요.",
    terms: [{ term: "이미지 편집", easy: "이미 있는 그림에서 원하는 부분을 말로 바꿔 달라고 하는 기능이에요." }],
    entities: [e("MiniMax-H3-Image", "model", "text-to-image", "image-editing"), e("MiniMax", "company", "ai-lab")],
  }),
  card({
    id: "speridlabs-idol",
    platform: "huggingface",
    category: "image_design",
    url: "https://huggingface.co/speridlabs/idol",
    score: 22.58,
    at: "2026-10-28T15:55:17Z",
    life: "warm",
    difficulty: 2,
    hook: "사진 한 장을 돌려보는 3D로, 상업 이용도 되는 공개 모델",
    benefit: "Apache 2.0 3D 변환",
    context: "사진을 3D 모델로 바꾸는 기술은 게임, 쇼핑, 메타버스 분야에서 수요가 많거든요.",
    what:
      "speridlabs의 idol은 이미지를 3D로 바꿔 주는 모델이에요. '가우시안 스플래팅' 방식을 쓰고 Apache 2.0으로 공개됐어요. 좋아요가 2,400개를 넘었어요.",
    analogy: "사진 속 물체를 수많은 반투명 색 구슬로 다시 쌓아 입체로 만드는 방식이에요!",
    why: "쇼핑몰 상품 사진을 돌려볼 수 있는 3D로 바꾸는 식으로 응용해 볼 수 있어요.",
    terms: [{ term: "가우시안 스플래팅", easy: "작고 흐릿한 색 점 수백만 개를 공간에 뿌려서 3D 장면을 표현하는 기술이에요." }],
    entities: [e("idol", "model", "image-to-3d", "gaussian-splatting")],
  }),

  // ─────────────────────────────── social · 커뮤니티·화제 ───────────────────────────────
  card({
    id: "emollick-element-names",
    platform: "bluesky",
    category: "social",
    url: "https://bsky.app/profile/emollick.bsky.social/post/3n2n3vjt7622m",
    score: 25.2,
    at: "2026-11-19T03:10:07Z",
    difficulty: 1,
    hook: "이 속도면 구글은 11월 24일에 원소 이름이 바닥난대요",
    context:
      "구글은 Gemini 4 모델들에 Carbon, Neon, Hydrogen 같은 원소 이름을 붙이고 있거든요. 출시 간격도 점점 짧아지고 있어요.",
    what:
      "와튼스쿨 이선 몰릭 교수가 블루스카이에 농담을 올렸어요. 출시 간격이 매번 절반씩 줄어드는 추세라면, 구글은 11월 24일에 원소 이름을 전부 써버리고 마지막 모델 '오가네손'을 낸다는 계산이에요.",
    analogy: "매번 절반씩 빨라지는 택배 배송을 계산해 보니 결국 '주문하기 전에 도착'한다는 개그 같은 거예요!",
    why: "AI 모델이 얼마나 숨 가쁘게 쏟아지고 있는지 웃으면서 체감할 수 있는 글이에요.",
    caveats: "어디까지나 농담 섞인 계산이에요.",
    entities: [e("Ethan Mollick", "platform", "commentary"), e("Gemini 4", "model", "llm")],
  }),
  card({
    id: "pelican-gemini-4",
    platform: "bluesky",
    category: "social",
    url: "https://bsky.app/profile/simonwillison.net/post/3n2nhnbueh22q",
    score: 23.42,
    at: "2026-11-19T06:40:15Z",
    difficulty: 1,
    hook: "같은 AI도 '얼마나 고민하냐'에 따라 그림이 달라져요",
    benefit: "AI 모델 비교 요령",
    context:
      "개발자 사이먼 윌리슨은 새 AI가 나올 때마다 '자전거 타는 펠리컨을 SVG로 그려줘'라고 시켜 보는 걸로 유명하거든요.",
    what:
      "이번엔 Gemini 4 Carbon, 새로 나온 Neon, Hydrogen을 각각 노력 수준(low·medium·high)별로 그려 보게 했대요. 그는 같은 모델 가족 안에서 차이를 보여주는 게 이 테스트의 가장 쓸모 있는 점이라고 했어요.",
    analogy: "같은 요리사에게 '대충', '보통', '정성껏' 세 번 요리를 시켜서 맛 차이를 비교하는 거예요!",
    why: "AI 서비스에 '빠르게/깊게 생각하기' 옵션이 있다면, 같은 질문으로 직접 비교해 보는 습관을 들여 보세요.",
    terms: [{ term: "SVG", easy: "점과 선을 숫자로 적어서 그리는 그림 형식이라, 글만 쓰는 AI도 그릴 수 있어요." }],
    entities: [e("Simon Willison", "platform", "llm-evaluation"), e("Gemini 4", "model", "llm")],
  }),
  card({
    id: "emollick-astra-uneven",
    platform: "bluesky",
    category: "social",
    url: "https://bsky.app/profile/emollick.bsky.social/post/3n2joens5t22x",
    score: 22.96,
    at: "2026-11-17T18:30:03Z",
    difficulty: 1,
    hook: "새 GPT 미리 써 본 교수 후기: 다루긴 까다로운데 큰일은 해낸다",
    context: "새 AI가 나오면 출시 전에 먼저 써 보는 사람들의 후기가 가장 빨리 퍼지거든요.",
    what:
      "이선 몰릭 교수는 출시 전 GPT-6.2 Astra를 써 보니 다른 모델보다 다루기 까다롭고 들쑥날쑥했대요. 그런데 '블렌더와 유니티로 우주 엘리베이터를 처음부터 만들어 줘' 같은 큰 프로젝트를 주자 결과물을 내놨다고 해요.",
    analogy: "말은 잘 안 듣는데, 큰 숙제를 맡기면 밤새 해 오는 천재 학생 같은 느낌이에요.",
    why: "새 모델을 고를 때 짧은 질문 몇 개만으로 판단하지 말고, 내가 실제로 맡길 큰 일로 시험해 보라는 힌트예요.",
    caveats: "한 사람의 사용 후기예요.",
    entities: [e("GPT-6.2 Astra", "model", "llm"), e("Ethan Mollick", "platform", "commentary")],
  }),
  card({
    id: "emollick-ai-gaming",
    platform: "bluesky",
    category: "social",
    url: "https://bsky.app/profile/emollick.bsky.social/post/3n2jbacjztk27",
    score: 24.11,
    at: "2026-11-17T14:34:59Z",
    difficulty: 1,
    hook: "게임만은 AI 없이 코딩한다? 교수는 '아니다'에 한 표",
    context: "게임 팬과 언론 사이에선 'AI로 만든 게임'에 대한 거부감이 꽤 크거든요.",
    what:
      "이선 몰릭 교수는 게임만 사람이 AI 도움 없이 코드를 짜는 유일한 분야로 남을 거라는 생각은 틀렸다고 했어요. 그런 압박 때문에 오히려 일하는 사람에게 힘이 되는 방향으로 AI 사용을 이끌 기회를 놓칠 수 있다고 걱정했어요.",
    why: "AI를 무조건 막을지 잘 쓸지 고민하는 건 게임뿐 아니라 내 업계에도 해당되는 질문이에요.",
    caveats: "한 연구자의 의견이에요.",
    entities: [e("Ethan Mollick", "platform", "commentary"), e("Game development", "technique", "ai-adoption")],
  }),
];

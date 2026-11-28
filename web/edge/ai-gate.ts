/**
 * AI 순도 게이트 — 종합 IT 소스(GeekNews·HN·V2EX·Juejin·Zenn·Lobsters 등)에서 AI 와 무관한 글을 걸러낸다.
 * Python worker/pipeline/ai_gate.py 와 같은 규칙:
 *   1) 제목에 강한 AI 신호가 있으면 통과
 *   2) 제목에 신호가 없는데 비AI 네거티브(디스크 정리·일반 보안 사건·하드웨어 등)가 보이면 탈락
 *   3) 그 외에는 본문 앞부분에 서로 다른 AI 신호가 2개 이상이어야 통과 (한 번 스치듯 'AI' 만 언급한 글 차단)
 */

const STRONG_SOURCES = [
  String.raw`\bA\.?I\b`, String.raw`\bAGI\b`, "artificial intelligence", String.raw`\bLLMs?`, String.raw`\bGPT`, "ChatGPT", "OpenAI", "Anthropic",
  "Claude", "Gemini", "DeepMind", String.raw`\bCopilot`, String.raw`\bCodex\b`, String.raw`\bLlama\b`, "Qwen", "DeepSeek", "Mistral", String.raw`\bKimi\b`,
  String.raw`\bGLM-?\d`, String.raw`\bGrok\b`, String.raw`\bxAI\b`, "Hugging ?Face", "Ollama", String.raw`\bvLLM`, String.raw`\bMCP\b`, String.raw`\bagentic\b`,
  String.raw`\bAI[- ]?agents?\b`, String.raw`\bcoding agents?\b`, String.raw`\bRAG\b`, "machine learning", "deep learning", "neural net", String.raw`\btransformers?\b`,
  "diffusion model", "Stable Diffusion", "Midjourney", String.raw`\bSora\b`, "fine-?tun", String.raw`\bLoRA\b`, String.raw`\bembeddings?\b`,
  "prompt (?:engineering|injection)", "system prompt", "multimodal", "chatbot", "foundation model", "language model", String.raw`\bNLP\b`,
  "computer vision", "reinforcement learning", String.raw`\bRLHF\b`, String.raw`[A-Za-z]Attention\b`, String.raw`\bGGUF\b`,
  String.raw`\bDify\b`, "LangChain", "LlamaIndex", "ComfyUI", "NotebookLM", "Perplexity", String.raw`\bWindsurf\b`,
  // 한국어
  "인공지능", "생성형", "에이전트", "챗봇", "챗GPT", "오픈AI", "앤트로픽", "앤스로픽", "클로드", "제미나이", "딥시크", "머신러닝", "딥러닝",
  "언어 ?모델", "파운데이션 모델", "신경망", "파인튜닝", "프롬프트", "멀티모달", "트랜스포머", "코파일럿",
  // 일본어
  "生成AI", "人工知能", "機械学習", "深層学習", "大規模言語モデル", "エージェント",
  // 중국어
  "人工智能", "大模型", "大语言模型", "智能体", "机器学习", "深度学习", "神经网络", "多模态", "提示词", "生成式", "AIGC", "推理模型",
];

const STRONG_RE = new RegExp(`(${STRONG_SOURCES.join("|")})`, "i");
const STRONG_RE_G = new RegExp(`(${STRONG_SOURCES.join("|")})`, "gi");

/** AI 와 무관한 일반 IT·보안·유틸리티·하드웨어 글의 단서 (제목에 AI 신호가 없을 때만 적용) */
export const NON_AI_RE =
  /(磁盘清理|디스크\s?정리|disk\s?clean|cleaner\b|文件搜索|파일\s?검색|压缩\s?PNG|PNG\s?압축|戒手机|锁机|폰\s?중독|랜섬웨어|ransomware|해킹\s?(?:그룹|조직|사건)|hacker\s?group|사이버\s?공격|cyber\s?-?attack|data\s?breach|개인정보\s?유출|정보\s?유출|CVE-\d|zero-?day|제로데이|기계식\s?키보드|mechanical\s?keyboard|그래픽\s?카드\s?(?:가격|리뷰)|SSD\s?(?:가격|리뷰))/i;

/** 종합 IT·커뮤니티 소스: 이 플랫폼 글만 게이트를 통과해야 실린다 (AI 전문 매체·공식 블로그는 면제) */
export const GATED_PLATFORMS = new Set([
  "geeknews", "hacker-news", "lobsters", "v2ex", "juejin", "zenn", "qiita", "hatena-bookmark", "pytorch-kr",
  "venturebeat-ai", "microsoft-research", "bluesky", "36kr-ai",
]);

export function isAiSignal(title: string, body = ""): boolean {
  if (STRONG_RE.test(title)) return true;
  const head = body.slice(0, 600);
  if (NON_AI_RE.test(`${title} ${head}`)) return false;
  const hits = new Set((head.match(STRONG_RE_G) ?? []).map((m) => m.toLowerCase()));
  return hits.size >= 2;
}

/** 이미 실린 아이템(엣지 행 등)을 다시 검사할 때 */
export function isAiItem(item: { platform_id?: unknown; original_title?: unknown; title_ko?: unknown; what_ko?: unknown; easy_summary_ko?: unknown }): boolean {
  if (!GATED_PLATFORMS.has(String(item.platform_id ?? ""))) return true;
  const title = String(item.original_title ?? item.title_ko ?? "");
  return isAiSignal(title, `${item.title_ko ?? ""} ${item.what_ko ?? item.easy_summary_ko ?? ""}`);
}

import type { EasyOriginal } from "@/lib/types";

import { KR_EASY_ORIGINAL } from "./sample-easy-original-kr";

/**
 * [원본 쉽게 읽기] 로컬 샘플 — 2026-11-19 에 실제 원문 페이지를 가져와 읽고 작성했다.
 * 원문을 가져올 수 있었던 8개 기사만 넣었다 (OpenAI 블로그 등 자동 접근이 막힌 곳은 제외).
 * 인용(quote)은 원문의 짧은 핵심 문장·수치만 원어 그대로 옮겼다.
 * DB 를 연결하면 이 파일 대신 /api/items/:id/easy-original 이 처음 요청 때 생성·캐싱한다.
 */
const GENERATED = "2026-11-19T10:00:00Z";
const MODEL = "hand-written sample (AI Radar editor)";

export const SAMPLE_EASY_ORIGINAL: Record<string, EasyOriginal> = {
  "sample-anthropic-ipo": {
    source_note: "Anthropic 공식 보도자료 전문 (짧은 공시형 글)",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "한 줄 요약: 공모가가 정해졌어요",
        body:
          "앤트로픽(정식 명칭은 공익법인 형태의 'Anthropic, PBC')이 처음으로 일반 투자자에게 주식을 파는 상장(IPO)을 하면서, 첫 판매 가격을 주당 83달러로 정했다는 공식 발표예요. 원문은 길지 않은 공시 형식의 글이라, 아래처럼 숫자 위주로 차근차근 읽으면 돼요.",
        quote: "priced its initial public offering of its Class A common stock at $83.00 per share",
      },
      {
        heading: "몇 주를, 누가 파나요?",
        body:
          "이번에 시장에 나오는 주식은 모두 9억 8천만 주예요. 그중 대부분인 약 9억 5,635만 주는 앤트로픽 회사가 직접 새로 파는 주식이고, 나머지 약 2,365만 주는 기존 주주 일부가 가지고 있던 주식을 파는 거예요. 기존 주주가 판 몫의 돈은 회사가 아니라 그 주주에게 간다고 분명히 적혀 있어요.",
        quote: "The offering consists of 980,000,000 shares",
      },
      {
        heading: "언제, 어디서 거래되나요?",
        body:
          "주식은 미국 나스닥(Nasdaq Global Select Market)에서 'ANT'라는 종목 기호로 11월 19일부터 거래가 시작될 예정이에요. 공모 절차 자체는 11월 20일에 마무리될 예정인데, 이건 '보통의 마감 조건을 충족하면'이라는 단서가 붙어 있어요.",
        quote: "under the symbol “ANT.”",
      },
      {
        heading: "추가 물량 옵션",
        body:
          "증권사(인수단)에게는 30일 안에 최대 1억 4,700만 주를 더 살 수 있는 권리도 줬어요. 상장 직후 수요가 많으면 시장에 풀리는 주식이 조금 더 늘어날 수 있다는 뜻이에요.",
        quote: "a 30-day option to purchase up to an additional 147,000,000 shares",
      },
      {
        heading: "법적 절차와 주의 문구",
        body:
          "이 상장은 미국 증권거래위원회(SEC)가 11월 18일에 등록 서류의 효력을 인정하면서 가능해졌어요. 주관사는 골드만삭스와 모건스탠리이고, 자세한 내용은 정식 투자설명서(prospectus)에 담겨요. 마지막 문단은 '이 발표 자체가 주식을 사라는 권유는 아니다'라는 표준 법률 문구예요.",
        quote: "declared effective by the Securities and Exchange Commission on November 18, 2026",
      },
    ],
    watch_points: [
      "원문은 짧은 공시라 첫 두 문단(가격·주식 수·거래 시작일)만 읽어도 핵심은 다 잡혀요.",
      "본문 중간의 증권사 주소·전화번호 문단과 마지막 법률 고지 문단은 건너뛰어도 괜찮아요.",
      "상단 'Related articles'의 로드쇼(roadshow) 기사를 함께 보면 상장 준비 과정이 이어져서 보여요.",
    ],
  },

  "sample-gemini-4-neon": {
    source_note: "Google 공식 블로그 'Introducing Gemini 4 Neon' 전문",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "도입: Neon은 어떤 모델인가요?",
        body:
          "구글은 Gemini 4 가족을 원소 이름으로 나눠 내놓고 있어요. 가장 어렵고 오래 걸리는 일은 Carbon, 빠른 일상 작업은 Hydrogen이 맡는다면, Neon은 그 사이에서 '깊게 생각하면서도 빠르고 싸게' 끝내는 쪽을 노린 모델이에요. 코딩, 사무 업무, 과학 계산까지 한 번에 맡기는 걸 목표로 했대요.",
        quote: "Neon balances depth and efficiency.",
      },
      {
        heading: "성적표: 남이 매긴 순위",
        body:
          "구글은 외부 평가 기관 점수를 많이 인용했어요. 여러 AI의 종합 지능을 비교하는 Artificial Analysis 지수에서 가장 깊게 생각하는 설정으로 61점, 전체 3위였고, 업무 능력을 보는 Vals 지수에선 2위였대요. 특히 '작업 중간에 사람이 방향을 바꿔도 잘 따라오는지'를 보는 평가에서 2위를 했다고 강조했어요.",
        quote: "#3 overall with a score of 61 on the Artificial Analysis Intelligence Index",
      },
      {
        heading: "가격과 '1백만 토큰' 기억력",
        body:
          "개발자가 쓸 때 가격은 입력 100만 토큰당 3달러, 출력 100만 토큰당 15달러예요. 같은 내용을 반복해서 넣는 '캐시'를 쓰면 입력 값이 95% 깎인 0.15달러가 돼요. 한 번에 약 100만 토큰 분량(책 여러 권)을 읽고 기억할 수 있어서 엑셀, PDF, 차트, 음성, 영상을 한꺼번에 넣고 보고서를 뽑는 데 쓰라고 해요.",
        quote: "$3 per million input tokens ($0.15 per million cached input tokens, a 95% discount)",
      },
      {
        heading: "데모: 이런 걸 만들었대요",
        body:
          "구글이 보여준 예시가 꽤 재미있어요. 실제 몽블랑 지형 위에서 타는 1인칭 스키 시뮬레이터를 처음부터 코드로 짜거나, 앨런 튜링의 1936년 연구실을 3D로 복원하거나, 이미지 하나를 수식 50만 개짜리 구글 시트로 바꿔 보이기도 했대요. 여러 개의 Hydrogen 보조 에이전트를 지휘하는 '반장' 역할도 할 수 있다고 해요.",
        quote: "10,200 lines of custom shaders",
      },
      {
        heading: "효율: 같은 일을 더 싸게",
        body:
          "Neon은 생각의 깊이를 4단계로 조절할 수 있어요. 기본 단계에선 큰형인 Carbon보다 작업당 비용이 32% 낮았고, 비슷한 최상위 경쟁 모델들과 비교하면 작업당 비용이 대략 50~80% 낮았다고 해요. 즉 '조금 덜 비싼 모델로 충분한 일'을 골라 쓰게 하려는 거예요.",
        quote: "a 32% lower cost per task than Carbon",
      },
      {
        heading: "보안·안전: 사이버 방어와 거짓말 줄이기",
        body:
          "보안 분야 전용 버전은 코드 취약점을 찾고, 정말 위험한지 확인하고, 고치는 과정까지 돕는대요. 안전 면에서는 결과를 지어내거나 꼼수를 쓰는 비율이 낮아졌다고 수치로 밝혔어요(코딩 꼼수 평가에서 2.45%). 웹페이지나 메일에 몰래 숨겨 둔 악성 지시(간접 프롬프트 인젝션)에도 잘 버텼다고 해요.",
        quote: "took shortcuts on just 2.45% of tasks on our coding cheating evaluation",
      },
      {
        heading: "어디서 쓸 수 있나요?",
        body:
          "개발자는 Google AI Studio의 유료 Gemini API로, 기업은 Gemini for business로 쓸 수 있어요. 일반 사용자는 구글 AI Pro·Ultra 구독자라면 제미나이 앱의 모델 선택 메뉴에서 Neon을 고를 수 있어요. 보안 전용 버전은 'Fairwind 프로그램'에 들어간 방어 담당자들에게 먼저 열려요.",
        quote: "select Gemini 4 Neon from the model drop-down in the Gemini app",
      },
    ],
    watch_points: [
      "원문의 벤치마크 이름(Vals, Terminal-Bench 등)은 몰라도 돼요. 각 문단 첫 문장과 '#1, #2' 순위만 훑어도 흐름이 잡혀요.",
      "중간의 데모 영상(스키 시뮬레이터, 튜링 연구실 3D)은 꼭 재생해 보세요. 숫자보다 실력이 훨씬 잘 보여요.",
      "맨 아래 'For consumers' 항목에서 내 구독 상태로 쓸 수 있는지 바로 확인할 수 있어요.",
    ],
  },

  "sample-google-ai-answers-traffic": {
    source_note: "RevScope 블로그 분석 글 전문 (여러 연구·데이터 인용)",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "도입: 'AI 요약이 클릭을 40% 가져간다'",
        body:
          "구글 검색 결과 맨 위에 AI가 답을 정리해 보여주는 'AI 개요(AI Overviews)'가 있죠. 이 글은 그 요약 때문에 사람들이 실제 웹사이트를 덜 누르게 됐는지를 여러 데이터로 따져 본 분석이에요. 결론부터 말하면, 요약이 뜨는 검색에선 바깥 웹사이트 클릭이 약 40% 줄었대요.",
        quote: "an Overview cuts clicks to outside websites by about 40%",
      },
      {
        heading: "AI 요약은 얼마나 자주 뜰까요?",
        body:
          "검색 데이터 회사 DataForSEO가 2천만 개 키워드를 매달 살펴봤더니, AI 요약이 뜨는 비율이 2024년 9월 5.93%에서 2026년 8월 61.43%로 늘었어요. 반대로 예전에 맨 위에 보이던 '발췌 답변'은 거의 사라졌고요. '정보를 찾는 검색'일수록 요약이 더 자주 떠서, 2026년 3분기엔 70%를 넘었대요.",
        quote: "climbed from 5.93% in September 2024 to 61.43% in August 2026",
      },
      {
        heading: "가장 믿을 만한 증거: 무작위 실험",
        body:
          "연구자 두 명이 미국 데스크톱 크롬 사용자들에게 확장 프로그램을 깔게 하고, 무작위로 한 그룹만 AI 요약을 숨겼어요. 2주 동안 실제 검색을 지켜보니, 요약이 보이는 그룹은 검색 한 번당 바깥 사이트 클릭이 0.37번, 숨긴 그룹은 0.62번이었어요. 아무 데도 안 누르고 끝나는 검색도 54%에서 73%로 늘었고요. 반면 광고 클릭은 그대로였대요.",
        quote: "averaged 0.37 clicks to outside websites per search, against 0.62",
      },
      {
        heading: "다른 데이터도 같은 방향",
        body:
          "미국 퓨 리서치 센터 조사에서도 요약이 있는 검색 화면에선 일반 링크를 누르는 비율이 8%, 없는 화면에선 15%였어요. 2천 개 넘는 웹사이트 데이터로 보면, 데스크톱 검색 1위 결과의 클릭률이 1년 사이 17.83%에서 7.43%로 58% 떨어졌대요.",
        quote: "fell from 17.83% in September 2025 to 7.43% in August 2026",
      },
      {
        heading: "대안이라는 GEO는 효과가 있을까요?",
        body:
          "업계는 'AI 답변에 내 글이 인용되게 만들자'는 GEO(생성형 엔진 최적화)를 대안으로 내세워요. 하지만 이 글은 GEO가 대부분 기존 검색 최적화(SEO)에 두 가지를 더한 수준이고, 아직 줄어든 방문을 메워 줄 방법은 보이지 않는다고 봤어요. 실제로 3월에 AI 비서들이 웹사이트로 보내 준 방문은 전체의 0.3%뿐이었대요.",
        quote: "in March AI assistants sent websites just 0.3% of their traffic",
      },
      {
        heading: "한계: 아직 확정은 아니에요",
        body:
          "핵심 실험은 아직 다른 학자들의 검토를 거치지 않은 논문이고, 데스크톱 검색만 다뤘어요. '사이트를 찾아가는 검색'이나 '바로 사려는 검색'은 표본이 작아서 결론을 못 냈고요. 그래도 별도의 사전 등록 실험에서도 요약을 없애면 클릭이 늘었다는 비슷한 결과가 나왔대요.",
        quote: "This is a working paper, not yet peer reviewed, and it covers desktop only.",
      },
    ],
    watch_points: [
      "원문 맨 위의 'AI 요약 노출 비율' 꺾은선 차트 하나만 봐도 2년 사이 변화가 한눈에 들어와요.",
      "'randomized experiment(무작위 실험)' 문단이 이 글에서 가장 믿을 만한 근거예요. 0.37 vs 0.62 숫자를 찾아보세요.",
      "업종별 비율 표에서 내 사업 분야(건강·금융·쇼핑 등)를 찾아보면 얼마나 영향받는지 감이 와요.",
    ],
  },

  "sample-windows-agent-telemetry": {
    source_note: "Xusheng Li 개인 블로그 분석 글 전문",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "발단: 윈도우 파일 속 수상한 목록",
        body:
          "글쓴이는 AI에게 최신 윈도우 시스템 파일을 함께 뒤져 보자고 했다가, 이상한 목록을 발견했어요. codex.exe, claude.exe, copilot.exe, cursor.exe 같은 코딩 AI 프로그램 이름과 python.exe, gcc.exe, code.exe 같은 개발 도구 이름이 'MissionControlAggregator.dll'이라는 윈도우 부품 안에 들어 있었던 거예요. '윈도우가 왜 이 목록을 갖고 있지?'가 이 글의 출발점이에요.",
        quote: "Why would a Windows system DLL need a list of coding agents and developer tools?",
      },
      {
        heading: "무엇을 기록하나요?",
        body:
          "분석해 보니 이 부품은 컴퓨터를 계속 감시하는 게 아니라, 윈도우가 원래 모으던 '어떤 앱이 실행됐는지' 기록을 받아서 프로그램 이름을 목록과 비교해요. 맞는 게 있으면 'Codex 썼음' 같은 표시만 한 칸 켜 둬요. 사용 시간이나 입력한 질문(프롬프트), 코드 내용은 버리고 '썼다/안 썼다'만 남긴다고 해요.",
        quote: "record only a bitmap of which agents were observed",
      },
      {
        heading: "직접 실험해서 확인",
        body:
          "글쓴이는 평범한 명령 프롬프트 프로그램(cmd.exe)을 codex.exe로 이름만 바꿔 실행해 봤어요. 그랬더니 윈도우가 진짜 Codex를 쓴 것처럼 기록했대요. 같은 방법으로 gcc.exe 이름을 붙여 보니 '컴파일러 사용' 칸이 켜졌고요. 이름만으로 판단한다는 게 확인된 거예요.",
        quote: "The name alone was enough for the component to recognize it as Codex.",
      },
      {
        heading: "정말 마이크로소프트로 보내지나요?",
        body:
          "기록을 남기는 것과 밖으로 보내는 건 다른 문제라서, 글쓴이는 윈도우 진단 서비스의 '업로드 대기열'까지 열어 봤어요. 이 기록은 '선택적 진단 데이터'로 분류되는데, 이 설정이 켜져 있으면 실제로 업로드 대기열에 들어가 있었대요. 그리고 그가 새로 설치한 미국 지역 설정의 윈도우 11에선 이 옵션이 기본으로 켜져 있었어요.",
        quote: "Optional diagnostic data is therefore enabled by default, at least in the US setup I tested.",
      },
      {
        heading: "끄는 방법",
        body:
          "설치할 때 선택적 진단 데이터를 거절하거나, 이미 설치했다면 설정 → 개인 정보 및 보안 → 진단 및 피드백에서 '선택적 진단 데이터 보내기'를 끄면 돼요. 마이크로소프트의 진단·개인정보 안내 문서에도 바꾸는 법이 나와 있어요.",
        quote: "Settings → Privacy & security → Diagnostics & feedback",
      },
    ],
    watch_points: [
      "중간의 Binary Ninja 화면, C++ 함수 이름, PowerShell 명령어는 전문가용이라 건너뛰어도 흐름을 놓치지 않아요.",
      "'copied cmd.exe to a file named codex.exe' 실험 문단이 이 글의 하이라이트예요. 여기만 읽어도 원리가 이해돼요.",
      "맨 마지막 문단의 설정 경로를 보고, 지금 내 PC 설정을 바로 확인해 보세요.",
    ],
  },

  "sample-claude-black-hole-physics": {
    source_note: "Anthropic 연구 블로그 'Claude Fable 5.2 solves two open problems…' 전문 (쉬운 설명 파트 위주)",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "무엇을 해냈나요?",
        body:
          "앤트로픽은 Claude Fable 5.2가 이론물리학의 미해결 문제 두 개를 풀었다고 발표했어요. 둘 다 블랙홀, 그리고 아직 아무도 완성하지 못한 '양자 중력' 이론과 관련된 문제예요. 첫째는 물리학자들이 20여 년 전에 계산 방법만 세워 두고 끝내지 못한 계산이고, 둘째는 양자 중력 후보 이론을 걸러내는 기법의 '정확한 한계선'을 찾는 문제였어요.",
        quote: "Claude has solved two open problems in theoretical physics.",
      },
      {
        heading: "배경: 왜 블랙홀이 시험대인가요?",
        body:
          "물리학에는 아주 큰 것(별, 은하)을 설명하는 일반상대성이론과 아주 작은 것(원자)을 설명하는 양자역학이 있는데, 둘은 수학적으로 잘 맞지 않아요. 블랙홀은 엄청난 질량이 아주 작은 공간에 몰려 있어서 두 이론이 동시에 필요한 드문 장소라, 둘을 합치는 이론을 시험하기에 딱 좋은 곳이에요.",
        quote: "they’re mathematically incompatible",
      },
      {
        heading: "첫 번째 문제: 물 끓듯 '갑자기' 블랙홀이 생길까?",
        body:
          "1983년 호킹과 페이지는 어떤 모형 우주를 뜨겁게 데우면, 어느 온도에서 입자 기체가 블랙홀로 '갑자기' 바뀐다는 걸 보였어요. 물이 100도에서 확 끓는 것처럼요. 그런데 이건 우주가 클 때만 맞는 계산이었어요. 우주가 아주 작아져 시공간 모양이 흐릿해지는 반대쪽 끝에서도 이 변화가 갑작스러운지, 아니면 서서히 일어나는지는 2003년에 계산법만 나오고 아무도 끝내지 못했대요.",
        quote: "In 2003, a group of physicists set out the calculation that would settle the question",
      },
      {
        heading: "Claude가 푼 방법",
        body:
          "이 계산은 수천 개의 항(다이어그램)을 다뤄야 해서 손으로는 불가능에 가까웠어요. Claude는 자기 복제본들로 작은 연구팀을 꾸리고, 거의 모든 부분을 두 에이전트가 따로 계산해 서로 맞춰 봤어요. 결과는 '이쪽 끝에서도 변화는 갑작스럽다'였어요. 큰 우주와 작은 우주 양쪽 모두에서 같은 급변이 나타난 거예요.",
        quote: "The result Claude found is an abrupt jump as the temperature rises",
      },
      {
        heading: "두 번째 문제: 가장 가벼운 블랙홀의 무게 상한",
        body:
          "공간이 2차원인 더 단순한 모형 우주에서, 물리학자들은 2009년부터 '틀린 이론을 걸러내는' 부트스트랩이라는 방법으로 가장 가벼운 블랙홀이 얼마나 무거울 수 있는지 상한선을 좁혀 왔어요. Claude는 다른 사람들이 놓친 수치 패턴을 발견하고, 다른 분야의 수학 기법을 빌려 와 가장 단순한 버전에서의 정확한 상한을 계산하고, 그보다 더 낮출 수 없다는 것도 증명했대요.",
        quote: "calculate the precise ceiling for the simplest version of this technique",
      },
      {
        heading: "어떻게 진행됐나요?",
        body:
          "한 연구원이 Claude에게 블랙홀 관련 흥미로운 미해결 문제 목록을 만들게 했더니 몇 시간 뒤 22개 후보를 가져왔고, 각 문제마다 에이전트를 붙여 약 6주 동안 배경에서 돌렸대요. 에이전트들은 서로의 진행 상황을 읽고 협업했어요. 첫 번째 문제는 나중에 다른 물리학자가 다른 방법으로 같은 답을 얻어서 서로 검증이 됐다고 해요.",
        quote: "The agents ran in the background, with no special setup, for about six weeks.",
      },
      {
        heading: "한계: 바로 쓸모가 있는 건 아니에요",
        body:
          "앤트로픽도 두 결과 모두 우리 우주를 직접 설명하지 않고, 당장 실생활 응용이 있는 것도 아니라고 분명히 밝혔어요. 다만 양자역학과 상대성이론을 맞추려는 오랜 노력에 한 조각을 보탰다는 의미예요.",
        quote: "Neither result describes our own universe directly, and neither has practical applications",
      },
    ],
    watch_points: [
      "원문은 '쉬운 설명 → 기술적 설명' 순서예요. 앞부분 쉬운 설명만 읽고, 중간의 수식·이론 이름이 나오면 건너뛰어도 괜찮아요.",
      "뉴욕 펜역에서 하이라인까지 '두 길을 동시에 가는 입자' 그림과 이중 슬릿 그림은 꼭 보세요. 양자역학 감이 확 와요.",
      "'Hawking-Page 온도' 그래프에서 기체와 블랙홀이 자리를 바꾸는 지점을 찾아보면 첫 번째 문제가 한눈에 이해돼요.",
    ],
  },

  "sample-tideway-moe": {
    source_note: "arXiv 2611.14848 논문 HTML 전문 (초록·서론·설계·평가·결론)",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "초록: 이 논문의 한 줄",
        body:
          "집에 있는 일반 PC에서 거대한 MoE(전문가 혼합) AI 모델을 돌릴 때, 그래픽카드 메모리와 컴퓨터 램을 '하나의 큰 창고'처럼 묶어 관리하면 훨씬 빨라진다는 논문이에요. 저자들은 이 시스템을 TIDEWAY라고 불러요. 평균적으로 전체 응답은 1.97배, 첫 글자가 나오기까지의 시간은 2.40배 빨라졌대요.",
        quote: "achieves speedups of 1.97x in end-to-end latency and 2.40x in Time-to-First-Token",
      },
      {
        heading: "서론: 왜 집 PC에서 돌리려 할까요?",
        body:
          "요즘 AI 에이전트는 대부분 클라우드 API로 돌아가요. 그런데 개인정보 보호나, 오래 대화할수록 쌓이는 토큰 비용 때문에 내 PC에서 직접 돌리고 싶은 수요가 커졌어요. MoE 모델은 질문마다 일부 전문가만 깨워 써서 집 PC에도 희망이 보이지만, 모델 전체 크기는 여전히 커서 그래픽카드 메모리(VRAM)에 다 안 들어가요. 그래서 남는 부분이 램, 심하면 SSD까지 흘러넘쳐요.",
        quote: "weights spill beyond VRAM into host RAM and, when the combined memory budget is insufficient, extend to SSD",
      },
      {
        heading: "문제: 어디에 둘지가 속도를 결정해요",
        body:
          "어떤 전문가가 필요한지는 질문이 들어와야 정해져요. 그래서 필요한 전문가가 VRAM에 없으면 그때마다 램이나 SSD에서 가져오느라 멈칫해요. 특히 긴 질문을 처음 읽는 단계(프리필)에선 거의 모든 전문가가 깨어나서, 첫 글자가 나오기 전에 모델 전체를 옮겨 오느라 오래 걸려요. 기존 도구들은 VRAM과 램을 따로따로 관리해서 이 문제를 제대로 못 풀었대요.",
        quote: "none of these systems treats the constrained GPU and host memory as a unified pool",
      },
      {
        heading: "핵심 원리 ①: 하나로 묶은 메모리 창고",
        body:
          "TIDEWAY는 VRAM과 램을 하나의 메모리 풀로 다뤄요. 같은 전문가를 VRAM과 램에 중복으로 두는 낭비를 줄여서, 더 많은 '서로 다른 전문가'를 빠른 곳에 둘 수 있게 했어요. 그리고 '처음 읽는 단계'와 '한 글자씩 답하는 단계(디코드)'는 전문가를 쓰는 패턴이 다르니까, 단계마다 배치를 바꿔요.",
        quote: "Tideway unites GPU VRAM and host RAM into a unified memory pool",
      },
      {
        heading: "핵심 원리 ②: 기다리지 않는 실행 엔진",
        body:
          "전문가를 옮겨 오는 동안 계산이 멈추지 않도록, 긴 질문을 조각내 '옮기면서 동시에 계산'하는 흐름(스트리밍 프리필)을 만들었어요. 또 그래픽카드 작업을 미리 녹화해 두고 빠르게 재생하는 기술(CUDA Graph)을, 전문가가 수시로 들락날락하는 상황에서도 쓸 수 있게 조각 단위로 고쳤대요.",
        quote: "a streaming prefill pipeline and piecewise CUDA Graph replay under expert paging",
      },
      {
        heading: "실험 결과",
        body:
          "대표적인 소비자용 하드웨어와 최신 MoE 모델로 기존 최고 수준 시스템과 비교했더니, 고정된 작업에선 평균 1.97배, 실제 에이전트처럼 여러 번 주고받는 대화 기록에선 최대 3.14배 빨랐대요.",
        quote: "up to 3.14× speedup on multi-turn agent traces",
      },
      {
        heading: "의미와 한계",
        body:
          "많은 사람에겐 16~64GB 램이면 평소 쓰기에 충분한데, AI 하나 돌리자고 램을 수백 GB로 늘리는 건 큰 지출이에요. 이 논문은 '장비를 늘리는 대신 메모리 정리를 똑똑하게' 하는 길을 보여줘요. 다만 결과는 논문 속 실험 장비 기준이라, 내 PC에서의 체감은 다를 수 있어요.",
        quote: "a capable GPU and 16–64 GiB of system RAM are sufficient for everyday computing",
      },
    ],
    watch_points: [
      "섹션 4·5의 설계 설명은 개발자용이에요. 처음엔 초록(Abstract)과 1장 서론, 9장 결론만 읽어도 핵심은 다 잡혀요.",
      "6.1절 'End-to-End Performance'의 막대그래프에서 TIDEWAY 막대가 다른 시스템보다 얼마나 짧은지(빠른지) 보세요.",
      "2장의 '소비자 PC 메모리 구조' 그림을 보면 VRAM·램·SSD 계층이 한눈에 정리돼요.",
    ],
  },

  "sample-vllm-0-34": {
    source_note: "GitHub 릴리스 노트 vLLM v0.34.0 (TL;DR·업그레이드 주의·신규 모델·주요 변경)",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "개요: 412명이 만든 업데이트",
        body:
          "vLLM은 회사들이 AI 모델을 많은 사람에게 동시에 서비스할 때 쓰는 오픈소스 엔진이에요. 이번 v0.34.0에는 412명의 기여자(그중 120명은 처음 참여)가 만든 1,061개의 변경이 들어갔어요.",
        quote: "1,061 commits from 412 contributors (120 new)",
      },
      {
        heading: "가장 큰 변화: 메모리를 '실제로 남은 만큼' 쓰기",
        body:
          "AI 서버는 대화 내용을 기억하는 'KV 캐시'를 그래픽카드 메모리에 잡아 둬요. 예전엔 '메모리의 몇 %를 쓸지'를 사람이 짐작해서 정해야 했는데, 이제는 준비가 다 끝난 뒤 실제로 비어 있는 메모리를 재서 캐시 크기를 정해요. 그래서 대부분의 모델에서 캐시가 커지고 처리량이 늘었대요. 예를 들어 H200 GPU의 MiniMax-M3는 43만 3천 토큰에서 67만 2천 토큰으로 늘었어요.",
        quote: "MiniMax-M3 on H200: 433k → 672k tokens",
      },
      {
        heading: "공짜는 아니에요: 트레이드오프",
        body:
          "캐시를 키우면 동시에 많은 요청을 받을 땐 유리하지만, 일부 모델에선 한 글자씩 답하는 속도가 6~18% 느려질 수 있대요. 원래 방식이 더 맞는다면 설정 한 줄로 끌 수 있게 해 뒀어요.",
        quote: "TPOT +6–18% on some H200 models at concurrency 128",
      },
      {
        heading: "속도 향상",
        body:
          "엔비디아 블랙웰과 AMD MI355X 같은 최신 GPU에서 크게 빨라졌어요. 한 글자씩 답하는 디코딩이 최대 1.95배, 전체 처리량이 최대 1.6배, 긴 질문의 첫 글자 시간이 1.24~1.40배 빨라졌대요.",
        quote: "up to 1.95× decode (Step5 on GB200), 1.6× throughput",
      },
      {
        heading: "새로 지원하는 모델 10개",
        body:
          "전체 1조 개 파라미터 중 520억 개만 깨워 쓰는 Mistral Large 4, 음성을 글로 받아 적는 Nemotron-3.5-Transcribe, 에이전트 코딩용 Ripple-65B Preview 등 10개 모델을 새로 돌릴 수 있게 됐어요.",
        quote: "Mistral Large 4 | 1T total / 52B active",
      },
      {
        heading: "업그레이드 전에 꼭 확인할 것",
        body:
          "기존 설정이 깨질 수 있는 변경이 있어요. 예전 실행 엔진(Model Runner V1)이 완전히 사라졌고, 기본 블록 크기가 16에서 64로 바뀌었고, ROCm 7.2 이미지는 더 이상 나오지 않아요. 또 huggingface_hub 2.0.0 이상이 필요해요. 운영 중이라면 릴리스 노트의 'Before you upgrade' 표를 먼저 보세요.",
        quote: "Model Runner V1 is gone.",
      },
    ],
    watch_points: [
      "맨 위 'TL;DR' 다섯 줄과 'Before you upgrade' 표만 읽으면 이번 버전의 90%가 정리돼요.",
      "PR 번호(#63373 같은)와 커널 이름이 잔뜩 나오는 'Full Changelog'는 운영자가 아니면 건너뛰어도 돼요.",
      "'Extensible KV cache' 문단의 433k → 672k 숫자가 이번 업데이트를 가장 잘 보여주는 장면이에요.",
    ],
  },

  "sample-haru-4b": {
    source_note: "Hugging Face 모델 카드(README) 전문",
    generated_at: GENERATED,
    model: MODEL,
    sections: [
      {
        heading: "한 줄 소개",
        body:
          "Haru-4B는 사람처럼 듣는 동시에 말하는 '풀 듀플렉스' 음성 대화 모델이에요. 전화 통화하듯 말이 겹쳐도 대화가 이어지게 만드는 게 목표예요. 연구용으로 공개된 기본(사전학습) 모델이라, 바로 완성된 앱이라기보단 이걸 바탕으로 다른 걸 만드는 재료에 가까워요.",
        quote: "it listens and speaks at the same time, the way people do on a phone call",
      },
      {
        heading: "핵심 원리 ①: 0.133초마다 듣고 말하기",
        body:
          "모델은 133밀리초(약 0.13초)마다 사용자 목소리 한 조각을 듣고, 동시에 자기 목소리와 글 한 조각을 만들어요. 듣기와 말하기를 같은 자리에 더해서 처리하니까, 서로 차례를 기다리지 않아요.",
        quote: "Every 133 ms the model takes one frame of the user's audio",
      },
      {
        heading: "핵심 원리 ②: 소리를 한 번에 만들어요",
        body:
          "보통 음성 AI는 소리를 잘게 쪼갠 '토큰'으로 바꿔서 여러 단계로 만들어요. Haru는 소리를 연속된 숫자 묶음으로 다루고, 작은 추가 장치가 한 번의 계산으로 소리를 만들어 내서 지연이 줄었대요.",
        quote: "there is no separate audio transformer and there are no discrete audio tokens",
      },
      {
        heading: "캐릭터·목소리 바꾸기와 지원 언어",
        body:
          "글로 쓴 '캐릭터 카드'로 성격을 정하고, 짧은 녹음 한 개로 목소리를 정해요. 한국어를 포함해 영어, 스페인어, 포르투갈어, 독일어, 프랑스어, 중국어, 일본어, 러시아어까지 9개 언어를 지원해요.",
        quote: "A text card sets the character, a short reference clip sets the voice.",
      },
      {
        heading: "직접 써 보려면",
        body:
          "메모리 12GB 정도의 엔비디아 그래픽카드가 있으면, 코드 저장소를 받아 서버를 켜고 브라우저(localhost:8998)에서 캐릭터를 고르고 바로 말을 걸 수 있어요. 지연을 줄이려면 블루투스 대신 유선 헤드폰·마이크를 권장해요(블루투스는 0.1초 이상 더 늦어진대요). 맥용 앱과 vLLM 서빙 플러그인도 함께 제공돼요.",
        quote: "With an NVIDIA GPU (about 12 GB of memory)",
      },
      {
        heading: "주의할 점: 목소리 권리",
        body:
          "Haru에는 기본 목소리가 들어 있지 않아서, 3초~3분 길이의 깨끗한 한 사람 목소리 녹음을 직접 넣어야 해요. 모델 카드는 '쓸 권리가 있는 목소리만 쓰라'고 분명히 적어 뒀어요.",
        quote: "Only use voices you have the right to use.",
      },
    ],
    watch_points: [
      "모델 카드 상단의 구조 그림(architecture.svg)에서 '듣기·말하기·글'이 한 칸에 더해지는 모습을 보면 원리가 한 번에 이해돼요.",
      "'Usage' 아래 명령어 세 줄이 설치의 전부예요. 그래픽카드가 없다면 이 부분은 건너뛰고 기술 블로그 링크를 보세요.",
      "맨 위 'Technical blog' 링크(일본어판도 있어요)에 구조 설명이 더 자세히 있어요. 설치 전에 먼저 읽어 보면 좋아요.",
    ],
  },
};

// 🇰🇷 국내 기술 아티클 완독 해설 3편 (6개 권역 확장, 2026-11-20)
Object.assign(SAMPLE_EASY_ORIGINAL, KR_EASY_ORIGINAL);

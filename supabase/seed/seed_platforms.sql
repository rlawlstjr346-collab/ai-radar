-- =============================================================================
-- AI Radar · seed_platforms.sql
-- 글로벌 AI 플랫폼 도감 26개 (자동 수집 active 10 + directory_only 16) + sources 초기 데이터
-- 실행 순서: 001_init → 002 → 003_categories_and_hourly_rotation → 이 파일 (7개 카테고리 사용)
--
-- 재실행 안전(idempotent):
--   - platforms: 소개 문구/URL/색은 최신 시드로 덮어쓰되, collect_status 는 덮어쓰지 않음
--                (운영 중 paused 로 바뀐 상태를 시드 재실행이 되살리지 않도록)
--   - sources  : endpoint/method/카테고리만 갱신, is_enabled·fail_count·last_success_at 은 보존
-- =============================================================================

begin;

insert into public.platforms
  (id, name, category, one_liner_ko, why_visit_ko, url, theme_color, access_note, collect_status)
values

-- ─────────────────────────────────────────────────────────────────────────────
-- [A] 자동 수집 플랫폼 (active · 10개)
-- ─────────────────────────────────────────────────────────────────────────────

-- dev ─────────────────────────────────────────
('huggingface', 'Hugging Face', 'dev',
 '전 세계 AI 개발자들이 만든 모델을 무료로 구경하고 써보는 AI계의 깃허브예요!',
 '새로 나온 AI 모델이 거의 다 여기에 제일 먼저 올라오거든요. 코딩을 몰라도 "Spaces"에서 남이 만든 AI 데모를 버튼 몇 번으로 직접 돌려볼 수 있어요.',
 'https://huggingface.co', '#FFD21E',
 '구경은 무료·로그인 없이 가능해요. 일부 모델 다운로드나 Spaces 사용엔 무료 회원가입이 필요할 수 있어요.',
 'active'),

('hacker-news', 'Hacker News', 'dev',
 '실리콘밸리 개발자들이 매일 "오늘 뭐가 제일 흥미롭냐"를 투표로 정하는 동네 게시판이에요.',
 'AI 신기술이 진짜 쓸 만한지, 개발자들이 댓글로 냉정하게 뜯어보는 곳이거든요. 홍보 글 말고 현업 사람들의 솔직한 반응을 보고 싶을 때 딱이에요.',
 'https://news.ycombinator.com', '#FF6600',
 '로그인 없이 무료로 읽을 수 있어요. 전부 영어고 디자인이 2000년대 느낌이라 처음엔 당황할 수 있어요.',
 'active'),

('github', 'GitHub', 'dev',
 '전 세계 오픈소스 코드가 모이는 거대한 창고예요. AI 도구들의 "업데이트 소식지"도 여기서 나와요.',
 'vLLM, Transformers 같은 AI 핵심 도구들이 새 버전을 낼 때마다 여기에 변경 내역을 올리거든요. "요즘 오픈소스 AI가 어디까지 왔나"를 가장 빨리 확인할 수 있는 곳이에요.',
 'https://github.com', '#8B949E',
 '구경은 로그인 없이 무료예요. 코드를 직접 내려받아 돌리려면 약간의 개발 지식이 필요해요.',
 'active'),

('ollama', 'Ollama', 'dev',
 '챗GPT 같은 AI를 인터넷 없이 내 컴퓨터에서 바로 돌려주는 "AI 전용 앱 설치기"예요.',
 '명령어 한 줄이면 Llama, Qwen, Gemma 같은 공개 AI 모델을 내 PC에 깔아서 쓸 수 있거든요. 내 대화가 외부 서버로 안 나가니까 개인정보가 걱정될 때 특히 좋아요.',
 'https://ollama.com', '#E5E7EB',
 '완전 무료예요(맥·윈도우·리눅스). 큰 모델일수록 메모리(RAM)와 그래픽카드 사양을 많이 먹어요.',
 'active'),

-- research ────────────────────────────────────
('openai', 'OpenAI', 'industry',
 '챗GPT를 만든 바로 그 회사예요. 새 모델이 나오면 공식 블로그에 제일 먼저 자랑하러 와요.',
 'GPT 시리즈나 새 기능 소식의 "원본 출처"가 여기거든요. 기사로 한 번 걸러진 이야기 말고, 회사가 직접 뭐라고 했는지 확인하고 싶을 때 가봐요.',
 'https://openai.com/news', '#10A37F',
 '블로그는 로그인 없이 무료로 읽을 수 있어요. 영어지만 그림과 데모 영상이 많아서 생각보다 볼 만해요.',
 'active'),

('anthropic', 'Anthropic', 'industry',
 'AI 비서 "Claude"를 만드는 연구소예요. AI를 안전하게 만드는 연구로도 유명하거든요.',
 '새 Claude 모델 소식뿐 아니라 "AI 속은 어떻게 생각할까?" 같은 신기한 연구 글이 자주 올라와요. AI가 왜 그렇게 대답하는지 궁금했던 사람에게 특히 재밌어요.',
 'https://www.anthropic.com/news', '#D97757',
 '뉴스·연구 글은 로그인 없이 무료로 읽을 수 있어요. 영어지만 연구 글에 그림 설명이 많아서 따라가기 좋아요.',
 'active'),

('google-deepmind', 'Google DeepMind', 'research',
 '바둑 AI 알파고를 만든 구글의 AI 연구소예요. Gemini도 여기서 나왔어요!',
 '단백질 구조 예측(알파폴드)처럼 과학 자체를 바꾸는 연구가 종종 터지는 곳이거든요. "AI로 이런 것까지 해?" 싶은 소식을 원본으로 볼 수 있어요.',
 'https://deepmind.google', '#4285F4',
 '블로그는 로그인 없이 무료예요. 논문 링크가 많지만 블로그 본문만 읽어도 충분히 이해돼요.',
 'active'),

-- creative ────────────────────────────────────
('comfyui', 'ComfyUI', 'image_design',
 '이미지·영상 AI를 레고 블록처럼 선으로 이어 붙여 나만의 그림 공장을 만드는 도구예요.',
 '고수들이 "이 그림 어떻게 만들었어?"라고 물으면 대부분 ComfyUI 작업 파일을 공유하거든요. 처음엔 복잡해 보여도, 남이 만든 블록 배치를 불러오기만 해도 바로 따라 해볼 수 있어요.',
 'https://www.comfy.org', '#FACC15',
 '오픈소스라 무료예요. 내 PC에서 돌리려면 그래픽카드(GPU)가 꽤 좋아야 해요.',
 'active'),

('civitai', 'Civitai', 'image_design',
 '사람들이 직접 학습시킨 그림체 AI 모델을 서로 나누는 거대한 "그림체 장터"예요.',
 '"지브리풍", "수채화풍"처럼 특정 화풍만 쏙 입힌 작은 모델(LoRA)이 수십만 개 있거든요. 이미지 AI에 관심이 생겼다면 요즘 사람들이 뭘 만드는지 구경만 해도 공부가 돼요.',
 'https://civitai.com', '#1971C2',
 '구경은 무료예요. 성인 콘텐츠가 섞여 있는 사이트라, 가입 후 설정에서 안전 필터를 꼭 켜두세요. (AI Radar는 안전 등급 콘텐츠만 가져와요)',
 'active'),

-- social ──────────────────────────────────────
('bluesky', 'Bluesky', 'social',
 '트위터(X)를 떠난 AI 연구자들이 많이 모여 있는, 하늘색 나비 로고의 새 SNS예요.',
 '유명 AI 연구자들이 논문 뒷이야기나 업계 소문을 가볍게 털어놓는 곳이거든요. 공식 발표보다 한 발 빠른 "현장 분위기"를 엿볼 수 있어요.',
 'https://bsky.app', '#1185FE',
 '무료예요. 일부 글은 로그인 없이 볼 수 있지만, 피드를 제대로 보려면 가입하는 게 편해요.',
 'active'),

-- ─────────────────────────────────────────────────────────────────────────────
-- [B] 도감 전용 알짜 사이트 (directory_only · 12개)
--     스크래핑 금지/유료 API/공식 피드 부재로 수집하지 않고 도감에만 노출
-- ─────────────────────────────────────────────────────────────────────────────

-- dev ─────────────────────────────────────────
('openrouter', 'OpenRouter', 'llm_chat',
 'GPT, Claude, Gemini 등 수백 개 AI를 리모컨 하나로 골라 쓰게 해주는 "AI 통합 리모컨"이에요.',
 '회사마다 따로 가입하고 결제할 필요 없이 한곳에서 여러 AI를 바꿔가며 비교해볼 수 있거든요. 어떤 AI가 내 용도에 제일 맞는지 실험해보고 싶을 때 편해요.',
 'https://openrouter.ai', '#94A3B8',
 '가입이 필요해요. 일부 무료 모델이 있고, 나머지는 쓴 만큼 충전 금액에서 차감돼요.',
 'directory_only'),

('lm-studio', 'LM Studio', 'llm_chat',
 '명령어 없이 클릭만으로 내 컴퓨터에 AI를 깔고 대화하는 "로컬 AI 전용 메신저 앱"이에요.',
 'Ollama가 살짝 개발자 느낌이라면, LM Studio는 앱스토어처럼 모델을 검색해서 다운로드 버튼만 누르면 되거든요. 인터넷 없이 돌아가는 나만의 챗봇을 가장 쉽게 만들어볼 수 있어요.',
 'https://lmstudio.ai', '#8B5CF6',
 '개인 사용은 무료예요(맥·윈도우·리눅스). 모델 크기에 따라 넉넉한 메모리가 필요해요.',
 'directory_only'),

-- research ────────────────────────────────────
('lmarena', 'LMArena', 'llm_chat',
 '이름을 가린 AI 두 개에게 같은 질문을 던지고 더 잘한 쪽에 투표하는 "AI 블라인드 대결장"이에요.',
 '전 세계 사람들의 투표가 쌓여서 "지금 진짜 제일 똑똑한 AI 순위표"가 만들어지거든요. 회사들이 자랑하는 점수 말고 사람들이 직접 느낀 순위를 보고 싶을 때 가봐요.',
 'https://lmarena.ai', '#F97316',
 '무료로 바로 대결에 참여할 수 있어요. 질문 내용이 연구용으로 공개될 수 있으니 개인정보는 넣지 마세요.',
 'directory_only'),

('artificial-analysis', 'Artificial Analysis', 'research',
 'AI 모델들의 똑똑함·속도·가격을 한 장의 그래프로 비교해주는 "AI 가격비교 사이트"예요.',
 '"이 AI가 저 AI보다 2배 빠른데 반값이네?" 같은 걸 한눈에 볼 수 있거든요. 회사나 프로젝트에서 어떤 AI를 쓸지 고를 때 숫자로 근거를 대기 좋아요.',
 'https://artificialanalysis.ai', '#6366F1',
 '로그인 없이 무료로 볼 수 있어요. 그래프가 많아서 영어를 잘 몰라도 대충 읽혀요.',
 'directory_only'),

-- creative ────────────────────────────────────
('midjourney', 'Midjourney', 'image_design',
 '문장 한 줄로 화보 같은 그림을 뽑아주는, 이미지 AI계의 원조 아티스트예요.',
 '특유의 감성적인 색감과 분위기 때문에 디자이너들이 아직도 많이 쓰거든요. 탐색(Explore) 페이지에서 남들이 만든 작품과 그때 쓴 문장을 같이 구경하는 재미가 쏠쏠해요.',
 'https://www.midjourney.com', '#E2E8F0',
 '그림을 만들려면 유료 구독이 필요해요. 남이 만든 작품 구경은 가입 후 가능해요.',
 'directory_only'),

('suno', 'Suno', 'video_audio',
 '"비 오는 날 듣는 시티팝"처럼 말만 하면 가사부터 노래까지 통째로 만들어주는 작곡 AI예요.',
 '악기를 하나도 못 다뤄도 1~2분 만에 보컬까지 들어간 완곡이 나오거든요. 친구 생일 축하곡 같은 걸 만들어보면 AI가 어디까지 왔는지 바로 체감돼요.',
 'https://suno.com', '#FB923C',
 '가입하면 매일 무료 크레딧을 줘요. 만든 곡을 상업적으로 쓰려면 유료 플랜 조건을 확인하세요.',
 'directory_only'),

('runway', 'Runway', 'video_audio',
 '사진 한 장이나 문장 한 줄을 짧은 영화 장면으로 바꿔주는 영상 AI 스튜디오예요.',
 '실제 영화·광고 제작 현장에서도 쓰일 만큼 영상 AI 분야를 앞장서 온 곳이거든요. "AI 영상이 요즘 어느 수준이지?"가 궁금하면 여기 데모부터 보면 돼요.',
 'https://runwayml.com', '#22D3EE',
 '가입 시 체험용 크레딧을 줘요. 본격적으로 쓰려면 유료 플랜이 필요해요.',
 'directory_only'),

('elevenlabs', 'ElevenLabs', 'video_audio',
 '글을 넣으면 진짜 사람 같은 목소리로 읽어주고, 다른 언어로 더빙까지 해주는 목소리 AI예요.',
 '숨소리나 감정까지 살린 목소리라 오디오북이나 유튜브 내레이션에 많이 쓰이거든요. 한국어 목소리도 지원해서 직접 들어보면 꽤 놀라워요.',
 'https://elevenlabs.io', '#A78BFA',
 '무료 플랜으로 매달 조금씩 써볼 수 있어요. 남의 목소리를 허락 없이 복제하는 건 절대 안 돼요.',
 'directory_only'),

('krea', 'Krea', 'image_design',
 '내가 낙서하는 동시에 AI가 실시간으로 그림을 완성해주는 "마법 스케치북"이에요.',
 '여러 이미지·영상 AI를 한 화면에서 골라 쓸 수 있고, 붓질 하나하나에 그림이 바로 반응하거든요. 프롬프트 쓰는 게 막막한 사람도 손으로 그리면서 감을 잡기 좋아요.',
 'https://www.krea.ai', '#F472B6',
 '무료 플랜으로 하루 사용량이 제한돼요. 더 많이 쓰려면 유료 플랜이 필요해요.',
 'directory_only'),

-- social ──────────────────────────────────────
('reddit-localllama', 'r/LocalLLaMA', 'social',
 '"AI를 내 컴퓨터에서 돌리는 게 취미"인 사람들이 모인 레딧 동호회예요.',
 '새 공개 모델이 나오면 몇 시간 만에 "내 그래픽카드로 돌려봤더니~" 후기가 쏟아지거든요. 벤치마크 점수보다 실사용 체감이 궁금할 때 제일 믿을 만한 곳이에요.',
 'https://www.reddit.com/r/LocalLLaMA/', '#FF4500',
 '로그인 없이도 읽을 수 있어요. 전문 용어가 많아서 AI Radar 용어 사전과 같이 보면 좋아요.',
 'directory_only'),

('reddit-stablediffusion', 'r/StableDiffusion', 'social',
 '이미지·영상 AI로 뭔가 만들어보는 사람들이 작품과 꿀팁을 자랑하는 레딧 동호회예요.',
 '새 이미지 모델이 나오면 비교 샷과 설정값이 가장 빨리 공유되는 곳이거든요. "이 효과 어떻게 낸 거야?"의 답이 대부분 여기 댓글에 있어요.',
 'https://www.reddit.com/r/StableDiffusion/', '#FF4500',
 '로그인 없이도 읽을 수 있어요. 가끔 수위 있는 이미지가 있으니 계정 설정의 성인 콘텐츠 필터를 확인하세요.',
 'directory_only'),

('x', 'X (AI 커뮤니티)', 'social',
 'AI 회사 대표와 연구자들이 신모델 소식을 제일 먼저 툭 던지는, AI 업계의 실시간 단톡방이에요.',
 '대형 발표가 공식 블로그보다 X 게시물로 먼저 새어 나오는 경우가 정말 많거든요. 관심 있는 연구자 몇 명만 팔로우해도 업계 흐름이 보이기 시작해요.',
 'https://x.com', '#E7E9EA',
 '제대로 보려면 로그인이 필요해요. 루머도 많이 돌아서, 공식 출처를 한 번 더 확인하는 습관이 중요해요.',
 'directory_only'),

-- ─────────────────────────────────────────────────────────────────────────────
-- [C] 7개 카테고리 확장으로 추가한 도감 전용 사이트 (directory_only · 4개)
-- ─────────────────────────────────────────────────────────────────────────────
('perplexity', 'Perplexity', 'llm_chat',
 '질문하면 인터넷을 뒤져서 출처 링크까지 달아 대답해 주는 "AI 검색 비서"예요.',
 '그냥 챗봇은 가끔 그럴듯한 거짓말을 하거든요. Perplexity는 답마다 어디서 찾았는지 번호를 달아줘서, 직접 눌러 확인하는 습관을 들이기 좋아요.',
 'https://www.perplexity.ai', '#20B8CD',
 '로그인 없이도 기본 검색은 무료로 쓸 수 있어요. 더 강한 모델과 많은 사용량은 유료 플랜이에요.',
 'directory_only'),

('notebooklm', 'NotebookLM', 'llm_chat',
 '내 PDF·메모를 올리면 그 자료만 읽고 대답해 주는 구글의 "AI 공부 노트"예요.',
 '인터넷이 아니라 내가 넣은 자료 안에서만 답을 찾아서 엉뚱한 소리가 적거든요. 자료를 두 사람이 수다 떠는 오디오로 바꿔 주는 기능도 있어서 출퇴근길에 듣기 좋아요.',
 'https://notebooklm.google.com', '#4285F4',
 '구글 계정으로 로그인하면 무료로 쓸 수 있어요. 회사 기밀 문서는 올리기 전에 사내 규정을 꼭 확인하세요.',
 'directory_only'),

('luma', 'Luma Dream Machine', 'video_audio',
 '문장이나 사진 한 장으로 몇 초짜리 영화 같은 영상을 만들어 주는 영상 AI 스튜디오예요.',
 '카메라 움직임이나 장면 전환까지 말로 지시할 수 있거든요. 내 사진 한 장이 살아 움직이는 걸 보면 영상 AI가 어디까지 왔는지 바로 감이 와요.',
 'https://lumalabs.ai', '#A3E635',
 '가입하면 체험용 크레딧이 있어요. 긴 영상이나 고화질은 유료 플랜이 필요해요.',
 'directory_only'),

('kling', 'Kling AI', 'video_audio',
 '중국 콰이쇼우가 만든 영상 AI로, 사람 움직임이 자연스럽기로 유명한 "AI 영상 촬영장"이에요.',
 '춤이나 운동처럼 몸 움직임이 큰 장면을 꽤 그럴듯하게 만들어서 영상 AI 비교 영상에 자주 등장하거든요. 다른 영상 AI와 같은 문장을 넣고 결과를 비교해 보는 재미가 있어요.',
 'https://klingai.com', '#FB7185',
 '가입하면 매일 무료 크레딧을 줘요. 실존 인물 사진으로 영상을 만드는 건 당사자 동의가 꼭 필요해요.',
 'directory_only')

on conflict (id) do update set
  name         = excluded.name,
  category     = excluded.category,
  one_liner_ko = excluded.one_liner_ko,
  why_visit_ko = excluded.why_visit_ko,
  url          = excluded.url,
  theme_color  = excluded.theme_color,
  access_note  = excluded.access_note;
  -- collect_status 는 의도적으로 제외 (운영 상태 보존)


-- =============================================================================
-- sources 초기 데이터 (active 플랫폼 10개에 매핑, 총 13개 — 전부 활성)
-- endpoint 의 세부 파라미터(키워드 루프, 태그 필터 등)는 Step 3 어댑터에서 덧붙임
-- =============================================================================
insert into public.sources
  (platform_id, name, endpoint, method, default_category, is_enabled)
values
  -- Hugging Face
  ('huggingface', 'HF Daily Papers',
   'https://huggingface.co/api/daily_papers',
   'api', 'research', true),
  ('huggingface', 'HF Trending Models',
   'https://huggingface.co/api/models?sort=trendingScore&limit=50',
   'api', 'dev', true),
  ('huggingface', 'HF Trending Spaces',
   'https://huggingface.co/api/spaces?sort=trendingScore&limit=50',      -- 이미지/영상/오디오 태그 필터는 어댑터에서
   'api', 'image_design', true),

  -- 공식 블로그 RSS
  ('openai', 'OpenAI News',
   'https://openai.com/news/rss.xml',
   'rss', 'industry', true),
  ('anthropic', 'Anthropic News',
   'https://www.anthropic.com/sitemap.xml',                               -- 공식 RSS 미제공 → 공식 sitemap 의 /news/·/research/ 만 (HTML 스크래핑 없음)
   'rss', 'industry', true),
  ('google-deepmind', 'Google DeepMind Blog',
   'https://deepmind.google/blog/rss.xml',
   'rss', 'research', true),

  -- Hacker News (Algolia) — AI/LLM 키워드 루프는 어댑터에서 &query= 로 덧붙임
  ('hacker-news', 'HN AI Stories',
   'https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E%3D100',
   'api', 'dev', true),

  -- GitHub Releases Atom
  ('ollama', 'Ollama Releases',
   'https://github.com/ollama/ollama/releases.atom',
   'rss', 'dev', true),
  ('github', 'vLLM Releases',
   'https://github.com/vllm-project/vllm/releases.atom',
   'rss', 'dev', true),
  ('github', 'Transformers Releases',
   'https://github.com/huggingface/transformers/releases.atom',
   'rss', 'dev', true),
  ('comfyui', 'ComfyUI Releases',
   'https://github.com/comfyanonymous/ComfyUI/releases.atom',
   'rss', 'image_design', true),

  -- Civitai — nsfw=false 는 sources_civitai_sfw_chk 제약으로 DB에서도 강제됨
  ('civitai', 'Civitai Top Models (SFW)',
   'https://civitai.com/api/v1/models?limit=20&sort=Highest%20Rated&period=Week&nsfw=false',
   'api', 'image_design', true),

  -- Bluesky 공개 AppView — 인증 없는 getAuthorFeed 로 worker/config/bluesky_accounts.json 의 핸들을 순회
  ('bluesky', 'Bluesky AI Researchers List',
   'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed',
   'api', 'social', true)

on conflict (platform_id, name) do update set
  endpoint         = excluded.endpoint,
  method           = excluded.method,
  default_category = excluded.default_category;
  -- is_enabled / fail_count / last_success_at 은 운영 상태라 보존

commit;

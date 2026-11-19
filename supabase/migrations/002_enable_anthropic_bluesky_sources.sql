-- =============================================================================
-- AI Radar · 002_enable_anthropic_bluesky_sources.sql
-- 001 + 시드가 이미 적용된 DB 를 Step 3 수집 방식에 맞춘다. (새로 설치하는 DB 는 시드에 이미 반영됨)
--   - Anthropic: 공식 RSS 가 없어 sitemap.xml 의 /news/, /research/ 경로만 수집 → 활성화
--   - Bluesky  : 리스트 AT-URI 대신 공개 getAuthorFeed 로 계정 핸들 순회 → 활성화
-- 테이블/컬럼 변경 없음. 재실행해도 결과 동일.
-- =============================================================================

update public.sources
   set endpoint   = 'https://www.anthropic.com/sitemap.xml',
       method     = 'rss',
       is_enabled = true
 where platform_id = 'anthropic' and name = 'Anthropic News';

update public.sources
   set endpoint   = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed',
       method     = 'api',
       is_enabled = true
 where platform_id = 'bluesky' and name = 'Bluesky AI Researchers List';

update public.platforms
   set access_note = '뉴스·연구 글은 로그인 없이 무료로 읽을 수 있어요. 영어지만 연구 글에 그림 설명이 많아서 따라가기 좋아요.'
 where id = 'anthropic';

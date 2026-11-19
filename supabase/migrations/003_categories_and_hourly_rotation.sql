-- =============================================================================
-- AI Radar · 003_categories_and_hourly_rotation.sql
-- (요청 파일명은 002_… 였지만 002 번호가 이미 있어 003 으로 둔다 — Supabase 마이그레이션 버전 충돌 방지)
--
-- 1) 카테고리 4종 → 7종 확장 (기존 테이블/컬럼 유지, CHECK 제약만 교체)
--      llm_chat(챗봇·생산성) dev(코딩·에이전트) image_design(이미지·디자인) video_audio(영상·사운드)
--      research(논문·신기술) industry(빅테크·트렌드) social(커뮤니티·화제)
--    기존 'creative' 데이터는 플랫폼 성격에 따라 image_design / video_audio 로 옮긴다.
-- 2) 1시간 주기 수집에 맞춘 수명 주기 단축: hot 0~7일 → warm 8~30일 → archived 31일+
-- 3) 신선도 중력 정렬 뷰 feed_ranked: hot_rank_score = importance_score / (경과시간h + 2)^1.5
--
-- 실행 순서: 001_init → 002 → 003(이 파일) → seed_platforms.sql. 재실행해도 결과 동일.
-- =============================================================================

begin;

-- ── 1. 카테고리 확장 ──────────────────────────────────────────────────────────
alter table public.platforms drop constraint if exists platforms_category_chk;
alter table public.sources   drop constraint if exists sources_default_category_chk;
alter table public.items     drop constraint if exists items_category_chk;

-- 기존 4종 데이터 → 7종 재매핑 (제약을 다시 걸기 전에)
update public.platforms set category = case id
    when 'openai'      then 'industry'
    when 'anthropic'   then 'industry'
    when 'openrouter'  then 'llm_chat'
    when 'lm-studio'   then 'llm_chat'
    when 'lmarena'     then 'llm_chat'
    when 'suno'        then 'video_audio'
    when 'runway'      then 'video_audio'
    when 'elevenlabs'  then 'video_audio'
    else case when category = 'creative' then 'image_design' else category end
  end;

update public.sources set default_category = case
    when platform_id in ('openai', 'anthropic')                           then 'industry'
    when platform_id = 'huggingface' and name = 'HF Trending Models'      then 'dev'
    when default_category = 'creative'                                     then 'image_design'
    else default_category
  end;

update public.items i set category = case
    when i.platform_id in ('suno', 'runway', 'elevenlabs', 'luma', 'kling') then 'video_audio'
    when i.platform_id in ('openai', 'anthropic') and i.category = 'research' then 'industry'
    when i.category = 'creative'                                             then 'image_design'
    else i.category
  end;

alter table public.platforms add constraint platforms_category_chk
  check (category in ('llm_chat', 'dev', 'image_design', 'video_audio', 'research', 'industry', 'social'));
alter table public.sources add constraint sources_default_category_chk
  check (default_category in ('llm_chat', 'dev', 'image_design', 'video_audio', 'research', 'industry', 'social'));
alter table public.items add constraint items_category_chk
  check (category in ('llm_chat', 'dev', 'image_design', 'video_audio', 'research', 'industry', 'social'));


-- ── 2. 수명 주기 단축 (1시간 주기 수집용) ─────────────────────────────────────
comment on column public.items.lifecycle_status is
  'hot: 수집 후 0~7일(메인 라이브 피드) / warm: 8~30일(지난 주요 소식) / archived: 31일+ (created_at 기준)';

create or replace function public.apply_item_lifecycle()
returns table (warmed int, archived int)
language plpgsql
set search_path = public
as $$
declare
  v_warmed   int;
  v_archived int;
begin
  update items
     set lifecycle_status = 'warm'
   where lifecycle_status = 'hot'
     and created_at <  now() - interval '7 days'
     and created_at >= now() - interval '30 days';
  get diagnostics v_warmed = row_count;

  with moved as (
    update items
       set lifecycle_status = 'archived'
     where lifecycle_status <> 'archived'
       and created_at < now() - interval '30 days'
    returning id
  ), cleared as (
    update summaries s
       set context_ko = null,
           what_ko    = null,
           analogy_ko = null,
           why_ko     = null,
           caveats_ko = null,
           terms_json = '[]'::jsonb
      from moved
     where s.item_id = moved.id
    returning s.item_id
  )
  select count(*) into v_archived from moved;

  return query select v_warmed, v_archived;
end;
$$;

revoke execute on function public.apply_item_lifecycle() from public, anon, authenticated;
grant  execute on function public.apply_item_lifecycle() to service_role;


-- ── 3. 신선도 중력 정렬 ───────────────────────────────────────────────────────
-- 경과시간은 '수집 시각(created_at)' 기준: 방금 들어온 소식이 위로, 시간이 지나면 자연히 아래로.
create or replace function public.hot_rank_score(p_importance double precision, p_created_at timestamptz)
returns double precision
language sql
stable
as $$
  select coalesce(p_importance, 0)
       / power(greatest(extract(epoch from (now() - p_created_at)) / 3600.0, 0) + 2, 1.5);
$$;

-- security_invoker: 뷰를 읽는 사람의 권한·RLS 로 실행 (anon 은 공개 읽기 정책 그대로)
create or replace view public.feed_ranked
with (security_invoker = true) as
select i.*,
       public.hot_rank_score(i.importance_score, i.created_at) as hot_rank_score
  from public.items i
 where i.lifecycle_status = 'hot';

grant select on public.feed_ranked to anon, authenticated;

commit;

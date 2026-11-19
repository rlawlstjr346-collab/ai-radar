-- =============================================================================
-- AI Radar · 004_easy_original_and_hooks.sql
-- (요청 파일명은 003_… 였지만 003 번호가 이미 있어 004 로 둔다 — Supabase 마이그레이션 버전 충돌 방지)
--
-- 1) summaries.benefit_tag        : 카드·상세 상단 '실전 이득' 칩 (10~16자 권장, 옵셔널)
-- 2) summaries.easy_original_json : [원본 쉽게 읽기] 완독 해설 캐시 (옵셔널, 처음 요청 시 생성 후 영구 저장)
--      { "sections": [{ "heading", "body", "quote" }], "watch_points": [..], "source_note", "generated_at", "model" }
-- 3) difficulty 의미 전환: '요약 난이도' → '원문 난이도'(해독 배지). 컬럼·값 범위는 그대로.
-- 4) 수명 정리 함수: archived 전환 시 easy_original_json 도 비운다 (긴 본문 용량 방어)
--
-- 기존 테이블/컬럼은 지우지 않는다. 재실행해도 결과 동일.
-- 실행 순서: 001 → 002 → 003 → 004(이 파일) → seed_platforms.sql
-- =============================================================================

begin;

alter table public.summaries add column if not exists benefit_tag text;
alter table public.summaries add column if not exists easy_original_json jsonb;

alter table public.summaries drop constraint if exists summaries_benefit_tag_len_chk;
alter table public.summaries add constraint summaries_benefit_tag_len_chk
  check (benefit_tag is null or char_length(benefit_tag) between 1 and 24);   -- 권장 16자, 여유 상한 24자

alter table public.summaries drop constraint if exists summaries_easy_original_obj_chk;
alter table public.summaries add constraint summaries_easy_original_obj_chk
  check (
    easy_original_json is null
    or (jsonb_typeof(easy_original_json) = 'object'
        and jsonb_typeof(easy_original_json -> 'sections') = 'array'
        and jsonb_typeof(easy_original_json -> 'watch_points') = 'array')
  );

comment on column public.summaries.benefit_tag is '실전 이득 한 줄 칩 (예: 상업용 무료 라이선스). 이모지 없이 저장, 아이콘은 화면이 붙인다';
comment on column public.summaries.easy_original_json is
  '[원본 쉽게 읽기] 완독 해설 캐시. 웹 API(/api/items/:id/easy-original)가 처음 요청 때 생성해 저장';
comment on column public.summaries.difficulty is
  '원문 난이도(해독 배지): 1 가벼운 트렌드 → 1분 정리 / 2 개발 실무 문서 → 쉽게 해독 / 3 박사급 논문 → 쉽게 해독. 요약 자체는 항상 입문자용';


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
       set context_ko         = null,
           what_ko            = null,
           analogy_ko         = null,
           why_ko             = null,
           caveats_ko         = null,
           terms_json         = '[]'::jsonb,
           easy_original_json = null
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

commit;

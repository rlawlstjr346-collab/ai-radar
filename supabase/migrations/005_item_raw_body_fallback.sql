-- =============================================================================
-- AI Radar · 005_item_raw_body_fallback.sql
--
-- items.raw_body: 수집 시 RSS/API 가 준 원문 본문(최대 20,000자)을 함께 저장한다.
--   [원본 쉽게 읽기] 생성 때 원문 URL 직접 접근이 403/429 등으로 막히면
--   ① arXiv 는 /html/<id> 전문 페이지로 재시도 → ② 그래도 실패하면 이 raw_body 로 해설을 만든다.
-- 31일+ archived 전환 시 raw_body 도 비운다 (용량 방어).
--
-- 기존 테이블/컬럼은 지우지 않는다. 재실행해도 결과 동일.
-- 실행 순서: 001 → 002 → 003 → 004 → 005(이 파일) → seed_platforms.sql
-- =============================================================================

begin;

alter table public.items add column if not exists raw_body text;

alter table public.items drop constraint if exists items_raw_body_len_chk;
alter table public.items add constraint items_raw_body_len_chk
  check (raw_body is null or char_length(raw_body) <= 20000);

comment on column public.items.raw_body is
  '수집 시 RSS/API 본문 (최대 20,000자). 원문 페이지 접근이 막혔을 때 [원본 쉽게 읽기] 생성의 대체 원문. archived 시 비움';


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
       set lifecycle_status = 'archived',
           raw_body         = null
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

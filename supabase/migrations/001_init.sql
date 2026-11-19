-- =============================================================================
-- AI Radar · 001_init.sql
-- 1차 MVP 스키마: platforms / sources / items / summaries / glossary (5개 고정)
-- 대상: Supabase (PostgreSQL 15+)  ·  pgvector 미사용
-- =============================================================================

-- gen_random_uuid() 는 PG13+ 코어 함수라 별도 extension 불필요.

-- -----------------------------------------------------------------------------
-- 공통: updated_at 자동 갱신 트리거 함수 (glossary 에서 사용)
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- 1. platforms — 글로벌 AI 플랫폼 도감 마스터 (수동 큐레이션 시드)
-- =============================================================================
create table public.platforms (
  id              text primary key,                      -- slug, 예: 'huggingface'
  name            text not null,
  category        text not null,
  one_liner_ko    text not null,
  why_visit_ko    text not null,
  url             text not null,
  theme_color     text not null,                         -- hex (#RRGGBB) 권장: Tailwind JIT 퍼지 이슈 회피
  access_note     text,
  collect_status  text not null default 'directory_only',

  constraint platforms_id_slug_chk
    check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint platforms_category_chk
    check (category in ('dev', 'research', 'creative', 'social')),
  constraint platforms_collect_status_chk
    check (collect_status in ('active', 'paused', 'directory_only'))
);

create index platforms_category_idx on public.platforms (category);

comment on table  public.platforms is '글로벌 AI 플랫폼 도감 (수동 큐레이션)';
comment on column public.platforms.collect_status is
  'active: 자동 수집 중 / paused: 소스 연속 실패로 일시정지 / directory_only: 수집 없이 도감에만 노출';


-- =============================================================================
-- 2. sources — 자동 수집 엔드포인트
-- =============================================================================
create table public.sources (
  id                uuid primary key default gen_random_uuid(),
  platform_id       text not null references public.platforms (id) on update cascade on delete restrict,
  name              text not null,
  endpoint          text not null,
  method            text not null,
  default_category  text not null,
  is_enabled        boolean not null default true,
  last_success_at   timestamptz,
  fail_count        int not null default 0,

  constraint sources_platform_name_uq unique (platform_id, name),   -- 시드 재실행(idempotent)용
  constraint sources_method_chk
    check (method in ('api', 'rss')),
  constraint sources_default_category_chk
    check (default_category in ('dev', 'research', 'creative', 'social')),
  constraint sources_fail_count_chk
    check (fail_count >= 0),
  -- Civitai 안전 필터는 DB 레벨에서도 강제: nsfw=false 가 빠진 엔드포인트는 저장 자체가 불가.
  constraint sources_civitai_sfw_chk
    check (platform_id <> 'civitai' or endpoint ilike '%nsfw=false%')
);

create index sources_platform_id_idx on public.sources (platform_id);

comment on column public.sources.fail_count is
  '연속 실패 횟수. 성공 시 워커가 0으로 리셋. 3 이상이 되면 트리거가 platforms.collect_status 를 paused 로 전환';

-- 연속 3회 실패 → 플랫폼 paused 전환 (워커는 fail_count 만 올리면 됨)
create or replace function public.pause_platform_on_source_failure()
returns trigger
language plpgsql
as $$
begin
  if new.fail_count >= 3 and coalesce(old.fail_count, 0) < 3 then
    update public.platforms
       set collect_status = 'paused'
     where id = new.platform_id
       and collect_status = 'active';
  end if;
  return new;
end;
$$;

create trigger sources_pause_platform_on_failure
  after update of fail_count on public.sources
  for each row
  execute function public.pause_platform_on_source_failure();


-- =============================================================================
-- 3. items — 수집된 원본 이슈 & 수명 관리
-- =============================================================================
create table public.items (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.sources (id) on delete restrict,
  platform_id       text not null references public.platforms (id) on update cascade on delete restrict,
  canonical_url     text not null,
  dedup_key         text not null,
  original_title    text not null,
  category          text not null,
  thumbnail_url     text,
  metrics_json      jsonb not null default '{}'::jsonb,
  importance_score  double precision not null default 0,
  lifecycle_status  text not null default 'hot',
  source_count      int not null default 1,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),

  constraint items_canonical_url_uq unique (canonical_url),
  constraint items_category_chk
    check (category in ('dev', 'research', 'creative', 'social')),
  constraint items_lifecycle_status_chk
    check (lifecycle_status in ('hot', 'warm', 'archived')),
  constraint items_source_count_chk
    check (source_count >= 1),
  constraint items_metrics_json_obj_chk
    check (jsonb_typeof(metrics_json) = 'object')
);

-- dedup_key: 병합 판정 키. 같은 키가 두 행이 되면 병합 로직이 깨지므로 unique 인덱스로 둔다.
create unique index items_dedup_key_uq            on public.items (dedup_key);
create index        items_importance_score_idx    on public.items (importance_score desc);
create index        items_feed_idx                on public.items (lifecycle_status, category, importance_score desc);
create index        items_platform_recent_idx     on public.items (platform_id, created_at desc);   -- 우측 패널 "이 플랫폼 최근 핫이슈 3개"
create index        items_created_at_idx          on public.items (created_at);                    -- TTL 정리

comment on column public.items.dedup_key is
  'arxiv:2611.xxxxx | gh:owner/repo | url:<sha256(canonical_url)>';
comment on column public.items.lifecycle_status is
  'hot: 수집 후 0~30일 / warm: 31~90일 / archived: 90일+ (created_at 기준)';


-- =============================================================================
-- 4. summaries — 뉴닉풍 대화체 요약
-- =============================================================================
create table public.summaries (
  item_id             uuid primary key references public.items (id) on delete cascade,
  hook_title          text not null,
  context_ko          text,          -- archived 시 null 로 비움
  what_ko             text,          -- archived 시 null 로 비움
  analogy_ko          text,
  why_ko              text,          -- archived 시 null 로 비움
  caveats_ko          text,
  difficulty          smallint not null,
  terms_json          jsonb not null default '[]'::jsonb,
  extracted_entities  jsonb not null default '[]'::jsonb,
  prompt_version      text not null,
  created_at          timestamptz not null default now(),

  constraint summaries_difficulty_chk
    check (difficulty in (1, 2, 3)),
  constraint summaries_terms_json_arr_chk
    check (jsonb_typeof(terms_json) = 'array'),
  constraint summaries_entities_arr_chk
    check (jsonb_typeof(extracted_entities) = 'array')
);

create index summaries_difficulty_idx on public.summaries (difficulty);

comment on column public.summaries.difficulty is '1: 🌱완전입문 / 2: ⚡교양실전 / 3: 🔥개발심화';
comment on column public.summaries.extracted_entities is
  '[{"name","kind","tags"}] — 2차 "맞춤형 AI 처방" 기능용 브릿지 컬럼. archived 후에도 보존';


-- =============================================================================
-- 5. glossary — 누적 외계어 번역 사전
-- =============================================================================
create table public.glossary (
  term          text primary key,
  display_name  text not null,
  easy_def      text not null,
  updated_at    timestamptz not null default now(),

  constraint glossary_term_normalized_chk
    check (term = lower(btrim(term)) and term <> '')
);

create trigger glossary_set_updated_at
  before update on public.glossary
  for each row
  execute function public.set_updated_at();


-- =============================================================================
-- TTL 수명 정리 (Step 3 워커가 supabase.rpc('apply_item_lifecycle') 로 호출)
--   hot  → warm     : 수집 후 30일 경과
--   *    → archived : 수집 후 90일 경과 + summaries 본문 비우기
--                     (hook_title / canonical_url / extracted_entities 만 남김)
-- =============================================================================
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
     and created_at <  now() - interval '30 days'
     and created_at >= now() - interval '90 days';
  get diagnostics v_warmed = row_count;

  with moved as (
    update items
       set lifecycle_status = 'archived'
     where lifecycle_status <> 'archived'
       and created_at < now() - interval '90 days'
    returning id
  ), cleared as (
    update summaries s
       set context_ko = null,
           what_ko    = null,
           analogy_ko = null,
           why_ko     = null,
           caveats_ko = null,
           terms_json = '[]'::jsonb      -- 용어 풀이는 glossary 에 누적돼 있으므로 비워도 됨
      from moved
     where s.item_id = moved.id
    returning s.item_id
  )
  select count(*) into v_archived from moved;

  return query select v_warmed, v_archived;
end;
$$;


-- =============================================================================
-- RLS: 프론트(anon/authenticated)는 읽기 전용, 워커는 service_role(RLS 우회)로 쓰기
-- sources 는 내부 운영 테이블이라 공개 정책 없음
-- =============================================================================
alter table public.platforms enable row level security;
alter table public.sources   enable row level security;
alter table public.items     enable row level security;
alter table public.summaries enable row level security;
alter table public.glossary  enable row level security;

create policy platforms_public_read on public.platforms for select to anon, authenticated using (true);
create policy items_public_read     on public.items     for select to anon, authenticated using (true);
create policy summaries_public_read on public.summaries for select to anon, authenticated using (true);
create policy glossary_public_read  on public.glossary  for select to anon, authenticated using (true);

-- 수명 정리 함수는 워커 전용
revoke execute on function public.apply_item_lifecycle() from public, anon, authenticated;
grant  execute on function public.apply_item_lifecycle() to service_role;

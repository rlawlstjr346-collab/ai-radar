-- =============================================================================
-- AI Radar · 006_platform_regions_global_sources.sql
-- 글로벌 도감 권역(region) + 다국어 수집 소스 확장 (추가만, 기존 컬럼·데이터 삭제 없음)
--
-- region: kr(국내) / global(북미·글로벌) / jp(일본) / cn(중국) / eu(유럽·캐나다·중동) / social(X·소셜 실시간)
-- 실행 순서: 001 → 002 → 003 → 004 → 005 → 이 파일 → seed/seed_platforms.sql → seed/seed_platforms_v2_global.sql
-- =============================================================================

begin;

alter table public.platforms
  add column if not exists region text not null default 'global';

alter table public.platforms drop constraint if exists platforms_region_chk;
alter table public.platforms add constraint platforms_region_chk
  check (region in ('kr', 'global', 'jp', 'cn', 'eu', 'social'));

create index if not exists platforms_region_idx on public.platforms (region);

comment on column public.platforms.region is
  '도감 권역 필터: kr 국내 / global 북미·글로벌 / jp 일본 / cn 중국 / eu 유럽·기타 / social X·소셜 실시간 속보';

commit;

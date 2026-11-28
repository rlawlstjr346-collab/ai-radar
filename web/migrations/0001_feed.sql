-- 완성 피드 스냅샷을 행 몇 개에 통째로 저장한다 (요청당 읽기 1~5행)
--   meta     : {"generated_at","scanned_at","base_generated_at","base_chunks","count"}
--   base:N   : 15분 심층 파이프라인 items 배열 본문(텍스트 조각, 파싱 없이 이어 붙임)
--   edge     : 5분 엣지 속보 아이템 JSON 배열 (최대 40건)
--   seen     : 이미 실은 기사 URL 키 JSON 배열 (신규 판정용)
CREATE TABLE IF NOT EXISTS feed (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  at TEXT NOT NULL
);

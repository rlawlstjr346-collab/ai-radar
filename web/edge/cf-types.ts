/** Workers 런타임 타입 중 엣지 코드가 쓰는 최소 부분만 선언 (Next 의 DOM 타입과 충돌하지 않게 전역 주입을 피한다) */
export interface D1Result<T> {
  results?: T[];
  meta?: { rows_read?: number; rows_written?: number; duration?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>;
}
export interface EdgeEnv {
  DB: D1Database;
  FEED_INGEST_SECRET?: string;
  GEMINI_API_KEY?: string;
  /** GitHub Actions collect.yml workflow_dispatch 전용 토큰 (Worker 시크릿) */
  GH_DISPATCH_TOKEN?: string;
}
export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}
export interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

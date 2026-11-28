import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// KV 쓰기 0건: 페이지는 빌드 시 프리렌더된 정적 HTML 로만 서빙하고(ISR 없음),
// 최신 기사는 브라우저가 60초마다 GitHub Raw live-feed.json 을 직접 조회해 재배포 없이 병합한다.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});

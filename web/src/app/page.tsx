import RadarApp from "@/components/RadarApp";
import { loadRadarData } from "@/lib/data";

// 빌드 시 1회 프리렌더된 정적 HTML 로 즉시 그리고(KV·SSR CPU 0), 최신 기사는 브라우저가
// 60초마다 GitHub Raw live-feed.json 을 조회해 재배포 없이 병합한다.
export const dynamic = "force-static";

export default async function Home() {
  const data = await loadRadarData();
  return <RadarApp data={data} />;
}

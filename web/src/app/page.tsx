import RadarApp from "@/components/RadarApp";
import { loadRadarData } from "@/lib/data";

// 20분 자동 수집 스냅샷을 재빌드 없이 60초 ISR + Raw JSON 원격 fetch 로 가볍게 서빙
export const revalidate = 60;

export default async function Home() {
  const data = await loadRadarData();
  return <RadarApp data={data} />;
}

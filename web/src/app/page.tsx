import RadarApp from "@/components/RadarApp";
import { loadRadarData } from "@/lib/data";

// 워커가 6시간마다 수집하므로 10분 캐시면 충분
export const revalidate = 600;

export default async function Home() {
  const data = await loadRadarData();
  return <RadarApp data={data} />;
}

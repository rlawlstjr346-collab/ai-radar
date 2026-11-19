// supabase/seed/seed_platforms.sql 을 실제 Postgres(PGlite)로 실행해서
// src/data/platforms.sample.json 을 만든다 → 폴백 데이터와 DB 시드가 항상 같은 원본을 공유.
//   npm run gen:sample
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role;");
for (const file of [
  "supabase/migrations/001_init.sql",
  "supabase/migrations/002_enable_anthropic_bluesky_sources.sql",
  "supabase/migrations/003_categories_and_hourly_rotation.sql",
  "supabase/migrations/004_easy_original_and_hooks.sql",
  "supabase/seed/seed_platforms.sql",
]) {
  await db.exec(readFileSync(join(root, file), "utf8"));
}

const { rows } = await db.query(
  `select id, name, category, one_liner_ko, why_visit_ko, url, theme_color, access_note, collect_status
     from platforms
    order by array_position(array['llm_chat','dev','image_design','video_audio','research','industry','social'], category),
             case collect_status when 'active' then 0 else 1 end, name`,
);
const out = join(here, "..", "src", "data", "platforms.sample.json");
writeFileSync(out, JSON.stringify(rows, null, 2) + "\n", "utf8");
console.log(`wrote ${rows.length} platforms → ${out}`);

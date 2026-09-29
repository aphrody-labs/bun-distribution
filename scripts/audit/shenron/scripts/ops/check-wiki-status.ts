// SPDX-License-Identifier: Apache-2.0
import { createDb } from "../../packages/db/src/index.ts";

async function main() {
  const { client } = createDb({});

  console.log("================= SHENRON WIKI STATUS AUDIT =================");

  // 1. Characters
  const [totalChars] = await client`SELECT count(*)::int as c FROM bot.db_characters WHERE visible = true`;
  const [withJaChars] = await client`SELECT count(*)::int as c FROM bot.db_characters WHERE visible = true AND name_ja IS NOT NULL AND name_ja != ''`;
  console.log(`[1] Personnages : ${withJaChars.c} / ${totalChars.c} avec name_ja (${((withJaChars.c / totalChars.c) * 100).toFixed(2)}%)`);

  // 2. Techniques & Transformations
  const [totalTechs] = await client`SELECT count(*)::int as c FROM bot.db_techniques WHERE visible = true`;
  const [withCreatorTechs] = await client`SELECT count(*)::int as c FROM bot.db_techniques WHERE visible = true AND creator_id IS NOT NULL`;
  const [totalTrans] = await client`SELECT count(*)::int as c FROM bot.db_transformations WHERE visible = true`;
  console.log(`[2] Techniques : ${withCreatorTechs.c} / ${totalTechs.c} avec creator_id | Transformations : ${totalTrans.c} visibles`);

  // 3. Races & Planets
  const [totalRaces] = await client`SELECT count(*)::int as c FROM bot.db_races WHERE visible = true`;
  const [withJaRaces] = await client`SELECT count(*)::int as c FROM bot.db_races WHERE visible = true AND name_ja IS NOT NULL AND name_ja != ''`;
  const [withPlanetRaces] = await client`SELECT count(*)::int as c FROM bot.db_races WHERE visible = true AND home_planet_id IS NOT NULL`;
  const [totalPlanets] = await client`SELECT count(*)::int as c FROM bot.db_planets WHERE visible = true`;
  console.log(`[3] Races : ${withJaRaces.c} / ${totalRaces.c} name_ja, ${withPlanetRaces.c} reliées à home_planet | Planètes : ${totalPlanets.c}`);

  // 4. Sagas & Movies
  const [totalSagas] = await client`SELECT count(*)::int as c FROM bot.db_sagas WHERE visible = true`;
  const [boundedSagas] = await client`SELECT count(*)::int as c FROM bot.db_sagas WHERE visible = true AND manga_chapter_start IS NOT NULL`;
  const [totalMovies] = await client`SELECT count(*)::int as c FROM bot.db_movies WHERE visible = true`;
  console.log(`[4] Sagas : ${boundedSagas.c} / ${totalSagas.c} avec bornes chapitres | Films : ${totalMovies.c}`);

  // 5. Databooks & Chapters
  const [totalDatabooks] = await client`SELECT count(*)::int as c FROM bot.db_databooks WHERE visible = true`;
  const [withJaDatabooks] = await client`SELECT count(*)::int as c FROM bot.db_databooks WHERE visible = true AND title_ja IS NOT NULL AND title_ja != ''`;
  const [missingVolChaps] = await client`SELECT count(*)::int as c FROM bot.db_manga_chapters WHERE visible = true AND (volume_id IS NULL OR published_at IS NULL)`;
  console.log(`[5] Databooks : ${withJaDatabooks.c} / ${totalDatabooks.c} avec title_ja | Chapitres orphelins (volume/date) : ${missingVolChaps.c}`);

  // 6. Dragons, Objets, Lieux, Vœux & Tournois
  const [dragons] = await client`SELECT count(*)::int as total, count(case when name_ja is not null and name_ja != '' then 1 end)::int as ja FROM bot.db_dragons WHERE visible = true`;
  const [items] = await client`SELECT count(*)::int as total, count(case when name_ja is not null and name_ja != '' then 1 end)::int as ja FROM bot.db_items WHERE visible = true`;
  const [locations] = await client`SELECT count(*)::int as total, count(case when name_ja is not null and name_ja != '' then 1 end)::int as ja FROM bot.db_locations WHERE visible = true`;
  const [wishes] = await client`SELECT count(*)::int as total FROM bot.db_wishes WHERE visible = true`;
  const [tournaments] = await client`SELECT count(*)::int as total FROM bot.db_tournaments WHERE visible = true`;
  console.log(`[6] Dragons : ${dragons.ja}/${dragons.total} ja | Objets : ${items.ja}/${items.total} ja | Lieux : ${locations.ja}/${locations.total} ja | Vœux : ${wishes.total} | Tournois : ${tournaments.total}`);

  // 7. Recent Wiki Revisions
  const recentRevs = await client`
    SELECT "tableName", "action", "label", "editorName", "createdAt"
    FROM public.wiki_revisions
    ORDER BY "createdAt" DESC
    LIMIT 5
  `;
  console.log("Dernières révisions enregistrées :");
  for (const r of recentRevs) {
    console.log(`  * [${new Date(r.createdAt).toISOString()}] [${r.tableName}] ${r.label} (${r.editorName})`);
  }

  console.log("=============================================================");
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Erreur audit :", err);
  process.exit(1);
});

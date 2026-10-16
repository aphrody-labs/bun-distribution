import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

const db = createInagleSql<Database>();

async function main() {
  try {
    const chars = await db
      .selectFrom("inagle_characters")
      .select([
        "id",
        "chara_id",
        "name_fr",
        "name_en",
        "internal_code",
        "rarity_label",
        "image_url",
        "zukan_hash",
        "hero_type",
        "zukan_order",
      ])
      .orderBy("id", "asc")
      .execute();
    console.log(`Total character rows in PostgreSQL: ${chars.length}`);
    const byCharaId = new Map<string, typeof chars>();
    for (const char of chars) {
      const key = char.chara_id ?? "";
      const list = byCharaId.get(key) ?? [];
      list.push(char);
      byCharaId.set(key, list);
    }
    let count = 0;
    for (const [charaId, list] of byCharaId) {
      if (list.length < 2 || !list.some(char => char.rarity_label === "Héros" || char.rarity_label === "BASARA"))
        continue;
      count++;
      if (count > 5) continue;
      console.log(`\nCharacter: ${list[0]?.name_fr ?? list[0]?.name_en ?? charaId} (chara_id: ${charaId})`);
      for (const char of list)
        console.log(
          `  - ParamID: ${char.id}\n    Code: ${char.internal_code}, Rarity: ${char.rarity_label}, HeroType: ${char.hero_type}\n    ImageUrl: ${char.image_url}, ZukanHash: ${char.zukan_hash}, Order: ${char.zukan_order}`,
        );
    }
  } catch (error) {
    console.error("Error:", error);
    process.exitCode = 1;
  }
}

void main();

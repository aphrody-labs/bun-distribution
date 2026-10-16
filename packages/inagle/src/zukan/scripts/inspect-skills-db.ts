import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

const db = createInagleSql<Database>();

async function main() {
  try {
    const skills = await db.selectFrom("inagle_skills").selectAll().orderBy("id", "asc").execute();
    console.log(`Total skills in PostgreSQL: ${skills.length}`);
    const seenNames = new Set<string>();
    const nameDuplicates = skills.filter(skill => {
      const name = skill.name_fr ?? skill.name_en ?? skill.name_ja;
      if (!name) return false;
      const key = name.toLowerCase().trim();
      if (seenNames.has(key)) return true;
      seenNames.add(key);
      return false;
    });
    console.log(`Duplicate skills by name: ${nameDuplicates.length}`);
    for (const skill of nameDuplicates.slice(0, 10))
      console.log(`- ID: ${skill.id}, Name: ${skill.name_fr} (${skill.name_en}), Category: ${skill.category}`);
    const passives = skills.filter(skill => {
      const category = skill.category?.toLowerCase() ?? "";
      const data =
        skill.data && typeof skill.data === "object" && !Array.isArray(skill.data)
          ? (skill.data as Record<string, unknown>)
          : {};
      return (
        category.includes("passif") ||
        category.includes("passive") ||
        data.category === 6 ||
        data.category === "Passive" ||
        data.isPassive === true
      );
    });
    console.log(`Passive skills in PostgreSQL: ${passives.length}`);
    for (const skill of passives.slice(0, 10))
      console.log(`- ID: ${skill.id}, Name: ${skill.name_fr} (${skill.name_en}), Category: ${skill.category}`);
    console.log(`Duplicate skills by ID: ${skills.length - new Set(skills.map(skill => skill.id)).size}`);
  } catch (error) {
    console.error("Error:", error);
    process.exitCode = 1;
  }
}

void main();

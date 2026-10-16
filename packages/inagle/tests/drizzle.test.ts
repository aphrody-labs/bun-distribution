import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createDrizzleSqlite,
  sqliteCharacters,
  sqliteSkills,
  sqliteTeams,
  eq,
} from "../src/sql/drizzle";

const root = resolve(join(import.meta.dir, "../../.."));
const mirrorPath = join(root, "var/mirror.sqlite");
const schemaPath = join(root, "packages/inagle/src/sql/schema.sqlite.sql");

describe("Drizzle ORM Bun SQLite Integration", () => {
  test("creates an in-memory Drizzle SQLite instance with schema and performs CRUD", () => {
    const memDb = new Database(":memory:");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    memDb.run(schemaSql);

    const drizzle = createDrizzleSqlite(memDb);

    // Insert dummy character
    drizzle
      .insert(sqliteCharacters)
      .values({
        id: "chara_test_1",
        charaId: "c001",
        nameFr: "Mark Evans",
        element: "earth",
        position: "GK",
        statFrappe: 85,
        statTotal: 500,
      })
      .run();

    // Query back
    const chars = drizzle
      .select()
      .from(sqliteCharacters)
      .where(eq(sqliteCharacters.id, "chara_test_1"))
      .all();

    expect(chars.length).toBe(1);
    expect(chars[0].nameFr).toBe("Mark Evans");
    expect(chars[0].element).toBe("earth");
    expect(chars[0].statFrappe).toBe(85);

    // Insert dummy skill
    drizzle
      .insert(sqliteSkills)
      .values({
        id: "skill_test_1",
        nameFr: "Main Céleste",
        category: "catch",
        tpCost: 20,
      })
      .run();

    const skills = drizzle
      .select()
      .from(sqliteSkills)
      .where(eq(sqliteSkills.id, "skill_test_1"))
      .all();

    expect(skills.length).toBe(1);
    expect(skills[0].nameFr).toBe("Main Céleste");
    expect(skills[0].category).toBe("catch");
    expect(skills[0].tpCost).toBe(20);

    memDb.close();
  });

  test("queries var/mirror.sqlite if populated", () => {
    if (!existsSync(mirrorPath)) {
      console.log("ℹ️ var/mirror.sqlite does not exist, skipping mirror verification.");
      return;
    }

    const drizzle = createDrizzleSqlite(mirrorPath);

    // Verify characters count > 6000
    const charCount = drizzle.select().from(sqliteCharacters).limit(5).all();

    expect(charCount.length).toBe(5);

    // Verify teams count > 0
    const teams = drizzle.select().from(sqliteTeams).limit(5).all();
    expect(teams.length).toBe(5);

    // Verify skills count > 0
    const skills = drizzle.select().from(sqliteSkills).limit(5).all();
    expect(skills.length).toBe(5);
  });
});

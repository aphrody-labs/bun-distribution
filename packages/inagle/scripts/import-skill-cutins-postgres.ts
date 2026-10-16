/** Explicit one-way import of cut-in extraction artefacts into PostgreSQL. */
import { resolve } from "node:path";
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

const cutinSource = process.env.INAGLE_SKILLS_CUTIN_JSON;
const servedSource = process.env.INAGLE_SKILLS_CUTIN_SERVED_JSON;
if (!cutinSource || !servedSource) {
  throw new Error("INAGLE_SKILLS_CUTIN_JSON and INAGLE_SKILLS_CUTIN_SERVED_JSON are required.");
}

const cutinFile = JSON.parse(await Bun.file(resolve(cutinSource)).text()) as {
  skills?: Array<Record<string, unknown>>;
};
const servedFile = JSON.parse(await Bun.file(resolve(servedSource)).text()) as {
  events?: string[];
};
const skills = cutinFile.skills ?? [];
const events = servedFile.events ?? [];
if (skills.length === 0 || events.length === 0) throw new Error("Cut-in sources are empty.");

const db = createInagleSql<Database>();
const now = new Date().toISOString();
await db.transaction().execute(async tx => {
  for (let offset = 0; offset < skills.length; offset += 100) {
    for (const skill of skills.slice(offset, offset + 100)) {
      const skillId = String(skill.skill_id_str ?? "");
      if (!skillId) continue;
      const cutin = skill.cutin as Record<string, unknown> | null | undefined;
      await tx
        .insertInto("inagle_skill_cutins")
        .values({
          skill_id: skillId,
          event_id_name: typeof cutin?.event_id_name === "string" ? cutin.event_id_name : null,
          data: JSON.stringify(skill),
          updated_at: now,
        })
        .onConflict(oc =>
          oc.column("skill_id").doUpdateSet({
            event_id_name: typeof cutin?.event_id_name === "string" ? cutin.event_id_name : null,
            data: JSON.stringify(skill),
            updated_at: now,
          }),
        )
        .execute();
    }
  }
  for (const event of events) {
    await tx
      .insertInto("inagle_skill_cutin_assets")
      .values({ event_id_name: event, data: JSON.stringify({ served: true }), updated_at: now })
      .onConflict(oc =>
        oc.column("event_id_name").doUpdateSet({ data: JSON.stringify({ served: true }), updated_at: now }),
      )
      .execute();
  }
});
console.log(`Imported ${skills.length} skill cut-ins and ${events.length} served events into PostgreSQL.`);
await db.destroy();

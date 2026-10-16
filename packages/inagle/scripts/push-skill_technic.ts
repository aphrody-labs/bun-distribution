/**
 * @file push-skill_technic.ts
 * @description Runner standalone pour peupler `inagle_skill_technic` depuis le
 * vrai config `skill/skill_technic_config` (octets réels du dump). La logique
 * d'import vit dans `src/push-categories.ts` (`importSkillTechnic`) — source
 * UNIQUE partagée avec le flux principal cli-push.ts. Ce fichier ne fait que
 * créer l'adaptateur PostgreSQL et lancer l'importer. Upsert idempotent
 * (ON CONFLICT id = hash hex du technic).
 *
 * Lancement (depuis la racine IECODE) :
 *   DATA_PATH=data bun packages/inagle/scripts/push-skill_technic.ts
 */

import { importSkillTechnic } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importSkillTechnic(null, db)
  .then(() => db.close())
  .catch((e) => {
    console.error("Erreur fatale push-skill_technic:", e);
    process.exit(1);
  });

/**
 * @file push-telop_waza.ts
 * @description Runner standalone pour peupler `inagle_telop_waza` depuis le vrai
 * config skill_telop_info_config (octets réels du dump). La logique d'import vit
 * dans `src/push-categories.ts` (`importTelopWaza`) — source UNIQUE partagée
 * avec le flux principal cli-push.ts. Upsert idempotent (ON CONFLICT skill_id).
 *
 * Exécution (depuis la racine IECODE) :
 *   bun packages/inagle/scripts/push-telop_waza.ts
 */

import { importTelopWaza } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importTelopWaza(null, db)
  .then(() => db.close())
  .catch(e => {
    console.error("❌ Erreur push-telop_waza:", e);
    process.exit(1);
  });

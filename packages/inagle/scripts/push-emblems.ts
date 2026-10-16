/**
 * @file push-emblems.ts
 * @description Runner standalone pour peupler `inagle_emblems` depuis le VRAI
 * config menu/emblem_resource_*.cfg.bin.json (octets réels de DATA_PATH).
 * La logique d'import vit dans `src/push-categories.ts` (`importEmblems`) —
 * source UNIQUE partagée avec le flux principal cli-push.ts. Upsert idempotent
 * (ON CONFLICT emblem_id).
 *
 * Exécution : `bun packages/inagle/scripts/push-emblems.ts` (depuis la racine IECODE).
 */

import { importEmblems } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importEmblems(null, db)
  .then(() => db.close())
  .catch((err) => {
    console.error("Erreur fatale push-emblems:", err);
    process.exit(1);
  });

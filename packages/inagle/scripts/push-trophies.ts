/**
 * @file push-trophies.ts
 * @description Runner standalone pour peupler `inagle_trophies` depuis le vrai
 * config `common/gamedata/trophy/trophy_config_*.cfg.bin.json` (octets réels du
 * dump) + les textes localisés `common/text/<loc>/trophy_text.cfg.bin.json`. La
 * logique d'import vit dans `src/push-categories.ts` (`importTrophies`) — source
 * UNIQUE partagée avec le flux principal cli-push.ts. Ce fichier ne fait que
 * créer l'adaptateur PostgreSQL et lancer l'importer. Upsert idempotent
 * (ON CONFLICT trophy_id).
 *
 * Lancement (depuis la racine IECODE) :
 *   DATA_PATH=data bun packages/inagle/scripts/push-trophies.ts
 */

import { importTrophies } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importTrophies(null, db)
  .then(() => db.close())
  .catch(e => {
    console.error("Erreur fatale push-trophies:", e);
    process.exit(1);
  });

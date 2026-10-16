/**
 * @file push-boost_groups.ts
 * @description Runner standalone pour peupler `inagle_boost_groups` depuis le
 * vrai config `boost_grp/boost_player_group_config_*.cfg.bin.json` (octets réels
 * du dump). La logique d'import vit dans `src/push-categories.ts`
 * (`importBoostGroups`) — source UNIQUE partagée avec le flux principal
 * cli-push.ts. Ce fichier ne fait que créer l'adaptateur PostgreSQL et lancer
 * l'importer. Upsert idempotent (ON CONFLICT id = "boost_grp_<index>").
 *
 * Lancement (depuis la racine IECODE) :
 *   DATA_PATH=data bun packages/inagle/scripts/push-boost_groups.ts
 */

import { importBoostGroups } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importBoostGroups(null, db)
  .then(() => db.close())
  .catch((e) => {
    console.error("[push-boost_groups] échec :", e);
    process.exit(1);
  });

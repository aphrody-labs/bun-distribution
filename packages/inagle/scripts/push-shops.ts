/**
 * @file push-shops.ts
 * @description Runner standalone pour peupler `inagle_shops` depuis le VRAI
 * shop_config (octets réels de DATA_PATH). La logique d'import vit dans
 * `src/push-categories.ts` (`importShops`) — source UNIQUE partagée avec le flux
 * principal cli-push.ts. 1 ligne = 1 (shop × item), clé `id = "<shopId>:<itemId>"`.
 * Upsert idempotent (ON CONFLICT id).
 *
 * Exécution : `bun packages/inagle/scripts/push-shops.ts` depuis la racine IECODE
 */

import { importShops } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importShops(null, db)
  .then(() => db.close())
  .catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
  });

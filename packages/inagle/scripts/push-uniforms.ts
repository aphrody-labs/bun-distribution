/**
 * @file push-uniforms.ts
 * @description Runner standalone pour peupler `inagle_uniforms` depuis le vrai
 * config `character/uniform_config` (octets réels du dump). La logique d'import
 * vit dans `src/push-categories.ts` (`importUniforms`) — source UNIQUE partagée
 * avec le flux principal cli-push.ts. Ce fichier ne fait que créer l'adaptateur
 * Supabase et lancer l'importer. Upsert idempotent (ON CONFLICT name_id).
 *
 * Lancement (depuis la racine IECODE) :
 *   bun packages/inagle/scripts/push-uniforms.ts
 */

import { importUniforms } from "../src/push-categories.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importUniforms(null, db)
  .then(() => db.close())
  .catch(e => {
    console.error("Erreur fatale push-uniforms:", e);
    process.exit(1);
  });

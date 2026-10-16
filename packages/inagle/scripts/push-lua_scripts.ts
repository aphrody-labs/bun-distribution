/**
 * @file push-lua_scripts.ts
 * @description Runner standalone pour peupler `inagle_lua_scripts` depuis l'index
 * global des scripts Lua décompilés.
 *
 * Exécution : `bun packages/inagle/scripts/push-lua_scripts.ts` (depuis la racine IECODE).
 */

import { importLuaScripts } from "../src/lua/pusher.ts";
import { createPostgresAdapter } from "../src/push-adapter.ts";

const db = createPostgresAdapter();
await importLuaScripts(null, db)
  .then(() => db.close())
  .catch(err => {
    console.error("Erreur fatale push-lua_scripts:", err);
    process.exit(1);
  });

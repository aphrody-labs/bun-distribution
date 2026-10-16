// SPDX-License-Identifier: Apache-2.0
export * from "@aphrody/web-source/integrations/packages/infra/workspace/src/web-migration.ts";
import { runWebMigration } from "@aphrody/web-source/integrations/packages/infra/workspace/src/web-migration.ts";
if (import.meta.main)
  process.exit(await runWebMigration(process.argv.slice(2)));

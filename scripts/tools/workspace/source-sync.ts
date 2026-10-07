// SPDX-License-Identifier: Apache-2.0
// Compatibility entry; implementation belongs to its publishable package owner.
export * from "../../../packages/infra/workspace/src/source-sync.ts";
import { runSourceSync } from "../../../packages/infra/workspace/src/source-sync.ts";
if (import.meta.main) process.exit(await runSourceSync(process.argv.slice(2)));

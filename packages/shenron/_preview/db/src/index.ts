// SPDX-License-Identifier: Apache-2.0
/**
 * Legacy root entry: postgres-js `createDb`, config helpers and `schema`,
 * unchanged for existing consumers. Runtime class: `server`.
 */
import * as schema from "./schema";

export * from "./config";
export { schema };
export { createDb, type CreateDbOptions, type ShenronDb } from "./postgres-js";

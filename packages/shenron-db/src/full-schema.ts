// Source: packages/shenron/db/src/full-schema.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/** Public + `bot` schemas merged for a single Drizzle client. Runtime class: `pure`. */
import * as botSchema from "./bot-schema";
import * as schema from "./schema";

export const fullSchema = { ...schema, ...botSchema };
export type FullSchema = typeof fullSchema;

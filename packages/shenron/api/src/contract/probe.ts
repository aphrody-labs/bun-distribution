// SPDX-License-Identifier: Apache-2.0
/**
 * Type-only probe: `new OpenAPIHono()` from `@hono/zod-openapi` must compile
 * under the TypeScript 7 native compiler. The import is erased at runtime, so
 * `./contract` never loads hono.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";

type Construct<T> = T extends new (...args: infer A) => infer R ? { args: A; instance: R } : never;

export type OpenApiHonoProbe = Construct<typeof OpenAPIHono>["instance"];

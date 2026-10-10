// SPDX-License-Identifier: Apache-2.0
//! Native (Bun FFI) spec validator. Import only from Bun applications; the
//! package index and browser bundles must not reach this module.

import { validateSpec } from "@aphrody/bun";
import type { SpecValidator } from "./types.ts";

export const nativeSpecValidator: SpecValidator = validateSpec;

// SPDX-License-Identifier: Apache-2.0
// Consume the canonical runtime data; no generated code crosses repository boundaries.
import data from "../../../crates/aphrody-identity/assets/aphrody/web.json" with { type: "json" };
import type { PetWebData } from "./runtime";
export const PET_WEB = data as unknown as PetWebData;

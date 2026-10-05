// Copyright 2026 aphrody-code
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// shell.ts — thin re-export of Bun.$ for code that n2b flags as
// `api/child_process-exec`. `Bun.$` is Bun's shell template literal
// (cross-platform, no /bin/sh required) — callers can import it as a
// plain identifier via `import { sh } from "@aphrody/n2b-core/shims"`.
//
// Rationale: in a migrating codebase, ad-hoc `import { $ } from "bun"`
// lines are as noisy as `import { exec } from "child_process"`. A stable
// alias `sh` makes the refactor mechanical and keeps the import name
// agnostic to the Bun version's surface.

import { $ } from "bun";

/** Alias for `Bun.$`. Template-literal shell: `await sh\`ls -la\``. */
export const sh = $;

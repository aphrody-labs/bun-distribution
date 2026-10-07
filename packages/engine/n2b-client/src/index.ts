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

// @aphrody/n2b-core — native SDK scanning and explicit legacy CLI helpers.
//
// Related packages:
//   - @aphrody/n2b-core: native scan; rules/prompt/version stay CLI-backed.
//   - ./types: canonical generated SDK schema aliases (@aphrody/n2b-core/types).
//   - ./plugin: Bun.plugin() using the same native scan (@aphrody/n2b-core/plugin).
//   - @aphrody/n2b-core/shims : polyfills Bun-natifs des APIs Node détectées par n2b
//     (source unique ; le paquet @aphrody/n2b-shims est absorbé).

// Default scanning is native; these named helpers retain their explicit CLI semantics.
export { scan } from "./native";
export { rules, promptMarkdown, binaryVersion } from "./cli";
export type { ScanOptions } from "./native";
export type { N2BError } from "./cli";

export type { N2BReport, FileFix, Finding, Context, Mode, Severity } from "./types";

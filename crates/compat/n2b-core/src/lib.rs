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

// n2b-core — moteur métier : scanners, règles, report, run, ai, github, audit.
// Since 2026-10-02 the former crates aphrody-n2b-{ai,github,util,report,rules,
// scanners} live here as modules (same public paths `aphrody_n2b_core::<name>`).
// n2b-types (types + schema) stays a crate and is re-exported unchanged.

pub mod ai;
pub mod audit;
pub mod github;
pub mod llmstxt;
pub mod manifest;
pub mod report;
pub mod report_card;
pub mod rules;
pub mod run;
pub mod scanners;
pub mod util;

pub use aphrody_n2b_types::{REPORT_SCHEMA_V2, schema, types};

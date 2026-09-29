/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { existsSync } from "node:fs";
import { DEFAULT_FUT_DATABASE_PATH } from "../../src/repository/FutDatabaseRepository.ts";

/**
 * Whether the FUT player dataset is present.
 *
 * `fut_extracted_database.sqlite` is a generated crawl of live FUT.GG / FUTBIN data (produced by
 * `packages/fut/src/scripts/recursive_fut_scraper.ts` or `MassiveFutCrawler`). It is tens of
 * megabytes, changes with the live market and is ignored by Git, so a clean checkout or a CI
 * runner does not have it. Tests that assert on real player rows are gated with
 * `it.skipIf(!hasFutDataset)`; every other FUT test runs unconditionally.
 */
export const hasFutDataset = existsSync(DEFAULT_FUT_DATABASE_PATH);

export const FUT_DATASET_SKIP_REASON =
	`FUT dataset tests skipped: ${DEFAULT_FUT_DATABASE_PATH} is missing. ` +
	"Generate it with `bun packages/fut/src/scripts/recursive_fut_scraper.ts` to run them.";

if (!hasFutDataset) {
	console.warn(FUT_DATASET_SKIP_REASON);
}

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

import type { FutPageType, FutProvider } from "../router/types.ts";

export interface FutCrawlTarget {
	url: string;
	provider: FutProvider;
	pageType: FutPageType;
	priority: number;
}

export interface FutCrawlStats {
	crawled: number;
	total: number;
	success: number;
	errors: number;
	lastUrl?: string;
	lastEntity?: string;
	currentConcurrency: number;
}

export interface FutCrawlerOptions {
	concurrency?: number;
	maxPages?: number;
	providers?: FutProvider[];
	pageTypes?: FutPageType[];
	dbPath?: string;
	rateLimitMs?: number;
	onProgress?: (stats: FutCrawlStats) => void;
}

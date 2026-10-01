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

import { fetchFutResponse } from "../web.ts";
import type { SbcCategory, SbcChallenge, SbcSet } from "./types.ts";

export class FutSbcClient {
  public async getCategories(gameYear: string = "27"): Promise<SbcCategory[]> {
    const url = `https://www.fut.gg/api/fut/sbc/${gameYear}/categories/`;
    const res = await fetchFutResponse(url);
    if (res.status !== 200) {
      throw new Error(`Failed to fetch SBC categories: HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json.data ?? json) as SbcCategory[];
  }

  public async getSets(gameYear: string = "27", categorySlug?: string): Promise<SbcSet[]> {
    const url = categorySlug
      ? `https://www.fut.gg/api/fut/sbc/${gameYear}/?categorySlug=${encodeURIComponent(categorySlug)}`
      : `https://www.fut.gg/api/fut/sbc/${gameYear}/`;
    const res = await fetchFutResponse(url);
    if (res.status !== 200) {
      throw new Error(`Failed to fetch SBC sets: HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json.data ?? json) as SbcSet[];
  }

  public async getSetDetail(slug: string, gameYear: string = "27"): Promise<SbcSet> {
    const url = `https://www.fut.gg/api/fut/sbc/${gameYear}/${slug}/`;
    const res = await fetchFutResponse(url);
    if (res.status !== 200) {
      throw new Error(`Failed to fetch SBC detail for ${slug}: HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data as SbcSet;
  }

  public async getChallengeDetail(
    challengeEaId: number,
    gameYear: string = "27",
  ): Promise<SbcChallenge> {
    const url = `https://www.fut.gg/api/fut/sbc/${gameYear}/challenge/${challengeEaId}/`;
    const res = await fetchFutResponse(url);
    if (res.status !== 200) {
      throw new Error(`Failed to fetch SBC challenge ${challengeEaId}: HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data as SbcChallenge;
  }
}

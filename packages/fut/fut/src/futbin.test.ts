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

import { describe, expect, test } from "bun:test";
import { extractFutbinPlayer } from "./futbin.ts";

const PAGE = `<html><head><title>Kylian Mbappé FC 26 Rating and Price</title></head><body>
<div class="player-name">Kylian Mbappé</div>
<div class="pcdisplay-rat">91</div><div class="pcdisplay-pos">st</div>
<div class="pcdisplay-pac">97</div><div class="pcdisplay-sho">90</div>
<div class="pcdisplay-pas">80</div><div class="pcdisplay-dri">92</div>
<div class="pcdisplay-def">36</div><div class="pcdisplay-phy">78</div>
<span data-stat="finishing">94</span>
<span class="playstyle" data-name="Rapid"></span>
<span class="playstyle" data-name="Quick Step+"></span>
<a href="/clubs/243/real-madrid">club</a>
<a href="/nations/18/france">nation</a>
<a href="/leagues/53/laliga-ea-sports">league</a>
<span>5★ Skills</span><span>4★ Weak Foot</span>
</body></html>`;

describe("extractFutbinPlayer", () => {
	test("reads identity, face stats and sub-stats", () => {
		const player = extractFutbinPlayer(PAGE);
		expect(player).not.toBeNull();
		expect(player?.name).toBe("Kylian Mbappé");
		expect(player?.rating).toBe(91);
		expect(player?.position).toBe("ST");
		expect([player?.pac, player?.sho, player?.pas, player?.dri, player?.def, player?.phy]).toEqual([
			97, 90, 80, 92, 36, 78,
		]);
		expect(player?.finishing).toBe(94);
		// Absent sub-stats fall back to their face stat.
		expect(player?.sprintSpeed).toBe(97);
	});

	test("splits PlayStyles from PlayStyles+ and title-cases slugs", () => {
		const player = extractFutbinPlayer(PAGE);
		expect(player?.playstyles).toEqual(["Rapid"]);
		expect(player?.playstylesPlus).toEqual(["Quick Step+"]);
		expect(player?.club).toBe("Real Madrid");
		expect(player?.nation).toBe("France");
		expect(player?.league).toBe("Laliga Ea Sports");
		expect(player?.skillMoves).toBe(5);
		expect(player?.weakFoot).toBe(4);
	});

	test("falls back to the page title for the name", () => {
		const player = extractFutbinPlayer("<title>Jude Bellingham FC 26 Rating and Price</title>");
		expect(player?.name).toBe("Jude Bellingham");
	});

	test("returns null when no player name is present", () => {
		expect(extractFutbinPlayer("<html><body>nothing here</body></html>")).toBeNull();
	});
});

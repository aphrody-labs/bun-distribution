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

import type { Squad } from "./squad.ts";

export function renderAsciiPitch(squad: Squad): string {
	const slots = squad.getSlots();
	const chem = squad.getChemistry();
	const stats = squad.getStats();

	const header = [
		`┌────────────────────────────────────────────────────────────────────────┐`,
		`│  EA SPORTS FC 27 SQUAD BUILDER — FORMATION: ${squad.formation.name.padEnd(10)}                 │`,
		`│  RATING: ${String(stats.squadRating).padEnd(3)} | CHEM: ${String(chem.totalChemistry).padStart(2)}/33 | ATT: ${String(stats.attackRating).padEnd(3)} | MID: ${String(stats.midfieldRating).padEnd(3)} | DEF: ${String(stats.defenseRating).padEnd(3)}     │`,
		`├────────────────────────────────────────────────────────────────────────┤`,
	];

	// Sort slots by Y ascending (Attackers at top, GK at bottom)
	const sorted = [...slots].toSorted((a, b) => a.coordinates.y - b.coordinates.y);

	const lines: string[] = [...header];

	for (const slot of sorted) {
		const p = slot.player;
		const name = p ? p.name.slice(0, 20) : "Empty Slot";
		const rating = p ? String(p.rating) : "--";
		const chemDiamonds = "●".repeat(slot.chemistry) + "○".repeat(3 - slot.chemistry);
		const roleBadge = slot.assignedRoleTier === "plus_plus" ? `${slot.assignedRole}++` : slot.assignedRoleTier === "plus" ? `${slot.assignedRole}+` : slot.assignedRole;
		const inPosTag = p ? (slot.inPosition ? "✔" : "✘ (OOP)") : "";

		const row = `│  [${slot.position.padEnd(3)}] ${name.padEnd(20)} (${rating})  Chem: ${chemDiamonds}  Role: ${(roleBadge ?? "").padEnd(16)} ${inPosTag} │`;
		lines.push(row);
	}

	lines.push(`├────────────────────────────────────────────────────────────────────────┤`);
	if (squad.manager) {
		lines.push(`│  MANAGER: ${squad.manager.name} (${squad.manager.nation} / ${squad.manager.league})`.padEnd(73) + `│`);
	}
	lines.push(`│  BENCH: ${squad.substitutes.map((s) => `${s.name} (${s.rating})`).join(", ") || "None"}`.slice(0, 72).padEnd(73) + `│`);
	lines.push(`└────────────────────────────────────────────────────────────────────────┘`);

	return lines.join("\n");
}

export function renderSvgPitch(squad: Squad): string {
	const slots = squad.getSlots();
	const chem = squad.getChemistry();
	const stats = squad.getStats();

	const width = 1000;
	const height = 1350;

	const cardSvgElements = slots
		.map((slot) => {
			const x = (slot.coordinates.x / 100) * (width - 160) + 20;
			const y = (slot.coordinates.y / 100) * (height - 350) + 160;

			const p = slot.player;
			const name = p ? p.name.slice(0, 16) : `Add ${slot.position}`;
			const rating = p ? p.rating : "--";
			const club = p?.club ?? "";
			const nation = p?.nation ?? "";
			const chemActive = slot.chemistry;

			const diamond1 = chemActive >= 1 ? "#00FF66" : "#4B5563";
			const diamond2 = chemActive >= 2 ? "#00FF66" : "#4B5563";
			const diamond3 = chemActive >= 3 ? "#00FF66" : "#4B5563";

			const roleTag = slot.assignedRole
				? `<rect x="5" y="112" width="110" height="20" rx="4" fill="#1F2937" stroke="#374151" />
           <text x="60" y="126" font-size="10" font-family="sans-serif" font-weight="bold" fill="#F3F4F6" text-anchor="middle">${slot.assignedRoleTier === "plus_plus" ? `${slot.assignedRole}++` : slot.assignedRoleTier === "plus" ? `${slot.assignedRole}+` : slot.assignedRole}</text>`
				: "";

			return `
      <g transform="translate(${x}, ${y})">
        <!-- Card Background -->
        <rect width="120" height="140" rx="10" fill="#111827" stroke="${p ? "#E5E7EB" : "#374151"}" stroke-width="2" />
        
        <!-- Position & Rating Header -->
        <text x="12" y="28" font-size="20" font-family="sans-serif" font-weight="900" fill="#FBBF24">${rating}</text>
        <text x="12" y="45" font-size="12" font-family="sans-serif" font-weight="bold" fill="#9CA3AF">${slot.position}</text>

        <!-- Player Name -->
        <text x="60" y="70" font-size="12" font-family="sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${name}</text>
        <text x="60" y="85" font-size="9" font-family="sans-serif" fill="#9CA3AF" text-anchor="middle">${club} · ${nation}</text>

        <!-- Chemistry Diamonds -->
        <g transform="translate(42, 95)">
          <polygon points="6,0 12,6 6,12 0,6" fill="${diamond1}" />
          <polygon points="20,0 26,6 20,12 14,6" fill="${diamond2}" />
          <polygon points="34,0 40,6 34,12 28,6" fill="${diamond3}" />
        </g>

        <!-- FC IQ Role -->
        ${roleTag}
      </g>
    `;
		})
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <!-- Pitch Background -->
  <defs>
    <linearGradient id="grass" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0F5132" />
      <stop offset="100%" stop-color="#0A3622" />
    </linearGradient>
    <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
  </defs>

  <!-- Stadium Field -->
  <rect width="${width}" height="${height}" fill="url(#grass)" />

  <!-- Field Markings -->
  <rect x="40" y="140" width="${width - 80}" height="${height - 180}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.5" />
  <line x1="40" y1="${(height - 180) / 2 + 140}" x2="${width - 40}" y2="${(height - 180) / 2 + 140}" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.5" />
  <circle cx="${width / 2}" cy="${(height - 180) / 2 + 140}" r="90" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.5" />
  
  <!-- Penalty Box Top -->
  <rect x="${width / 2 - 180}" y="140" width="360" height="150" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.5" />
  
  <!-- Penalty Box Bottom -->
  <rect x="${width / 2 - 180}" y="${height - 190}" width="360" height="150" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.5" />

  <!-- Scoreboard & Squad Header -->
  <rect x="20" y="20" width="${width - 40}" height="100" rx="12" fill="url(#panel)" stroke="#334155" stroke-width="2" />
  <text x="40" y="55" font-size="24" font-family="sans-serif" font-weight="900" fill="#FFFFFF">EA SPORTS FC 27 SQUAD BUILDER</text>
  <text x="40" y="85" font-size="14" font-family="sans-serif" font-weight="bold" fill="#38BDF8">FORMATION: ${squad.formation.name}</text>
  
  <text x="500" y="65" font-size="32" font-family="sans-serif" font-weight="900" fill="#FBBF24" text-anchor="middle">${stats.squadRating}</text>
  <text x="500" y="85" font-size="12" font-family="sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">RATING</text>

  <text x="640" y="65" font-size="32" font-family="sans-serif" font-weight="900" fill="#22C55E" text-anchor="middle">${chem.totalChemistry}/33</text>
  <text x="640" y="85" font-size="12" font-family="sans-serif" font-weight="bold" fill="#94A3B8" text-anchor="middle">CHEMISTRY</text>

  <text x="820" y="55" font-size="14" font-family="sans-serif" font-weight="bold" fill="#CBD5E1">ATT: ${stats.attackRating} | MID: ${stats.midfieldRating} | DEF: ${stats.defenseRating}</text>
  <text x="820" y="80" font-size="12" font-family="sans-serif" fill="#F59E0B">CONSOLE: ${stats.totalPriceConsole.toLocaleString()} 🪙</text>

  <!-- Player Cards on Pitch -->
  ${cardSvgElements}
</svg>`;
}

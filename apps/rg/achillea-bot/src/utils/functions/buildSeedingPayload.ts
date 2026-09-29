import type { IdSeeding } from "brackets-model";

export type SeedingParticipantInput = {
	seed?: number | null;
	bracketParticipantId?: number | null;
};

/**
 * Construit le tableau de seeding pour brackets-manager.
 * Index 0 = seed 1, index 1 = seed 2, etc.
 * Les joueurs sans seed (ou seed hors taille) remplissent les slots vides dans l'ordre donné.
 */
export function buildSeedingPayload(
	size: number,
	participants: SeedingParticipantInput[]
): IdSeeding {
	const seedingPayload: IdSeeding = Array.from({ length: size }, () => null);
	const unseeded: number[] = [];

	for (const p of participants) {
		if (p.bracketParticipantId == null) continue;
		const bid = Number(p.bracketParticipantId);
		const seed = p.seed != null ? Number(p.seed) : null;

		if (seed != null && seed > 0 && seed <= size && seedingPayload[seed - 1] == null) {
			seedingPayload[seed - 1] = bid;
		} else {
			unseeded.push(bid);
		}
	}

	let ui = 0;
	for (let i = 0; i < size && ui < unseeded.length; i++) {
		if (seedingPayload[i] == null) {
			seedingPayload[i] = unseeded[ui++];
		}
	}

	return seedingPayload;
}

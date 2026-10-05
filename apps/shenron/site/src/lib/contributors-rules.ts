/**
 * contributors-rules — signaux d'intégrité sur l'activité d'un membre.
 *
 * Client-safe et pur : aucune requête, aucune dépendance à Drizzle. Le module
 * `contributors.ts` est `server-only`, ce qui rendrait ces règles intestables ;
 * elles vivent donc ici (même découpage que `ratings` / `ratings-rules`).
 *
 * Un signal décrit un FAIT mesuré, jamais un verdict : un fan qui revoit DBZ
 * en une semaine déclenche « rafale » sans avoir triché. C'est l'arbitre
 * humain qui tranche, le classement ne se ferme pas tout seul.
 */

export type CheatSignal = {
	code: string;
	level: "info" | "warn" | "alert";
	label: string;
	detail: string;
};

type RatingSample = {
	score: number;
	comment: string | null;
	createdAt: string;
};

type CommentSample = {
	body: string;
	createdAt: string;
};

/**
 * Signaux de suspicion sur la série de notes d'un membre.
 *
 * Pur (testable) et volontairement conservateur : chaque signal décrit un FAIT
 * mesuré, pas un verdict. Un fan qui revoit DBZ en une semaine déclenchera
 * « rafale » sans tricher pour autant — c'est à l'arbitre de trancher.
 */
export function detectCheatSignals(
	ratings: readonly RatingSample[],
	comments: readonly CommentSample[] = []
): CheatSignal[] {
	const signals: CheatSignal[] = [];
	const n = ratings.length;
	if (n === 0) return signals;

	// 1. Rafales : plus de 20 notes dans une même fenêtre d'une heure.
	const times = ratings
		.map((r) => new Date(r.createdAt).getTime())
		.filter((t) => Number.isFinite(t))
		.toSorted((a, b) => a - b);
	let worstBurst = 0;
	for (let i = 0, j = 0; i < times.length; i++) {
		while (times[i] - times[j] > 3_600_000) j++;
		worstBurst = Math.max(worstBurst, i - j + 1);
	}
	if (worstBurst >= 20) {
		signals.push({
			code: "burst",
			level: worstBurst >= 60 ? "alert" : "warn",
			label: "Rafale de notes",
			detail: `${worstBurst} notes déposées en moins d'une heure.`,
		});
	}

	// 2. Médianes : intervalle typique entre deux notes sous 5 s = automatisation.
	const gaps: number[] = [];
	for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
	if (gaps.length >= 10) {
		const sorted = gaps.slice().toSorted((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)];
		if (median < 5_000) {
			signals.push({
				code: "cadence",
				level: "alert",
				label: "Cadence non humaine",
				detail: `Intervalle médian de ${(median / 1000).toFixed(1)} s entre deux notes.`,
			});
		}
	}

	// 3. Scores plats : une seule valeur d'étoile sur ≥ 20 notes.
	const distinct = new Set(ratings.map((r) => r.score));
	if (n >= 20 && distinct.size === 1) {
		signals.push({
			code: "flat-scores",
			level: "warn",
			label: "Notes toutes identiques",
			detail: `${n} notes à ${[...distinct][0]} ★, aucune variation.`,
		});
	}

	// 4. Avis vides : quasi aucune note commentée.
	const written = ratings.filter((r) => (r.comment ?? "").trim().length > 0).length;
	if (n >= 30 && written / n < 0.05) {
		signals.push({
			code: "no-comment",
			level: "info",
			label: "Notes sans avis",
			detail: `${written}/${n} notes accompagnées d'un texte.`,
		});
	}

	// 5. Textes recyclés : même contenu copié sur plusieurs fiches.
	const bodies = [
		...ratings.map((r) => (r.comment ?? "").trim().toLowerCase()),
		...comments.map((c) => c.body.trim().toLowerCase()),
	].filter((b) => b.length > 0);
	const freq = new Map<string, number>();
	for (const b of bodies) freq.set(b, (freq.get(b) ?? 0) + 1);
	const worst = [...freq.entries()].toSorted((a, b) => b[1] - a[1])[0];
	if (worst && worst[1] >= 3) {
		signals.push({
			code: "duplicate-text",
			level: worst[1] >= 10 ? "alert" : "warn",
			label: "Texte recyclé",
			detail: `« ${worst[0].slice(0, 60)} » répété ${worst[1]} fois.`,
		});
	}

	// 6. Avis squelettiques : commentaires majoritairement sous 10 caractères.
	const shorties = bodies.filter((b) => b.length < 10).length;
	if (bodies.length >= 10 && shorties / bodies.length > 0.6) {
		signals.push({
			code: "short-text",
			level: "warn",
			label: "Avis squelettiques",
			detail: `${shorties}/${bodies.length} textes de moins de 10 caractères.`,
		});
	}

	return signals;
}


/**
 * Maintenance planifiée des saisons Achilléa.
 *
 * Cette transition ne dépend ni d'un gateway Discord ni du serveur HTTP du bot :
 * elle ne fait que comparer les dates persistées à `now()`. La laisser dans le
 * bot rendait l'état des saisons dépendant de la disponibilité du bot alors que
 * `rg-cron` est précisément le processus supervisé pour les tâches 24/7.
 */
import { sql } from "../lib/db.js";

export interface ResultatRolloverSaisons {
	activees: number;
	cloturees: number;
	success: true;
}

export async function runAchilleaSeasonRollover(): Promise<ResultatRolloverSaisons> {
	return sql.begin(async (tx) => {
		// Les tables importées d'Achilléa gardent leurs politiques RLS historiques.
		// `service_role` est le rôle d'écriture déjà utilisé par la projection
		// Discord dans `achillea-sync.ts`; il est impérativement réinitialisé.
		await tx`SET LOCAL ROLE service_role`;

		const activees = await tx`
			UPDATE achillea.season
			   SET state = 'Active', updated_at = now()
			 WHERE state = 'Upcoming' AND starts_at <= now()
			 RETURNING id`;
		const cloturees = await tx`
			UPDATE achillea.season
			   SET state = 'Closed', updated_at = now()
			 WHERE state = 'Active' AND ends_at <= now()
			 RETURNING id`;

		console.log(
			`[achillea] rollover saisons : ${activees.length} activée(s), ${cloturees.length} clôturée(s)`
		);
		return { activees: activees.length, cloturees: cloturees.length, success: true };
	});
}

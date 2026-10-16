/**
 * Versement hebdomadaire du staff Achilléa.
 *
 * Ce traitement n'a besoin ni du bot Discord ni de son conteneur d'injection :
 * les bénéficiaires, leurs portefeuilles et le journal comptable sont tous
 * persistés. L'exécuter ici rend son fonctionnement indépendant d'une coupure
 * du gateway Discord et donne à l'opération un verrou et une idempotence
 * explicites.
 */
import { sql } from "../lib/db.js";

const MONTANT_ACH = "100.00";
const RAISON = "Paiement hebdomadaire staff actif";
const ROLES_STAFF = [1, 2, 3] as const; // Moderator, Administrator, SuperAdministrator

export interface ResultatPaiementHebdomadaireAchillea {
  payes: number;
  success: true;
  /** Une autre instance possède déjà le verrou transactionnel. */
  ignore?: boolean;
}

export async function runAchilleaWeeklyPayout(): Promise<ResultatPaiementHebdomadaireAchillea> {
  return sql.begin(async tx => {
    // Les tables Achilléa ont conservé leurs RLS. SET LOCAL est limité à cette
    // transaction et ne peut donc jamais contaminer une connexion du pool.
    await tx`SET LOCAL ROLE service_role`;

    const [verrou] = await tx<Array<{ acquis: boolean }>>`
			SELECT pg_try_advisory_xact_lock(hashtext('rg-cron:achillea:weekly-payout')) AS acquis`;
    if (!verrou?.acquis) {
      return { ignore: true, payes: 0, success: true };
    }

    const [resultat] = await tx<Array<{ payes: number }>>`
			WITH semaine AS (
				SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS cle
			),
			beneficiaires AS (
				SELECT u.id
				  FROM achillea."user" u, semaine s
				 WHERE u.role = ANY(${ROLES_STAFF}::int[])
				   AND u.last_interact >= now() - interval '7 days'
				   AND NOT EXISTS (
					SELECT 1
					  FROM achillea."transaction" t
					 WHERE t.to_user_id = u.id
					   AND t.metadata @> jsonb_build_object('source', 'weekly-payout', 'week', s.cle)
				   )
			),
			portefeuilles AS (
				INSERT INTO achillea.wallet (id, user_id, balance, currency, created_at, updated_at)
				SELECT gen_random_uuid(), b.id, ${MONTANT_ACH}::decimal, 'ACH', now(), now()
				  FROM beneficiaires b
				ON CONFLICT (user_id) DO UPDATE
				   SET balance = achillea.wallet.balance + ${MONTANT_ACH}::decimal,
				       updated_at = now()
				RETURNING user_id
			),
			versements AS (
				INSERT INTO achillea."transaction" (id, type, amount, reason, to_user_id, metadata, created_at)
				SELECT gen_random_uuid(), 'Credit', ${MONTANT_ACH}::decimal, ${RAISON}, p.user_id,
				       jsonb_build_object('source', 'weekly-payout', 'week', s.cle), now()
				  FROM portefeuilles p CROSS JOIN semaine s
				RETURNING id
			)
			SELECT count(*)::int AS payes FROM versements`;

    console.log(`[achillea] paiement hebdomadaire : ${resultat?.payes ?? 0} membre(s) crédité(s)`);
    return { payes: resultat?.payes ?? 0, success: true };
  });
}

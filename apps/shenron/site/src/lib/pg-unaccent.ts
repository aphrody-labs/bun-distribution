/**
 * pg-unaccent — expression « texte sans accents, en minuscules » qui profite
 * d'un index quand il existe.
 *
 * `unaccent()` est STABLE : Postgres refuse de l'utiliser dans un index
 * d'expression. Le script `scripts/ops/manga-search-index.ts` crée donc un
 * wrapper IMMUTABLE (`bot.immutable_unaccent`) et des index GIN de trigrammes
 * dessus. Mais une requête n'utilise un index que si son expression est
 * IDENTIQUE à celle de l'index — et appeler une fonction absente fait échouer
 * la requête. D'où ce choix au premier appel : le wrapper s'il existe (index
 * utilisé, ~20 ms), `unaccent()` sinon (balayage, ~700 ms mesurés le
 * 2026-09-12 sur 12 593 planches), sans que l'appelant ait à le savoir.
 */
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";

let wrapper: Promise<boolean> | null = null;

/** Le wrapper IMMUTABLE est-il installé ? Lu une fois par process. */
function wrapperDisponible(): Promise<boolean> {
	wrapper ??= db
		.execute<{ ok: boolean }>(
			sql`SELECT to_regprocedure('bot.immutable_unaccent(text)') IS NOT NULL AS ok`
		)
		.then((rows) => rows[0]?.ok === true)
		.catch(() => false);
	return wrapper;
}

/** `lower(<sans accents>(expr))`, indexable quand le wrapper est installé. */
export async function sansAccents(expr: SQL): Promise<SQL> {
	return (await wrapperDisponible())
		? sql`lower(bot.immutable_unaccent(${expr}))`
		: sql`lower(unaccent(${expr}))`;
}

import { getPgPool } from "@/lib/db/pg";
import { respondreRecherche } from "./search-response";

/** Suggestions des trois domaines pendant la frappe dans le chrome partagé. */
export const dynamic = "force-dynamic";

export async function GET(requete: Request) {
	return respondreRecherche(requete, async (sql, params) => {
		const { rows } = await getPgPool().query(sql, params);
		return rows as never;
	});
}

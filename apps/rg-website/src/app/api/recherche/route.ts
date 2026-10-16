import { searchExecutors } from "@/lib/db/search";
import { respondreRecherche } from "./search-response";

/** Suggestions des trois domaines pendant la frappe dans le chrome partagé. */
export const dynamic = "force-dynamic";

export async function GET(requete: Request) {
	return respondreRecherche(requete, searchExecutors);
}

import "server-only";

/**
 * IP du client, telle que nginx la voit — clé de tout compteur anti-abus posé
 * devant une route publique.
 *
 * `x-real-ip` est posé par nginx au `$remote_addr` : c'est l'IP de la socket,
 * non usurpable. On NE fait PAS confiance au **premier** élément de
 * `x-forwarded-for`, qui est écrit par le client et permettrait de repartir de
 * zéro à chaque requête ; en dernier recours seulement, on lit le DERNIER hop,
 * celui qu'a ajouté le proxy de tête.
 *
 * `"unknown"` quand rien n'est lisible : un seau commun vaut mieux qu'aucune
 * limite, et ce cas n'existe pas derrière nginx.
 *
 * Ce module était recopié à l'identique dans `api/admin-access` et
 * `api/telemetry` ; il est ici pour que la doctrine ne diverge pas d'une copie
 * à l'autre. Une IP n'est jamais stockée telle quelle (cf. le hachage quotidien
 * de la télémétrie), elle ne sert qu'à compter en mémoire.
 */
export function clientIp(req: Request): string {
	const realIp = req.headers.get("x-real-ip")?.trim();
	if (realIp) return realIp;
	const xff = req.headers.get("x-forwarded-for");
	if (xff) {
		const parts = xff
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (parts.length) return parts[parts.length - 1]!;
	}
	return "unknown";
}

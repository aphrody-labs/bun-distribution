// Garde-fous d'URL pour tout ce qui vient de Discord.
//
// Le contenu republié provient d'utilisateurs : aucune URL ne doit être rendue
// en lien ou en image sans avoir été validée. Seuls `http` et `https` sont
// acceptés (donc ni `javascript:`, ni `data:`, ni `vbscript:`, ni les schémas
// applicatifs type `discord://`).

const SCHEMAS_AUTORISES = new Set(["http:", "https:"]);

/** Vrai si l'URL est absolue et porte un schéma web sûr. */
export function estUrlSure(url: unknown): url is string {
	if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
	try {
		return SCHEMAS_AUTORISES.has(new URL(url).protocol);
	} catch {
		return false;
	}
}

/** Renvoie l'URL telle quelle si elle est sûre, sinon `null`. */
export function urlSureOuNull(url: unknown): string | null {
	return estUrlSure(url) ? url : null;
}

/** Hôtes servant les fichiers joints Discord derrière une signature temporaire. */
const HOTES_CDN_DISCORD = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/**
 * Vrai si l'URL est un fichier Discord SIGNÉ, donc périssable.
 *
 * Depuis 2023 Discord signe les liens de pièces jointes : `ex=` (expiration
 * unix, en hexadécimal), `is=` (émission) et `hm=` (signature). Mesuré le
 * 12/8/2026 sur nos propres données : `ex=6a7dce9a` = 13/8/2026 14h03 UTC, soit
 * moins de 24 h, et la même URL privée de sa query répond 404. Republier un tel
 * lien, c'est publier une page qui casse demain.
 */
export function estUrlDiscordExpirante(url: string): boolean {
	try {
		const analysee = new URL(url);
		if (!HOTES_CDN_DISCORD.has(analysee.hostname)) return false;
		return analysee.searchParams.has("ex") && analysee.searchParams.has("hm");
	} catch {
		return false;
	}
}

/**
 * URL publiable telle quelle : sûre ET durable.
 *
 * ⚠ TANT QUE LES PIÈCES JOINTES NE SONT PAS RÉ-HÉBERGÉES, une URL Discord signée
 * est écartée plutôt que republiée. C'est le choix déjà fait pour les visuels de
 * sondage, eux recopiés dans le bucket public `assets` par le cron
 * (`televerserVisuel()`, packages/cron/src/tasks/discord-polls.ts) : `visual_path`
 * porte un chemin de stockage, jamais un lien `discordapp`. Le jour où la même
 * recopie sera faite pour `discord_messages.attachments`, c'est le chemin
 * ré-hébergé qui devra arriver ici — pas la signature.
 */
export function urlPubliableOuNull(url: unknown): string | null {
	const sure = urlSureOuNull(url);
	return sure && !estUrlDiscordExpirante(sure) ? sure : null;
}

/**
 * URL CDN d'un emoji personnalisé Discord.
 * Les emojis animés n'existent qu'en `.gif`, les autres sont servis en `.webp`.
 */
export function urlEmojiPersonnalise(id: string, anime = false): string {
	return `https://cdn.discordapp.com/emojis/${id}.${anime ? "gif" : "webp"}`;
}

/** Convertit la couleur entière de l'API Discord en couleur CSS (`#rrggbb`). */
export function couleurDiscord(valeur: unknown): string | null {
	if (typeof valeur !== "number" || !Number.isFinite(valeur)) return null;
	const entier = Math.trunc(valeur);
	if (entier <= 0 || entier > 0xff_ff_ff) return null;
	return `#${entier.toString(16).padStart(6, "0")}`;
}

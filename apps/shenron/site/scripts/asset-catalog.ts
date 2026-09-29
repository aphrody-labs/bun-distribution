/**
 * Catalogue de sources d'assets joignables (SFX + images).
 * Séparé de l'ingest pour tests unitaires sans I/O réseau obligatoire.
 */

export type SfxCatalogEntry = {
	/** Nom fichier sous public/sfx/ */
	filename: string;
	/** URL source */
	url: string;
	/** Rôle runtime (slot sfx ou extra) */
	role: string;
	source: string;
};

const MI = "https://www.myinstants.com/media/sounds";

/** Sons MyInstants DBZ — droits d'usage déclarés FR (Toei/Shueisha) par l'équipe. */
export const SFX_CATALOG: readonly SfxCatalogEntry[] = [
	// ── Slots home canoniques ──────────────────────────────────────────────
	{
		filename: "kamehameha.mp3",
		url: `${MI}/kamehameha.mp3`,
		role: "kamehameha",
		source: "myinstants",
	},
	{
		filename: "kamehameha-wave.mp3",
		url: `${MI}/kamehameha-wave-sound-effect.mp3`,
		role: "kamehameha-wave",
		source: "myinstants",
	},
	{ filename: "teleport.mp3", url: `${MI}/teleport.mp3`, role: "teleport", source: "myinstants" },
	{
		filename: "dragon-ball-teleport.mp3",
		url: `${MI}/dragon-ball-teleport.mp3`,
		role: "teleport-alt",
		source: "myinstants",
	},
	{ filename: "ki-charge.mp3", url: `${MI}/charging.mp3`, role: "kiCharge", source: "myinstants" },
	{
		filename: "charging.mp3",
		url: `${MI}/charging.mp3`,
		role: "kiCharge-src",
		source: "myinstants",
	},
	{ filename: "hit.mp3", url: `${MI}/hit.mp3`, role: "hit", source: "myinstants" },
	{ filename: "punch.mp3", url: `${MI}/punch.mp3`, role: "punch", source: "myinstants" },
	{ filename: "whoosh.mp3", url: `${MI}/whoosh.mp3`, role: "whoosh", source: "myinstants" },
	{ filename: "select.mp3", url: `${MI}/select.mp3`, role: "select", source: "myinstants" },
	{ filename: "click.mp3", url: `${MI}/click.mp3`, role: "click", source: "myinstants" },
	{ filename: "power-up.mp3", url: `${MI}/powerup.mp3`, role: "powerUp", source: "myinstants" },
	{ filename: "powerup.mp3", url: `${MI}/powerup.mp3`, role: "powerUp-src", source: "myinstants" },
	{
		filename: "final-flash.mp3",
		url: `${MI}/final-flash.mp3`,
		role: "finalFlash",
		source: "myinstants",
	},
	{ filename: "over9000.mp3", url: `${MI}/over-9000.mp3`, role: "over9000", source: "myinstants" },
	{
		filename: "its-over-9000.mp3",
		url: `${MI}/its-over-9000.mp3`,
		role: "over9000-alt",
		source: "myinstants",
	},
	{ filename: "scream.mp3", url: `${MI}/scream.mp3`, role: "scream", source: "myinstants" },
	// ── Extras / banque ────────────────────────────────────────────────────
	{ filename: "impact.mp3", url: `${MI}/impact.mp3`, role: "extra-impact", source: "myinstants" },
	{
		filename: "explosion.mp3",
		url: `${MI}/explosion.mp3`,
		role: "extra-explosion",
		source: "myinstants",
	},
	{
		filename: "dragon-ball.mp3",
		url: `${MI}/dragon-ball.mp3`,
		role: "extra-dragon-ball",
		source: "myinstants",
	},
	{ filename: "goku.mp3", url: `${MI}/goku.mp3`, role: "extra-goku", source: "myinstants" },
	{ filename: "vegeta.mp3", url: `${MI}/vegeta.mp3`, role: "extra-vegeta", source: "myinstants" },
	{
		filename: "kienzan.mp3",
		url: `${MI}/kienzan.mp3`,
		role: "extra-kienzan",
		source: "myinstants",
	},
	{
		filename: "kaioken.mp3",
		url: `${MI}/kaioken.mp3`,
		role: "extra-kaioken",
		source: "myinstants",
	},
	{
		filename: "kaio-ken.mp3",
		url: `${MI}/kaio-ken.mp3`,
		role: "extra-kaioken-alt",
		source: "myinstants",
	},
	{ filename: "fusion.mp3", url: `${MI}/fusion.mp3`, role: "extra-fusion", source: "myinstants" },
	{
		filename: "shenron.mp3",
		url: `${MI}/shenron.mp3`,
		role: "extra-shenron",
		source: "myinstants",
	},
	// Tentatives additionnelles (peuvent 404 — l'ingest logue et continue)
	{ filename: "galick.mp3", url: `${MI}/galick-gun.mp3`, role: "galick", source: "myinstants" },
	{
		filename: "spirit-bomb.mp3",
		url: `${MI}/spirit-bomb.mp3`,
		role: "extra-spirit-bomb",
		source: "myinstants",
	},
	{ filename: "nimbus.mp3", url: `${MI}/nimbus.mp3`, role: "nimbus", source: "myinstants" },
	{
		filename: "tapion-ocarina.mp3",
		url: `${MI}/tapion-ocarina.mp3`,
		role: "tapion",
		source: "myinstants",
	},
	{
		filename: "instant-transmission.mp3",
		url: `${MI}/instant-transmission.mp3`,
		role: "teleport-instant",
		source: "myinstants",
	},
];

export const IMAGE_API = "https://dragonball-api.com/api";

export type InventoryRecord = {
	path: string;
	role: string;
	source: string;
	url: string;
	ok: boolean;
	bytes: number;
	error: string | null;
	cached?: boolean;
};

/** Résout le mapping slot runtime → filename installé (après applyCanonicalSlots). */
export const CANONICAL_SFX_SLOTS: Record<string, string> = {
	teleport: "teleport.mp3",
	kamehameha: "kamehameha.mp3",
	kiCharge: "ki-charge.mp3",
	hit: "hit.mp3",
	punch: "punch.mp3",
	whoosh: "whoosh.mp3",
	select: "select.mp3",
	click: "click.mp3",
	powerUp: "power-up.mp3",
	finalFlash: "final-flash.mp3",
	over9000: "over9000.mp3",
	scream: "scream.mp3",
	tapion: "tapion-ocarina.mp3",
	galick: "galick.mp3",
	nimbus: "nimbus.mp3",
};

export function catalogRoles(): string[] {
	return [...new Set(SFX_CATALOG.map((e) => e.role))];
}

export function catalogHasRole(role: string): boolean {
	return SFX_CATALOG.some((e) => e.role === role || e.role.startsWith(role));
}

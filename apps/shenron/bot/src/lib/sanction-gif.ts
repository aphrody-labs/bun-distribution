/**
 * GIFs thématiques DBZ pour les actions de modération.
 *
 * Defaults servis localement depuis `assets/sanctions/<action>.gif` (route
 * `/assets/sanctions/*` du serveur Bun). Avantage : pas de dépendance Tenor
 * / Discord CDN qui purgent les URLs anciennes (l'attachment Discord original
 * du serveur expirait au bout de 7 jours, et les URLs Tenor partagées ont
 * été purgées en masse). Override possible via `gif.<action>` côté
 * `SettingsService` si l'admin veut un GIF custom.
 *
 * Si le fichier local n'existe pas, Discord affiche l'embed sans image
 * (fallback silencieux côté Discord, pas de crash bot).
 */
import { container } from "tsyringe";
import { SettingsService } from "~/services/SettingsService";

export type SanctionAction =
	| "warn"
	| "unwarn"
	| "mute"
	| "unmute"
	| "kick"
	| "ban"
	| "unban"
	| "jail"
	| "unjail"
	| "purge";

const BASE = "https://bot.dragonballfr.com/assets/sanctions";

const DEFAULT_GIFS: Record<SanctionAction, string> = {
	jail: `${BASE}/jail.gif`,
	unjail: `${BASE}/unjail.gif`,
	purge: `${BASE}/purge.gif`,
	ban: `${BASE}/ban.gif`,
	unban: `${BASE}/unban.gif`,
	kick: `${BASE}/kick.gif`,
	mute: `${BASE}/mute.gif`,
	unmute: `${BASE}/unmute.gif`,
	warn: `${BASE}/warn.gif`,
	unwarn: `${BASE}/unwarn.gif`,
};

export async function gifFor(action: SanctionAction): Promise<string | undefined> {
	try {
		const settings = container.resolve(SettingsService);
		const override = await settings.getRaw(`gif.${action}`);
		if (override && /^https:\/\//i.test(override)) return override;
	} catch {
		// SettingsService pas encore prêt — utilise le défaut
	}
	return DEFAULT_GIFS[action];
}

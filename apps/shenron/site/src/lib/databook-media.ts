/**
 * Politique publique des médias de databooks.
 *
 * DragonballCN est une source publique du corpus Dragon Ball. Les planches
 * distantes sous `comic.dragonballcn.com/list/**` sont donc exposables comme
 * médias du wiki, sous réserve de la validation générale des URL.
 */

export function isPublicDatabookImage(raw: string | null | undefined): boolean {
	const value = raw?.trim();
	if (!value) return false;

	if (!/^https?:\/\//i.test(value)) {
		// Les assets historiques sont relatifs. Les autres schémas et les URL
		// protocol-relative ne doivent jamais atteindre `next/image`.
		return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//");
	}

	try {
		new URL(value);
	} catch {
		return false;
	}

	return true;
}

/** Référence normalisée à exposer au navigateur, ou `null` si elle est muette. */
export function publicDatabookImage(raw: string | null | undefined): string | null {
	return isPublicDatabookImage(raw) ? raw!.trim() : null;
}

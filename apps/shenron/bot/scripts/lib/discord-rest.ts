/**
 * discord-rest.ts — Le minimum vital pour parler à l'API Discord depuis un script.
 *
 * Pas de gateway, pas de discord.js : un script d'ops n'a pas à ouvrir une
 * seconde connexion temps réel à côté du bot en production. Ce module porte les
 * deux seules choses qui ne s'improvisent pas — l'attente annoncée par Discord
 * sur un 429 (la deviner ne sert à rien, elle est dans le corps de la réponse)
 * et un parallélisme borné qui préserve l'ordre des résultats.
 */

const API = "https://discord.com/api/v10";

/** Le jeton vient du `.env` du bot, jamais d'un argument (historique du shell). */
export async function jetonDiscord(persona = "GRAND_PRETRE"): Promise<string> {
	const cle = `DISCORD_TOKEN_${persona}`;
	const direct = process.env[cle]?.trim();
	if (direct) return direct;
	const chemin = new URL("../../.env", import.meta.url).pathname;
	const texte = await Bun.file(chemin)
		.text()
		.catch(() => "");
	const ligne = texte.split("\n").find((l) => l.trim().startsWith(`${cle}=`));
	const valeur = ligne
		?.split("=")
		.slice(1)
		.join("=")
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error(`${cle} introuvable (env ou apps/shenron/bot/.env)`);
	return valeur;
}

export interface OptionsAppel {
	readonly methode?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	readonly corps?: unknown;
	readonly essais?: number;
}

export type ClientDiscord = <T>(chemin: string, options?: OptionsAppel) => Promise<T>;

/** Construit un client lié à un jeton, qui respecte `retry_after` plutôt que de le subir. */
export function clientDiscord(token: string): ClientDiscord {
	return async function appel<T>(chemin: string, options: OptionsAppel = {}): Promise<T> {
		const { methode = "GET", corps, essais = 5 } = options;
		for (let essai = 1; ; essai++) {
			const reponse = await fetch(`${API}${chemin}`, {
				method: methode,
				headers: {
					Authorization: `Bot ${token}`,
					...(corps === undefined ? {} : { "Content-Type": "application/json" }),
				},
				body: corps === undefined ? undefined : JSON.stringify(corps),
			});
			if (reponse.status === 429) {
				const detail = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
				await Bun.sleep(Math.ceil((detail.retry_after ?? 1) * 1000) + 250);
				continue;
			}
			if (!reponse.ok) {
				const texte = await reponse.text();
				// 4xx hors 429 : la requête est fautive, la rejouer ne la corrigera pas.
				if (reponse.status < 500 || essai >= essais)
					throw new Error(`${methode} ${chemin} → HTTP ${reponse.status} ${texte}`);
				await Bun.sleep(500 * essai);
				continue;
			}
			if (reponse.status === 204) return undefined as T;
			return (await reponse.json()) as T;
		}
	};
}

/** Parallélisme borné, en préservant l'ordre des résultats. */
export async function enParallele<E, S>(
	elements: readonly E[],
	concurrence: number,
	travail: (element: E, index: number) => Promise<S>
): Promise<S[]> {
	const resultats: S[] = Array.from({ length: elements.length }) as S[];
	let curseur = 0;
	const ouvriers = Array.from(
		{ length: Math.max(1, Math.min(concurrence, elements.length || 1)) },
		async () => {
			for (;;) {
				const i = curseur++;
				if (i >= elements.length) return;
				resultats[i] = await travail(elements[i] as E, i);
			}
		}
	);
	await Promise.all(ouvriers);
	return resultats;
}

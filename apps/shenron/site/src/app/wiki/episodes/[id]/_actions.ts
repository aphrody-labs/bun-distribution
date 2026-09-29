"use server";

/**
 * Server actions dédiées au média des épisodes (vidéo + sous-titres), écrites
 * **directement dans Neon** via Drizzle (aucun proxy bot). Le wiki est édité
 * côté site → Neon est la source de vérité (cf. CLAUDE.md). Gardé admin.
 */
import { db } from "@/lib/db";
import { botEpisodes } from "@/db/bot-schema";
import { env } from "@/lib/env";
import { API_URL } from "@/lib/config";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
// Garde admin COMMUNE (`@/lib/session`) et non une copie locale. Celle qui
// vivait ici prenait le PREMIER compte Better Auth du visiteur sans filtrer
// `providerId = "discord"` : sur un compte à deux fournisseurs liés, elle
// comparait un identifiant qui n'est pas un Discord ID à `users.discordId`.
// Elle ignorait aussi l'admin par jeton (cookie signé `SHENRON_ADMIN_TOKEN`),
// que la garde commune sait reconnaître — un admin sans Discord était renvoyé
// vers /signin depuis cette page, et seulement celle-ci.
import { requireAdmin } from "@/lib/session";

type SubtitleTrack = { lang: string; label: string; src: string };

/** Valide/normalise une liste de pistes de sous-titres venue du formulaire. */
function parseSubtitles(raw: string): SubtitleTrack[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw || "[]");
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const out: SubtitleTrack[] = [];
	for (const t of parsed) {
		if (!t || typeof t !== "object") continue;
		const lang = String((t as Record<string, unknown>).lang ?? "").trim();
		const src = String((t as Record<string, unknown>).src ?? "").trim();
		const label = String((t as Record<string, unknown>).label ?? "").trim() || lang;
		// `src` = chemin d'asset bot (.vtt/.srt) ou URL .vtt. On rejette tout le
		// reste pour éviter d'injecter une source douteuse dans le lecteur.
		const okSrc =
			/^assets\/subtitles\/[\w.\-/]+\.(srt|vtt)$/.test(src) || /^https?:\/\/\S+\.vtt$/.test(src);
		if (lang && okSrc) out.push({ lang, label, src });
	}
	return out;
}

/**
 * Met à jour l'URL vidéo (lien officiel uniquement) et les pistes de
 * sous-titres d'un épisode. `videoUrl` vide → on efface le champ.
 */
export async function updateEpisodeMedia(episodeId: number, formData: FormData) {
	await requireAdmin();
	if (!Number.isInteger(episodeId)) return;

	// `videoUrl` finit en en-tête `Location` (`/api/episodes/[id]/download`) : on
	// n'accepte donc que du http(s) absolu. Sans ça, un `javascript:` collé ici
	// devenait une redirection ouverte stockée, et une valeur relative un 500.
	// Le champ voisin `subtitles` était déjà validé — pas celui-ci.
	const videoUrl = safeHttpUrl(String(formData.get("videoUrl") ?? ""));
	const subtitles = parseSubtitles(String(formData.get("subtitles") ?? ""));

	await db
		.update(botEpisodes)
		.set({ videoUrl, subtitles: subtitles.length ? subtitles : null })
		.where(eq(botEpisodes.id, episodeId));

	revalidatePath(`/wiki/episodes/${episodeId}`);
}

/**
 * Importe un fichier de sous-titres (.vtt/.srt) pour un épisode : relaie le
 * multipart vers le bot (`/api/assets/upload-subtitle`) — le token admin reste
 * server-only. Retourne le chemin d'asset (`src`) à enregistrer dans une piste.
 */
export async function uploadEpisodeSubtitle(
	episodeId: number,
	formData: FormData
): Promise<{ src: string } | { error: string }> {
	await requireAdmin();
	const file = formData.get("file");
	const lang = String(formData.get("lang") ?? "")
		.trim()
		.toLowerCase();
	if (!(file instanceof File) || file.size === 0) return { error: "Aucun fichier" };
	if (!/^[a-z]{2,5}(-[a-z]{2,5})?$/.test(lang)) return { error: "Langue invalide (ex. fr)" };

	const token = env.SHENRON_ADMIN_TOKEN;
	if (!token) return { error: "SHENRON_ADMIN_TOKEN absent côté site" };

	const upstream = new FormData();
	upstream.append("file", file, file.name);
	upstream.append("episodeId", String(episodeId));
	upstream.append("lang", lang);
	try {
		const res = await fetch(`${API_URL}/api/assets/upload-subtitle`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			body: upstream,
			cache: "no-store",
		});
		const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
		if (!res.ok || !data?.src) {
			return { error: data?.error ?? `Upload échoué (${res.status})` };
		}
		return { src: data.src };
	} catch (err) {
		return { error: err instanceof Error ? err.message : "Upload échoué" };
	}
}

/** N'accepte qu'une URL absolue http(s) ; tout le reste devient `null`. */
function safeHttpUrl(raw: string): string | null {
	const v = raw.trim();
	if (!v) return null;
	if (!URL.canParse(v)) return null;
	const u = new URL(v);
	return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
}

import "server-only";

import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import { createPostgresClient } from "@rosegriffon/db/service";
import { revalidatePath } from "next/cache";

import { getServerUser } from "@/lib/auth-helpers";

/*
 * Garde d'administration des écrans de campagne, et rafraîchissement des pages
 * qu'une écriture rend caduques.
 *
 * ── POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS `"use server"` ─────
 * `exigerAdmin()` vivait en PRIVÉ dans `app/admin/iergday/actions.ts`. Le tirage
 * au sort a ajouté un second fichier d'actions sur le même écran, et il fallait
 * choisir entre deux mauvaises options : recopier la garde (deux implémentations
 * de la même règle de sécurité, dont une finira par prendre du retard sur
 * l'autre), ou l'exporter depuis un fichier `"use server"` — ce qui en aurait
 * fait un POINT D'ENTRÉE HTTP à part entière, c'est-à-dire un oracle public
 * répondant « oui / non » à la question « suis-je admin ? » pour n'importe quel
 * porteur de cookie. Ni l'une ni l'autre.
 *
 * `import "server-only"` et non `"use server"` : ce module est appelé DEPUIS des
 * server actions, il n'en est pas une. La directive `server-only` fait échouer le
 * build si un composant client l'importe par mégarde, ce qui est exactement la
 * protection recherchée ; `"use server"` aurait exposé chaque export.
 *
 * ── LA GARDE EST REFAITE À CHAQUE ACTION, JAMAIS HÉRITÉE ───────────────────
 * `app/admin/layout.tsx` protège l'AFFICHAGE des pages. Il ne protège RIEN d'une
 * server action : celle-ci s'appelle par un POST, sans avoir jamais rendu la
 * page qui la déclare. Toute fonction exportée d'un fichier `"use server"` de
 * cet écran commence donc par `exigerAdmin()`.
 */

/** Ce que la garde rend quand elle laisse passer, ou quand elle refuse. */
export type Garde = { ok: true; userId: string; role: string | null } | { ok: false; message: string };

/**
 * Vérifie que l'appelant est bien membre du staff.
 *
 * Rend un objet plutôt que de rediriger : une server action doit pouvoir
 * répondre « permissions insuffisantes » à son appelant. `requireAdmin()`
 * (`lib/auth-helpers.ts`) enchaîne deux `redirect()` et n'a rien à faire ici.
 *
 * ⚠ `userId` EST DANS LE RETOUR, ET C'EST DÉLIBÉRÉ. Le tirage écrit
 * `x_campagne_tirages.effectue_par` : savoir QUI a engagé et QUI a tiré est la
 * moitié de la valeur d'un dispositif vérifiable. Le redemander plus loin
 * relirait la session une seconde fois — et surtout laisserait la porte ouverte
 * à ce qu'une action écrive un identifiant venu d'ailleurs que de la garde.
 */
export async function exigerAdmin(): Promise<Garde> {
	const user = await getServerUser();
	if (!user) return { message: "Non authentifié", ok: false };

	const profil = await resolveProfile(createPostgresClient(), user);
	if (!profil || !isAdmin(profil.role)) {
		return { message: "Permissions insuffisantes", ok: false };
	}
	return { ok: true, role: profil.role ?? null, userId: user.id };
}

/**
 * Rafraîchit les deux écrans concernés par un changement de campagne.
 *
 * Les deux, jamais l'un sans l'autre : `/admin/iergday` et `/iergday` lisent la
 * même donnée sous deux angles, et n'en rafraîchir qu'un laisse le staff
 * regarder un état que le public ne voit pas encore — ou l'inverse, ce qui est
 * pire.
 */
export function revaliderCampagne(): void {
	revalidatePath("/admin/iergday");
	revalidatePath("/iergday");
}

"use client";

/**
 * Actions admin **inline** sur une fiche wiki publique — rendues à l'intérieur
 * de `WikiEditBar`, aux côtés du chemin de contribution ouvert à tous. Îlot client gaté
 * par `useMe().isAdmin` → invisible au public, et n'introduit aucun cookie/entête
 * dans le rendu SSR de la page (cache CDN/ISR préservé — cf. piège « JAMAIS de
 * session dans le rendu d'une page publique »).
 *
 * Donne à l'admin, directement depuis la page :
 *   - « Modifier » → studio d'édition (formulaire + sections + relations) ;
 *   - « Masquer » → bascule `visible = false` (POST /api/wiki-admin/:table?as=visibility)
 *     puis redirige vers l'index, car la fiche masquée renvoie 404 en lecture publique.
 */
import { Bouclier, Crayon, OeilBarre } from "@/components/icones";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiAt } from "@/lib/admin-api";
import { useMe } from "@/lib/use-me";

export function WikiAdminActions({
	table,
	id,
	indexHref,
	label,
}: {
	table: string;
	id: string | number;
	/** Où rediriger après masquage (la fiche masquée devient 404). */
	indexHref: string;
	/** Nom de l'entité (confirmation de masquage). */
	label?: string;
}) {
	const me = useMe();
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	if (!me?.isAdmin) return null;

	const studioHref = `/admin/wiki/studio/${table}/${encodeURIComponent(String(id))}`;

	async function hide() {
		if (busy) return;
		const ok = window.confirm(
			`Masquer « ${label ?? "cette fiche"} » du site public ?\n\nElle restera modifiable et réaffichable depuis /admin/visibilite.`
		);
		if (!ok) return;
		setBusy(true);
		setErr(null);
		try {
			await apiAt("/api/wiki-admin").post(`/${table}?as=visibility`, { id, visible: false });
			router.push(indexHref);
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Échec du masquage.");
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-2 rounded-lg border border-dbz-orange/30 bg-dbz-orange/[0.06] px-3 py-2 text-xs">
			<span className="flex items-center gap-1.5 font-bold uppercase tracking-widest text-dbz-orange/80">
				<Bouclier className="h-3.5 w-3.5" /> Admin
			</span>
			<a
				href={studioHref}
				className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-white/[0.03] px-3 py-1.5 font-semibold text-white/80 transition-colors hover:border-dbz-orange/60 hover:text-white"
			>
				<Crayon className="h-3.5 w-3.5" /> Modifier &amp; sections
			</a>
			<button
				type="button"
				onClick={hide}
				disabled={busy}
				className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-white/[0.03] px-3 py-1.5 font-semibold text-white/80 transition-colors hover:border-dbz-red/60 hover:text-dbz-red disabled:opacity-50"
			>
				<OeilBarre className="h-3.5 w-3.5" /> {busy ? "Masquage…" : "Masquer"}
			</button>
			<a
				href="/admin/visibilite"
				className="text-white/50 underline-offset-2 transition-colors hover:text-white/70 hover:underline"
			>
				Gérer la visibilité
			</a>
			{err && <span className="text-dbz-red">{err}</span>}
		</div>
	);
}

/**
 * @deprecated Utiliser `WikiEditBar`, qui rend ces actions ET le chemin de
 * contribution communautaire. Conservé le temps que les pages migrent.
 */
const WikiAdminBar = WikiAdminActions;

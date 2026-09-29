"use client";

/**
 * « Mes propositions » — la boucle de retour, côté contributeur.
 *
 * Sans cet écran, la note du relecteur n'atteint personne : un refus reste un
 * silence, et quelqu'un qui a pris le temps de lire une planche n'a aucune
 * raison de recommencer. C'est la moitié la moins visible du système de
 * contribution, et probablement la plus déterminante.
 *
 * Îlot client (`/api/wiki/contributions`, session requise) monté sur une page
 * publique en ISR : la page reste cachée, seul ce bloc se peuple côté navigateur.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Chargement } from "@/components/icones";
import {
	CONTRIBUTABLE_COLUMNS,
	CONTRIBUTION_STATUS_LABELS,
	type ContributionStatusKey,
} from "@/lib/contributions-shared";
import { useMe } from "@/lib/use-me";

interface Ligne {
	id: string;
	createdAt: string;
	columnName: string;
	entityLabel: string | null;
	entityPath: string | null;
	status: ContributionStatusKey;
	reviewNote: string | null;
}

const TON: Record<ContributionStatusKey, string> = {
	pending: "border-white/15 text-white/55",
	accepted: "border-emerald-400/40 text-emerald-300",
	rejected: "border-dbz-red/40 text-dbz-red",
	superseded: "border-amber-400/40 text-amber-300",
	withdrawn: "border-white/10 text-white/35",
};

export function MesContributions() {
	const me = useMe();
	const [lignes, setLignes] = useState<Ligne[] | null>(null);
	const [charge, setCharge] = useState(false);
	/**
	 * Un échec de chargement se disait « tu n'as pas encore proposé de
	 * correction » — le message exactement contraire à ce que vit un contributeur
	 * dont les propositions existent mais ne se chargent pas. C'est la boucle de
	 * retour du système de contribution : lui faire croire que son travail a
	 * disparu est le pire des rendus possibles.
	 */
	const [erreur, setErreur] = useState(false);

	useEffect(() => {
		if (!me?.authenticated || charge) return;
		setCharge(true);
		fetch("/api/wiki/contributions?limit=30", { credentials: "same-origin" })
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d: { rows?: Ligne[] }) => setLignes(d.rows ?? []))
			.catch(() => {
				setErreur(true);
				setLignes([]);
			});
	}, [me?.authenticated, charge]);

	if (!me?.authenticated) return null;

	return (
		<section className="mt-14">
			<h2 className="font-saiyan text-2xl uppercase text-white">Mes propositions</h2>
			{lignes === null ? (
				<p className="mt-4 flex items-center gap-2 text-sm text-white/40">
					<Chargement className="h-4 w-4 animate-spin" /> Chargement…
				</p>
			) : erreur ? (
				<p className="mt-4 text-sm leading-relaxed text-white/50">
					Tes propositions n&apos;ont pas pu être chargées. Recharge la page&nbsp;: elles sont
					conservées, seul l&apos;affichage a échoué.
				</p>
			) : lignes.length === 0 ? (
				<p className="mt-4 text-sm leading-relaxed text-white/50">
					Tu n&apos;as pas encore proposé de correction. Ouvre n&apos;importe quelle fiche ci-dessus
					et clique sur «&nbsp;Proposer une correction&nbsp;».
				</p>
			) : (
				<ul className="mt-6 space-y-2">
					{lignes.map((l) => (
						<li
							key={l.id}
							className="rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3 text-sm"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="min-w-0 text-white/75">
									{l.entityPath ? (
										<Link href={l.entityPath} className="hover:text-dbz-orange">
											{l.entityLabel ?? "Fiche"}
										</Link>
									) : (
										(l.entityLabel ?? "Fiche")
									)}
									<span className="ml-2 text-xs text-white/40">
										{CONTRIBUTABLE_COLUMNS[l.columnName]?.label ?? l.columnName}
									</span>
								</span>
								<span
									className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${TON[l.status]}`}
								>
									{CONTRIBUTION_STATUS_LABELS[l.status]}
								</span>
							</div>
							{l.reviewNote ? (
								<p className="mt-2 text-xs leading-relaxed text-white/50">
									Réponse du relecteur&nbsp;: {l.reviewNote}
								</p>
							) : null}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

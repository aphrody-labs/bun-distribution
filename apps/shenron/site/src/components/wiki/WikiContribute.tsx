"use client";

/**
 * « Proposer une correction » — le chemin de contribution ouvert à **tout
 * membre**, sur n'importe quel champ éditorial d'une fiche ou d'une section.
 *
 * Îlot client : la page reste rendue côté serveur sans cookie ni entête, donc
 * son cache CDN/ISR est intact (cf. piège « JAMAIS de session dans le rendu
 * d'une page publique »). Le texte de départ n'est PAS passé en prop mais lu à
 * l'ouverture (`/api/wiki/contributions/value`) : un article pèse des dizaines
 * de Ko, et une fiche servie en ISR peut afficher une version périmée — partir
 * de celle-là fabriquerait un conflit au moment d'accepter.
 *
 * Ce que la modale fait et que le signalement en texte libre ne faisait pas :
 * elle part du texte existant. Corriger devient « modifier ce paragraphe », pas
 * « décrire à un inconnu ce qu'il faudrait changer ». C'est toute la différence
 * entre un wiki qu'on lit et un wiki auquel on participe.
 *
 * `PlainField` est importé directement (`@/components/editor/PlainField`) et non
 * via `@/components/editor` : le point d'entrée du module tirerait l'éditeur
 * riche et ses CSS dans le paquet d'une page publique.
 */
import { Chargement, CocheCercle, Crayon, Croix } from "@/components/icones";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { SignInDiscord } from "@/components/SignInDiscord";
import { PlainField } from "@/components/editor/PlainField";
import { champPlanche, numeroDePlanche } from "@/lib/databook-pages-shared";
import {
	CONTRIBUTION_COMMENT_MAX,
	CONTRIBUTION_MAX,
	CONTRIBUTION_SOURCES_MAX,
	CONTRIBUTABLE_COLUMNS,
	TOURNURES_NON_SOURCEES,
} from "@/lib/contributions-shared";
import { useMe } from "@/lib/use-me";

type Phase = "loading" | "idle" | "sending" | "done" | "error";

export interface WikiContributeProps {
	table: string;
	rowId: string | number;
	/**
	 * Champs proposables sur cette fiche. Un seul bouton pour tous : quatre
	 * boutons alignés sous un titre, c'est du bruit — le choix du champ se fait
	 * dans la modale, une fois l'intention exprimée.
	 */
	columns: string[];
	/** Nom de l'entité, affiché dans l'en-tête de la modale. */
	entityLabel?: string | null;
	/** Rendu compact (petit lien) pour les en-têtes de section. */
	compact?: boolean;
	/** Libellé du bouton (défaut : « Proposer une correction »). */
	labelBouton?: string;
}

/** Champ ouvert par défaut : l'article s'il existe, sinon le résumé, sinon le 1er. */
function champParDefaut(columns: string[]): string {
	return (
		columns.find((c) => c === "article") ??
		columns.find((c) => c === "description" || c === "body" || c === "synopsis") ??
		columns[0] ??
		""
	);
}

export function WikiContribute({
	table,
	rowId,
	columns,
	entityLabel,
	compact = false,
	labelBouton,
}: WikiContributeProps) {
	const me = useMe();
	const pathname = usePathname();
	const idTexte = useId();
	const [open, setOpen] = useState(false);
	const [column, setColumn] = useState(() => champParDefaut(columns));
	/** Texte en base au moment de l'ouverture — base du diff ET de « rien changé ». */
	const [origine, setOrigine] = useState<string | null>(null);
	const [texte, setTexte] = useState("");
	const [sources, setSources] = useState("");
	const [commentaire, setCommentaire] = useState("");
	const [phase, setPhase] = useState<Phase>("idle");
	const [err, setErr] = useState<string | null>(null);

	// `pages#42` n'est pas une colonne du registre : c'est la transcription
	// d'une planche de databook. Sans ce cas, la modale ouverte depuis une
	// planche n'avait ni libellé ni consigne.
	const planche = numeroDePlanche(column);
	const champ =
		planche !== null
			? champPlanche(planche)
			: column === "stats"
				? {
						label: "Statistiques",
						hint: "Une mesure par ligne, sous la forme « Intitulé : valeur ». Les intitulés sont libres — « Ki », mais aussi « Santé », « Portée » ou « Groupe sanguin ». Une ligne retirée retire la mesure.",
						long: true,
					}
				: CONTRIBUTABLE_COLUMNS[column];

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && phase !== "sending") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, phase]);

	// Droit de contribution du périmètre (wiki / databooks), réglé depuis
	// l'admin. Chargé à l'ouverture, jamais au rendu de la fiche : la réponse
	// dépend de la session et des rôles Discord, deux choses qui feraient
	// basculer la page en `private, no-store`. `null` = pas encore connu.
	const [autorise, setAutorise] = useState<boolean | null>(null);
	useEffect(() => {
		if (!open) return;
		let annule = false;
		fetch(`/api/wiki/contributions/rights?table=${encodeURIComponent(table)}`, {
			credentials: "same-origin",
		})
			.then((r) => r.json())
			.then((d) => {
				if (!annule) setAutorise(d?.ok ? !!d.allowed : true);
			})
			// En cas d'échec on n'empêche pas d'essayer : la route de dépôt
			// tranchera, et refuser sur une erreur réseau serait pire que laisser
			// un formulaire s'ouvrir pour rien.
			.catch(() => !annule && setAutorise(true));
		return () => {
			annule = true;
		};
	}, [open, table]);

	// Charge le texte courant à l'ouverture. `annule` évite d'écrire dans un
	// composant démonté si l'utilisateur referme avant la fin de la requête.
	useEffect(() => {
		if (!open) return;
		let annule = false;
		setPhase("loading");
		setErr(null);
		const params = new URLSearchParams({ table, rowId: String(rowId), column });
		fetch(`/api/wiki/contributions/value?${params}`, { credentials: "same-origin" })
			.then(async (r) => {
				const data = (await r.json().catch(() => ({}))) as { value?: string };
				if (annule) return;
				if (r.status === 401) {
					// Anonyme : la modale montre l'invitation à se connecter, pas une erreur.
					setPhase("idle");
					return;
				}
				if (!r.ok) {
					setPhase("error");
					setErr("Impossible de charger le texte actuel.");
					return;
				}
				setOrigine(data.value ?? "");
				setTexte(data.value ?? "");
				setPhase("idle");
			})
			.catch(() => {
				if (annule) return;
				setPhase("error");
				setErr("Impossible de charger le texte actuel.");
			});
		return () => {
			annule = true;
		};
	}, [open, table, rowId, column]);

	if (!champ || !column) return null;

	const inchange = (texte ?? "").trim() === (origine ?? "").trim();
	const alerteTournure = TOURNURES_NON_SOURCEES.test(texte);

	async function envoyer() {
		if (phase === "sending") return;
		if (inchange) {
			setErr("Le texte est identique à l'actuel — rien à proposer.");
			return;
		}
		if (!texte.trim()) {
			setErr("Le texte proposé est vide. Pour retirer un contenu, explique-le en commentaire.");
			return;
		}
		setPhase("sending");
		setErr(null);
		try {
			const res = await fetch("/api/wiki/contributions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({
					table,
					rowId: String(rowId),
					column,
					valueAfter: texte,
					sources: sources.trim() || null,
					comment: commentaire.trim() || null,
					path: pathname ?? null,
				}),
			});
			const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
			if (res.ok) {
				setPhase("done");
				return;
			}
			setPhase("error");
			setErr(
				res.status === 401
					? "Connecte-toi avec Discord pour proposer une correction."
					: res.status === 429
						? "Tu as déposé beaucoup de propositions d'un coup — réessaie dans un moment."
						: (data.message ?? "L'envoi a échoué. Réessaie dans un instant.")
			);
		} catch {
			setPhase("error");
			setErr("L'envoi a échoué. Réessaie dans un instant.");
		}
	}

	const bouton = compact ? (
		<button
			type="button"
			onClick={() => setOpen(true)}
			className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/35 transition-colors hover:text-dbz-orange"
			title={`Proposer une correction — ${champ.label}`}
		>
			<Crayon className="h-3 w-3" /> Corriger
		</button>
	) : (
		<button
			type="button"
			onClick={() => setOpen(true)}
			className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/12 bg-white/[0.03] px-3.5 py-2 text-xs font-semibold text-white/65 transition-colors hover:border-dbz-orange/50 hover:text-white"
		>
			<Crayon className="h-3.5 w-3.5" />
			{labelBouton ?? "Proposer une correction"}
		</button>
	);

	if (!open) return bouton;

	return (
		<>
			{bouton}
			<div
				className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
				role="dialog"
				aria-modal="true"
				aria-label={`Proposer une correction — ${champ.label}`}
				onClick={(e) => {
					if (e.target === e.currentTarget && phase !== "sending") setOpen(false);
				}}
			>
				<div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0d0d12] shadow-2xl sm:rounded-2xl">
					<header className="flex items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
						<div className="min-w-0">
							<h2 className="text-sm font-bold text-white">
								{champ.label}
								{entityLabel ? <span className="text-white/45"> · {entityLabel}</span> : null}
							</h2>
							<p className="mt-0.5 text-xs text-white/45">{champ.hint}</p>
						</div>
						<button
							type="button"
							onClick={() => setOpen(false)}
							disabled={phase === "sending"}
							className="shrink-0 rounded p-1 text-white/40 transition-colors hover:text-white disabled:opacity-40"
							aria-label="Fermer"
						>
							<Croix className="h-4 w-4" />
						</button>
					</header>

					{phase === "done" ? (
						<div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
							<CocheCercle className="h-9 w-9 text-emerald-400" />
							<p className="text-sm font-semibold text-white">Proposition envoyée.</p>
							<p className="max-w-sm text-xs leading-relaxed text-white/50">
								Elle passe en relecture. Si elle est retenue, la modification portera{" "}
								<strong className="text-white/70">ton nom</strong> dans l&apos;historique du wiki.
							</p>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="mt-2 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-white/75 transition-colors hover:border-dbz-orange/50 hover:text-white"
							>
								Fermer
							</button>
						</div>
					) : !me?.authenticated ? (
						<div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
							<p className="max-w-sm text-sm leading-relaxed text-white/60">
								Les corrections sont ouvertes aux membres connectés — c&apos;est ce qui permet de
								créditer ton travail et de te répondre.
							</p>
							<SignInDiscord>Se connecter avec Discord</SignInDiscord>
						</div>
					) : autorise === false ? (
						<div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
							<p className="max-w-sm text-sm leading-relaxed text-white/60">
								Les corrections de cette partie du wiki sont réservées à une équipe de relecture
								pour le moment.
							</p>
							<p className="max-w-sm text-[12px] leading-relaxed text-white/40">
								Vous pouvez toujours signaler une erreur : le bouton en bas de page transmet votre
								remarque aux modérateurs.
							</p>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="mt-1 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-white/75 transition-colors hover:border-dbz-orange/50 hover:text-white"
							>
								Fermer
							</button>
						</div>
					) : phase === "loading" || autorise === null ? (
						<div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-white/45">
							<Chargement className="h-4 w-4 animate-spin" /> Chargement du texte actuel…
						</div>
					) : (
						<>
							<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
								{columns.length > 1 ? (
									<div className="mb-4 flex flex-wrap gap-1.5">
										{columns.map((c) => {
											const def = CONTRIBUTABLE_COLUMNS[c];
											if (!def) return null;
											const actif = c === column;
											return (
												<button
													key={c}
													type="button"
													onClick={() => setColumn(c)}
													aria-pressed={actif}
													className={
														actif
															? "rounded-full bg-dbz-orange px-3 py-1.5 text-[11px] font-bold text-black"
															: "rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-semibold text-white/55 transition-colors hover:border-white/30 hover:text-white/80"
													}
												>
													{def.label}
												</button>
											);
										})}
									</div>
								) : null}

								<PlainField
									name={idTexte}
									label="Le texte tel qu'il devrait être"
									value={texte}
									onChange={setTexte}
									maxLength={CONTRIBUTION_MAX}
									minRows={champ.long ? 10 : 2}
									maxRows={champ.long ? 24 : 4}
									monospace={champ.long}
									draftKey={`contrib:${table}:${rowId}:${column}`}
									hint="Modifie directement le texte existant. Tout est relu avant publication."
								/>

								<div className="mt-4">
									<PlainField
										name="sources"
										label="Tes sources"
										value={sources}
										onChange={setSources}
										maxLength={CONTRIBUTION_SOURCES_MAX}
										minRows={2}
										maxRows={4}
										placeholder="Ex. : tome 17, planche 42 — ou Daizenshuu 7, page 118"
										hint="Le wiki se rédige sur le manga et les databooks. Une correction sourcée est acceptée bien plus vite."
									/>
								</div>

								<div className="mt-4">
									<PlainField
										name="commentaire"
										label="Un mot pour le relecteur (facultatif)"
										value={commentaire}
										onChange={setCommentaire}
										maxLength={CONTRIBUTION_COMMENT_MAX}
										minRows={2}
										maxRows={5}
										placeholder="Ce qui clochait, ce que tu as changé…"
									/>
								</div>

								{alerteTournure ? (
									<p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-200/80">
										Ton texte contient une tournure d&apos;hypothèse («&nbsp;probablement&nbsp;»,
										«&nbsp;sans doute&nbsp;»…). Le wiki n&apos;affirme que ce qu&apos;une source
										dit&nbsp;: mieux vaut retirer la phrase que la nuancer.
									</p>
								) : null}

								{err ? (
									<p className="mt-3 rounded-lg border border-dbz-red/30 bg-dbz-red/[0.08] px-3 py-2 text-xs text-dbz-red">
										{err}
									</p>
								) : null}
							</div>

							<footer className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3">
								<span className="text-[11px] text-white/35">
									{inchange ? "Aucune modification pour l'instant" : "Relu avant publication"}
								</span>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setOpen(false)}
										disabled={phase === "sending"}
										className="rounded-lg px-3 py-2 text-xs font-semibold text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
									>
										Annuler
									</button>
									<button
										type="button"
										onClick={envoyer}
										disabled={phase === "sending" || inchange}
										className="inline-flex items-center gap-2 rounded-lg bg-dbz-orange px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
									>
										{phase === "sending" ? (
											<>
												<Chargement className="h-3.5 w-3.5 animate-spin" /> Envoi…
											</>
										) : (
											"Envoyer la proposition"
										)}
									</button>
								</div>
							</footer>
						</>
					)}
				</div>
			</div>
		</>
	);
}

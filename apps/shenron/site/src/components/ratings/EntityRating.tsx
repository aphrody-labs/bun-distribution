/**
 * Notation 1–5 ★ pour fiches wiki (jeu, épisode, film, arc).
 *
 * Split UX demandé :
 *  - `EntityRatingSummary` → moyenne compacte en haut de page
 *  - `EntityRating`        → onglets « Noter / Avis » tout en bas
 *    (formulaire + commentaires ne monopolisent plus le milieu de page)
 */
"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { useCallback, useEffect, useId, useState } from "react";
import { Bulle, Chargement, ChevronBas, Corbeille, Etoile } from "@/components/icones";
import { useMe } from "@/lib/use-me";
import { RatingBadge, Stars } from "./Stars";
import { onTablistKeyDown } from "@/lib/tablist-keys";
import { PlainField } from "@/components/editor/PlainField";

/** Aligné sur `RATING_TARGET_TYPES` (schema) — union locale pour rester client-safe. */
export type RatingTargetType = "game" | "episode" | "movie" | "arc";

type CommentRow = {
	id: string;
	score: number;
	comment: string;
	createdAt: string;
	updatedAt: string;
	author: {
		id: string;
		username: string;
		avatar: string | null;
	};
};

type Mine = {
	id: string;
	score: number;
	comment: string | null;
	createdAt: string;
	updatedAt: string;
} | null;

type State = {
	summary: { average: number; count: number };
	mine: Mine;
	comments: CommentRow[];
};

type SharedProps = {
	targetType: RatingTargetType;
	targetId: string | number;
	/** Chemin pour le callback après login Discord. */
	signinCallback: string;
	/** Titre court pour l'UI (ex. « ce jeu »). */
	label?: string;
	className?: string;
};

const COMMENT_MAX = 800;
const ANCHOR_ID = "notes";

/**
 * État partagé par fiche.
 *
 * `EntityRatingSummary` (haut de fiche) et `EntityRating` (bas de fiche) sont
 * posés sur la MÊME page : chacun lançait sa propre requête, soit deux appels
 * identiques à `/api/ratings` par ouverture d'épisode, de film, de jeu ou
 * d'arc. Pire, après un vote seul le panneau du bas se rafraîchissait — le
 * badge du haut gardait l'ancienne moyenne jusqu'au rechargement.
 *
 * On mutualise donc la requête en vol et on diffuse toute nouvelle valeur aux
 * deux abonnés.
 */
type AbonneNotes = (state: State) => void;
const cacheNotes = new Map<string, State>();
const requetesNotes = new Map<string, Promise<State | null>>();
const abonnesNotes = new Map<string, Set<AbonneNotes>>();

function diffuserNotes(cle: string, state: State): void {
	cacheNotes.set(cle, state);
	for (const abonne of abonnesNotes.get(cle) ?? []) abonne(state);
}

/** Renvoie `null` en cas d'échec — jamais de rejet à gérer chez l'appelant. */
function chargerNotes(
	cle: string,
	targetType: RatingTargetType,
	id: string
): Promise<State | null> {
	const enVol = requetesNotes.get(cle);
	if (enVol) return enVol;
	const requete = fetch(
		`/api/ratings?type=${encodeURIComponent(targetType)}&id=${encodeURIComponent(id)}`,
		{ credentials: "include" }
	)
		.then(async (res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as Partial<State>;
			const frais: State = {
				summary: data.summary ?? { average: 0, count: 0 },
				mine: data.mine ?? null,
				comments: data.comments ?? [],
			};
			diffuserNotes(cle, frais);
			return frais;
		})
		.catch(() => null)
		.finally(() => {
			requetesNotes.delete(cle);
		});
	requetesNotes.set(cle, requete);
	return requete;
}

function useRatingState(targetType: RatingTargetType, targetId: string | number) {
	const id = String(targetId);
	const cle = `${targetType}:${id}`;
	const [state, setState] = useState<State | null>(null);
	const [loadErr, setLoadErr] = useState<string | null>(null);

	const publier = useCallback((s: State) => diffuserNotes(cle, s), [cle]);

	const load = useCallback(async () => {
		setLoadErr(null);
		if (!(await chargerNotes(cle, targetType, id))) {
			setLoadErr("Impossible de charger les notes.");
		}
	}, [cle, targetType, id]);

	// L'état initial reste `null`, JAMAIS le cache : le HTML servi est celui de
	// l'état « pas encore chargé » et hydrater un arbre différent ferait
	// abandonner l'hydratation à React (même piège que `useMe`). Le cache est
	// appliqué depuis l'effet, donc après hydratation.
	useEffect(() => {
		let vivant = true;
		const abonne: AbonneNotes = (frais) => {
			if (!vivant) return;
			setState(frais);
			setLoadErr(null);
		};
		let groupe = abonnesNotes.get(cle);
		if (!groupe) {
			groupe = new Set();
			abonnesNotes.set(cle, groupe);
		}
		groupe.add(abonne);
		const connu = cacheNotes.get(cle);
		if (connu) setState(connu);
		void chargerNotes(cle, targetType, id).then((frais) => {
			// Un échec de rafraîchissement ne doit pas effacer une valeur déjà à
			// l'écran : on n'affiche l'erreur que si on n'a rien à montrer.
			if (vivant && !frais && !connu) setLoadErr("Impossible de charger les notes.");
		});
		return () => {
			vivant = false;
			groupe.delete(abonne);
			if (groupe.size === 0) abonnesNotes.delete(cle);
		};
	}, [cle, targetType, id]);

	return { id, state, setState: publier, load, loadErr };
}

// ─── Moyenne compacte (haut de page) ─────────────────────────────────────────

/**
 * Badge moyenne uniquement — à placer dans l'en-tête de fiche.
 * Clic → scroll vers l'onglet notes en bas (`#notes`).
 */
export function EntityRatingSummary({
	targetType,
	targetId,
	className = "",
}: {
	targetType: RatingTargetType;
	targetId: string | number;
	className?: string;
}) {
	const { state, loadErr } = useRatingState(targetType, targetId);
	const summary = state?.summary ?? { average: 0, count: 0 };

	if (loadErr) {
		return <span className={`text-[12px] text-white/50 ${className}`}>Notes indisponibles</span>;
	}

	if (!state) {
		return (
			<span
				className={`inline-block h-7 w-28 animate-pulse rounded-full bg-white/[0.06] ${className}`}
				aria-hidden
			/>
		);
	}

	return (
		<a
			href={`#${ANCHOR_ID}`}
			className={`group inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 transition-colors hover:border-dbz-orange/50 hover:bg-dbz-orange/10 ${className}`}
			title="Voir les notes et avis"
		>
			{summary.count > 0 ? (
				<>
					<Stars value={summary.average} size="sm" label="Moyenne" />
					<span className="font-display text-sm font-bold tabular-nums text-white">
						{summary.average.toFixed(1)}
					</span>
					<span className="text-[11px] text-white/50">
						· {summary.count} note{summary.count > 1 ? "s" : ""}
					</span>
				</>
			) : (
				<>
					<span className="text-dbz-orange/70" aria-hidden>
						★
					</span>
					<span className="text-[12px] font-display font-semibold tracking-wide text-white/55 group-hover:text-dbz-orange">
						Noter
					</span>
				</>
			)}
			<ChevronBas className="h-3.5 w-3.5 text-white/50 group-hover:text-dbz-orange" aria-hidden />
		</a>
	);
}

// ─── Onglets bas de page (formulaire + avis) ─────────────────────────────────

type TabId = "rate" | "reviews";

/**
 * Panneau notes en onglets — à placer **en bas** de la fiche (après le contenu).
 * Onglet « Noter » = saisie ; onglet « Avis » = commentaires communautaires.
 */
export function EntityRating({
	targetType,
	targetId,
	signinCallback,
	label = "cette fiche",
	className = "",
}: SharedProps) {
	const me = useMe();
	const { id, state, setState, load, loadErr } = useRatingState(targetType, targetId);
	const [hover, setHover] = useState<number | null>(null);
	const [draftScore, setDraftScore] = useState(0);
	const [draftComment, setDraftComment] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveErr, setSaveErr] = useState<string | null>(null);
	const [saveOk, setSaveOk] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [tab, setTab] = useState<TabId>("rate");
	const baseId = useId();

	// Sync draft quand l'état arrive / change.
	useEffect(() => {
		if (!state) return;
		setDraftScore(state.mine?.score ?? 0);
		setDraftComment(state.mine?.comment ?? "");
	}, [state]);

	// Si l'URL arrive avec #notes, ouvrir l'onglet Avis s'il y en a.
	useEffect(() => {
		if (typeof window === "undefined") return;
		if (window.location.hash !== `#${ANCHOR_ID}`) return;
		if (state && state.comments.length > 0) setTab("reviews");
	}, [state]);

	async function submit(score: number, comment: string) {
		if (saving) return;
		if (score < 1 || score > 5) {
			setSaveErr("Choisis une note entre 1 et 5 étoiles.");
			return;
		}
		setSaving(true);
		setSaveErr(null);
		setSaveOk(false);
		try {
			const res = await fetch("/api/ratings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					type: targetType,
					id,
					score,
					comment: comment.trim() || null,
				}),
			});
			if (res.status === 401) {
				setSaveErr("Connecte-toi avec Discord pour noter.");
				return;
			}
			if (res.status === 429) {
				setSaveErr("Trop de notes d'affilée. Réessaie dans un moment.");
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				setSaveErr(
					body?.error === "comment_too_long" ? "Commentaire trop long." : "Échec de l'envoi."
				);
				return;
			}
			const data = (await res.json()) as Partial<State>;
			setState({
				summary: data.summary ?? { average: 0, count: 0 },
				mine: data.mine ?? null,
				comments: data.comments ?? [],
			});
			setSaveOk(true);
			window.setTimeout(() => setSaveOk(false), 2000);
		} catch {
			setSaveErr("Erreur réseau.");
		} finally {
			setSaving(false);
		}
	}

	async function remove(ratingId: string, mode: "full" | "comment" = "full") {
		if (deletingId) return;
		setDeletingId(ratingId);
		setSaveErr(null);
		try {
			const res = await fetch(`/api/ratings/${ratingId}`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ mode }),
			});
			if (!res.ok) {
				setSaveErr("Suppression impossible.");
				return;
			}
			const data = (await res.json()) as State;
			if (data.summary) {
				setState({
					summary: data.summary,
					mine: data.mine ?? null,
					comments: data.comments ?? [],
				});
			} else {
				await load();
			}
		} catch {
			setSaveErr("Erreur réseau.");
		} finally {
			setDeletingId(null);
		}
	}

	const summary = state?.summary ?? { average: 0, count: 0 };
	const comments = state?.comments ?? [];
	const authReady = me !== undefined;
	const canRate = Boolean(me?.authenticated);
	const reviewCount = comments.length;

	const tabBtn =
		"inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 px-4 py-2 text-sm font-semibold transition-colors";
	const tabActive = "border-dbz-orange/50 bg-dbz-card text-white";
	const tabIdle = "border-transparent bg-transparent text-white/50 hover:text-white/80";

	return (
		<section
			id={ANCHOR_ID}
			className={`scroll-mt-24 ${className}`}
			aria-labelledby={`${baseId}-heading`}
		>
			{/* En-tête compact + onglets */}
			<div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10">
				<div tabIndex={0}
					className="flex flex-wrap items-end gap-1"
					role="tablist"
					aria-label="Notes et avis"
					onKeyDown={onTablistKeyDown}
				>
					<button
						type="button"
						role="tab"
						aria-selected={tab === "rate"}
						aria-controls={`${baseId}-rate`}
						id={`${baseId}-tab-rate`}
						tabIndex={tab === "rate" ? 0 : -1}
						onClick={() => setTab("rate")}
						className={`${tabBtn} ${tab === "rate" ? tabActive : tabIdle}`}
					>
						<Etoile className="h-3.5 w-3.5 text-dbz-orange" aria-hidden />
						Noter
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === "reviews"}
						aria-controls={`${baseId}-reviews`}
						id={`${baseId}-tab-reviews`}
						tabIndex={tab === "reviews" ? 0 : -1}
						onClick={() => setTab("reviews")}
						className={`${tabBtn} ${tab === "reviews" ? tabActive : tabIdle}`}
					>
						<Bulle className="h-3.5 w-3.5" aria-hidden />
						Avis
						{reviewCount > 0 && (
							<span className="rounded bg-white/10 px-1.5 text-[11px] tabular-nums text-dbz-orange">
								{reviewCount}
							</span>
						)}
					</button>
				</div>

				<div className="mb-2 flex items-center gap-2 pr-1">
					{state ? (
						<>
							<span className="sr-only" id={`${baseId}-heading`}>
								Notes de la communauté
							</span>
							<RatingBadge average={summary.average} count={summary.count} />
						</>
					) : loadErr ? (
						<span className="text-[12px] text-red-400">{loadErr}</span>
					) : (
						<span className="h-5 w-20 animate-pulse rounded bg-white/[0.06]" aria-hidden />
					)}
				</div>
			</div>

			<div className="rounded-b-xl rounded-tr-xl border border-t-0 border-white/10 bg-dbz-card/80 p-4 sm:p-5">
				{/* ── Onglet Noter ── */}
				{tab === "rate" && (
					<div
						role="tabpanel"
						id={`${baseId}-rate`}
						aria-labelledby={`${baseId}-tab-rate`}
						className="space-y-4"
					>
						<p className="text-[13px] text-white/50">
							Note {label} sur 5 étoiles. Commentaire facultatif — les avis s&apos;affichent dans
							l&apos;onglet voisin.
						</p>

						{!authReady ? (
							<div className="h-20 rounded-lg bg-white/[0.03]" aria-hidden />
						) : canRate ? (
							<div className="space-y-4">
								<div className="flex flex-wrap items-center gap-3">
									<span className="text-[11px] font-display font-semibold uppercase tracking-[0.12em] text-white/50">
										Ta note
									</span>
									<Stars
										value={draftScore}
										size="lg"
										interactive
										hover={hover}
										onHover={setHover}
										onSelect={(n) => {
											setDraftScore(n);
											void submit(n, draftComment);
										}}
										label="Ta note"
									/>
									{draftScore > 0 && (
										<span className="text-[13px] tabular-nums text-white/70">{draftScore}/5</span>
									)}
								</div>

								<div>
									<label
										htmlFor={`rating-comment-${id}`}
										className="mb-1.5 block text-[11px] font-display font-semibold uppercase tracking-[0.12em] text-white/50"
									>
										Commentaire{" "}
										<span className="normal-case tracking-normal text-white/50">(optionnel)</span>
									</label>
									<PlainField
										id={`rating-comment-${id}`}
										value={draftComment}
										onChange={(v) => setDraftComment(v.slice(0, COMMENT_MAX))}
										minRows={2}
										maxRows={6}
										maxLength={COMMENT_MAX}
										placeholder="Un avis court…"
									/>
									<div className="mt-1 flex justify-end text-[11px] text-white/50">
										{state?.mine && (
											<button
												type="button"
												// Seul contrôle de sa rangée : on lui donne les 44 px en hauteur
												// plutôt qu'un `.cible-44`, dont le pseudo-élément déborderait
												// sur le champ de commentaire juste au-dessus et lui volerait
												// les clics. `disabled` restait sans effet visible pendant la
												// suppression en cours.
												className="inline-flex min-h-11 items-center px-1 transition-colors hover:text-red-400 disabled:opacity-40"
												onClick={() => void remove(state.mine!.id, "full")}
												disabled={deletingId === state.mine.id}
											>
												Retirer ma note
											</button>
										)}
									</div>
								</div>

								<div className="flex flex-wrap items-center gap-3">
									<button
										type="button"
										disabled={saving || draftScore < 1}
										onClick={() => void submit(draftScore, draftComment)}
										className="inline-flex h-9 items-center rounded-full bg-dbz-orange px-4 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-black transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-40"
									>
										{saving ? (
											<>
												<Chargement className="mr-2 h-3.5 w-3.5 animate-spin" />
												Envoi…
											</>
										) : state?.mine ? (
											"Mettre à jour"
										) : (
											"Publier ma note"
										)}
									</button>
									{saveOk && <span className="text-[13px] text-emerald-400">Enregistré !</span>}
									{saveErr && <span className="text-[13px] text-red-400">{saveErr}</span>}
								</div>
							</div>
						) : (
							<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dbz-orange/25 bg-dbz-orange/10 px-4 py-3">
								<p className="text-[13px] text-white/85">
									Connecte-toi avec Discord pour noter {label}.
								</p>
								<Link
									href={`/signin?callbackURL=${encodeURIComponent(signinCallback)}`}
									className="inline-flex h-9 items-center whitespace-nowrap rounded-full bg-dbz-orange px-4 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-black transition-colors hover:bg-white"
								>
									Connexion Discord
								</Link>
							</div>
						)}
					</div>
				)}

				{/* ── Onglet Avis ── */}
				{tab === "reviews" && (
					<div role="tabpanel" id={`${baseId}-reviews`} aria-labelledby={`${baseId}-tab-reviews`}>
						{!state ? (
							<div className="h-16 animate-pulse rounded-lg bg-white/[0.04]" aria-hidden />
						) : comments.length > 0 ? (
							<ul className="space-y-3">
								{comments.map((c) => {
									const canDelete = me?.isAdmin || (me?.authenticated && state.mine?.id === c.id);
									return (
										<li
											key={c.id}
											className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5"
										>
											<div className="mb-1.5 flex items-start justify-between gap-3">
												<div className="flex min-w-0 items-center gap-2.5">
													<Avatar src={c.author.avatar} size={28} />
													<div className="min-w-0">
														<p className="truncate font-display text-[13px] font-semibold text-white">
															{c.author.username}
														</p>
														<div className="flex items-center gap-2">
															<Stars value={c.score} size="sm" />
															<span className="text-[11px] text-white/50">
																{formatDate(c.updatedAt)}
															</span>
														</div>
													</div>
												</div>
												{canDelete && (
													<button
														type="button"
														title={me?.isAdmin ? "Supprimer la note (admin)" : "Supprimer mon avis"}
														onClick={() => void remove(c.id, "full")}
														disabled={deletingId === c.id}
														// 28 px au dessin : `.cible-44` porte la zone tactile à
														// 44 px sans grossir la corbeille ni décaler l'en-tête de
														// l'avis. Même traitement que la croix de `/parametres`.
														className="cible-44 rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/5 hover:text-red-400 disabled:opacity-40"
													>
														{deletingId === c.id ? (
															<Chargement className="h-4 w-4 animate-spin" />
														) : (
															<Corbeille className="h-4 w-4" />
														)}
													</button>
												)}
											</div>
											<p className="whitespace-pre-wrap text-[14px] leading-relaxed text-white/80">
												{c.comment}
											</p>
										</li>
									);
								})}
							</ul>
						) : summary.count > 0 ? (
							<p className="py-4 text-center text-[13px] text-white/50">
								Des notes sans commentaire pour l&apos;instant — sois le premier à laisser un avis
								dans l&apos;onglet <strong className="text-white/60">Noter</strong>.
							</p>
						) : (
							<p className="py-4 text-center text-[13px] text-white/50">
								Aucun avis pour l&apos;instant. Ouvre l&apos;onglet{" "}
								<button
									type="button"
									onClick={() => setTab("rate")}
									className="font-semibold text-dbz-orange hover:underline"
								>
									Noter
								</button>{" "}
								pour lancer le classement.
							</p>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

/** Résumé agrégé en lecture seule (ex. moyenne d'une saga = arcs). */
export function AggregateRatingBanner({
	average,
	count,
	subtitle,
	className = "",
}: {
	average: number;
	count: number;
	subtitle?: string;
	className?: string;
}) {
	return (
		<div
			className={`inline-flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 ${className}`}
		>
			<Stars value={average} size="md" label="Moyenne" />
			<div>
				<p className="font-display text-lg font-bold tabular-nums leading-none text-white">
					{count > 0 ? average.toFixed(1) : "—"}
					<span className="text-sm font-normal text-white/50"> / 5</span>
				</p>
				<p className="mt-0.5 text-[11px] text-white/50">
					{subtitle ??
						(count > 0
							? `${count} note${count > 1 ? "s" : ""} sur les arcs`
							: "Aucune note sur les arcs")}
				</p>
			</div>
		</div>
	);
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString("fr-FR", {
			day: "numeric",
			month: "short",
			year: "numeric",
		});
	} catch {
		return "";
	}
}

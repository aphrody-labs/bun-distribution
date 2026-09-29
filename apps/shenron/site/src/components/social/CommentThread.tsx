"use client";

/**
 * CommentThread — le fil de discussion partagé par TOUTES les surfaces du site.
 *
 * Un seul composant sert l'article, la fiche wiki, le databook et la tier list :
 * c'est ce qui permet d'avoir partout les mêmes capacités (réponses, édition,
 * j'aime, épinglage, tri, pagination) sans trois implémentations qui divergent.
 * Avant, seuls les articles avaient des commentaires — à plat, sans réponse,
 * sans modération, sans retrait.
 *
 * Choix structurants :
 *
 *  - **Îlot client sur page cacheable.** La première page du fil peut arriver
 *    en `initial` (rendue côté serveur, donc indexable et sans saut de mise en
 *    page) ; tout le reste — tri, page suivante, droits du lecteur — passe par
 *    `/api/social/*`. La page hôte n'a jamais besoin de lire la session.
 *  - **Deux niveaux, pas plus.** On répond à un commentaire, pas à une réponse :
 *    au-delà, un fil devient illisible sur mobile. Le serveur applique la même
 *    règle (`depth_exceeded`), l'interface ne propose donc rien d'impossible.
 *  - **Le texte écrit n'est jamais perdu.** Le champ s'appuie sur `PlainField`
 *    et son brouillon local : un rechargement ne mange pas dix lignes écrites.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMe } from "@/lib/use-me";
import { PlainField } from "@/components/editor/PlainField";
import { LikeButton } from "@/components/social/LikeButton";
import {
	COMMENT_MAX,
	COMMENT_SORTS,
	socialErrorMessage,
	type CommentPage,
	type CommentSort,
	type CommentView,
} from "@/lib/social-shared";
import { Avatar } from "@/components/Avatar";

const SORT_LABELS: Record<CommentSort, string> = {
	recent: "Plus récents",
	ancien: "Plus anciens",
	populaire: "Plus aimés",
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

function formatDate(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : dateFormat.format(d);
}

/**
 * Préfixe du brouillon local de `PlainField`. Il est recopié ici parce que le
 * champ ne nettoie son brouillon que sur une frappe : vider la valeur par le
 * code (après publication) ne passe pas par son `onChange`, et le texte publié
 * resterait proposé au rechargement suivant.
 */
const DRAFT_PREFIX = "shenron-field-draft:";

export function CommentThread({
	target,
	initial,
	callbackURL,
	title = "Discussion",
	className = "",
}: {
	/** Cible formatée : `post:<id>`, `wiki:<table>#<id>`, `databook:<id>`… */
	target: string;
	/** Première page rendue côté serveur (facultatif mais recommandé). */
	initial?: CommentPage;
	/** Retour après connexion pour un visiteur anonyme. */
	callbackURL?: string;
	title?: string;
	className?: string;
}) {
	const me = useMe();
	const [sort, setSort] = useState<CommentSort>(initial?.sort ?? "recent");
	const [page, setPage] = useState(initial?.page ?? 1);
	const [data, setData] = useState<CommentPage | null>(initial ?? null);
	const [loading, setLoading] = useState(!initial);
	const [error, setError] = useState<string | null>(null);
	const [replyTo, setReplyTo] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Record<string, CommentView[]>>({});
	const isAdmin = me?.isAdmin === true;
	const authed = me?.authenticated === true;

	const load = useCallback(
		async (nextPage: number, nextSort: CommentSort) => {
			setLoading(true);
			setError(null);
			try {
				const res = await fetch(
					`/api/social/comments?target=${encodeURIComponent(target)}&page=${nextPage}&sort=${nextSort}`,
					{ credentials: "include" }
				);
				const json = (await res.json()) as CommentPage & { ok?: boolean; error?: string };
				if (!res.ok || !json.ok) {
					setError(socialErrorMessage(json.error));
					return;
				}
				setData(json);
				setExpanded({});
			} catch {
				setError("Impossible de charger la discussion.");
			} finally {
				setLoading(false);
			}
		},
		[target]
	);

	// Rechargement à chaque changement de tri ou de page. La page initiale rendue
	// côté serveur n'est PAS refetchée au montage : elle est déjà à jour, et la
	// refaire doublerait les requêtes sur chaque article ouvert.
	const [primed, setPrimed] = useState(Boolean(initial));
	useEffect(() => {
		if (!primed) {
			setPrimed(true);
			if (initial) return;
		}
		void load(page, sort);
		// `initial` est figé au montage ; il n'a pas à déclencher l'effet.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page, sort, load]);

	const refresh = useCallback(() => {
		void load(page, sort);
	}, [load, page, sort]);

	const total = data?.total ?? 0;
	const pages = data?.pages ?? 1;
	const comments = data?.comments ?? [];

	const signinHref = useMemo(
		() => `/signin${callbackURL ? `?callbackURL=${encodeURIComponent(callbackURL)}` : ""}`,
		[callbackURL]
	);

	async function submitComment(body: string, parentId: string | null): Promise<boolean> {
		const res = await fetch("/api/social/comments", {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target, body, parentId }),
		});
		const json = (await res.json()) as { ok?: boolean; error?: string };
		if (!res.ok || !json.ok) {
			setError(socialErrorMessage(json.error));
			return false;
		}
		setError(null);
		setReplyTo(null);
		// Une réponse s'insère sous son parent : on recharge la page courante
		// plutôt que de reconstruire un arbre partiel à la main.
		refresh();
		return true;
	}

	async function saveEdit(id: string, body: string): Promise<boolean> {
		const json = await send(`/api/social/comments/${id}`, "PATCH", { body });
		if (!json) return false;
		setEditing(null);
		refresh();
		return true;
	}

	async function send(
		url: string,
		method: string,
		payload?: unknown
	): Promise<{ ok?: boolean } | null> {
		try {
			const res = await fetch(url, {
				method,
				credentials: "include",
				headers: payload ? { "content-type": "application/json" } : undefined,
				body: payload ? JSON.stringify(payload) : undefined,
			});
			const json = (await res.json()) as { ok?: boolean; error?: string };
			if (!res.ok || !json.ok) {
				setError(socialErrorMessage(json.error));
				return null;
			}
			setError(null);
			return json;
		} catch {
			setError("Réseau indisponible.");
			return null;
		}
	}

	async function remove(id: string): Promise<void> {
		if (await send(`/api/social/comments/${id}`, "DELETE")) refresh();
	}

	async function moderate(id: string, action: "hide" | "restore" | "pin" | "unpin"): Promise<void> {
		if (await send(`/api/social/comments/${id}`, "PATCH", { action })) refresh();
	}

	async function loadReplies(id: string): Promise<void> {
		try {
			const res = await fetch(`/api/social/comments/${id}`, { credentials: "include" });
			const json = (await res.json()) as { ok?: boolean; replies?: CommentView[] };
			if (json.ok && json.replies) setExpanded((m) => ({ ...m, [id]: json.replies! }));
		} catch {
			setError("Réseau indisponible.");
		}
	}

	return (
		<section className={`ed-no-print ${className}`} id="discussion">
			<header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-white/12 pb-4">
				<div>
					<p className="font-display text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-dbz-orange">
						Participer
					</p>
					<h2 className="mt-1.5 font-serif text-[clamp(1.375rem,1.2rem+1vw,1.75rem)] font-semibold tracking-[-0.015em] text-white">
						{title} <span className="text-white/40">· {total}</span>
					</h2>
				</div>
				{total > 1 && (
					<label className="flex items-center gap-2 text-[0.8125rem] text-white/55">
						<span>Trier</span>
						<select
							value={sort}
							onChange={(e) => {
								setPage(1);
								setSort(e.target.value as CommentSort);
							}}
							className="min-h-11 rounded-lg border border-white/15 bg-transparent px-2.5 font-display text-[0.75rem] uppercase tracking-[0.08em] text-white/80"
						>
							{COMMENT_SORTS.map((s) => (
								<option key={s} value={s} className="bg-neutral-900">
									{SORT_LABELS[s]}
								</option>
							))}
						</select>
					</label>
				)}
			</header>

			{/* Saisie en tête : on écrit avant de lire vingt réponses. */}
			<div className="mt-6">
				{me === undefined ? (
					<div
						className="h-[132px] rounded-xl border border-white/[0.08] bg-white/[0.02]"
						aria-hidden
					/>
				) : authed ? (
					<Composer
						placeholder="Partage ton avis…"
						draftKey={`comment:${target}`}
						onSubmit={(body) => submitComment(body, null)}
					/>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dbz-orange/40 bg-dbz-orange/[0.07] p-5">
						<p className="text-[0.9375rem] text-white/85">
							Connecte-toi avec Discord pour participer à la discussion.
						</p>
						<Link href={signinHref} className="toriyama-btn !text-[0.75rem]">
							Connexion
						</Link>
					</div>
				)}
			</div>

			{error && (
				<p role="alert" className="mt-4 text-[0.8125rem] text-red-400">
					<span aria-hidden>✗</span> {error}
				</p>
			)}

			{loading && comments.length === 0 ? (
				<p className="mt-8 text-[0.875rem] text-white/45">Chargement de la discussion…</p>
			) : comments.length === 0 ? (
				<p className="mt-8 text-[0.9375rem] text-white/55">
					Personne n&apos;a encore réagi. Ouvre la discussion.
				</p>
			) : (
				<ul className="mt-8 space-y-6">
					{comments.map((c) => (
						<li
							key={c.id}
							id={`c-${c.id}`}
							className="border-b border-white/[0.08] pb-6 last:border-0"
						>
							<CommentCard
								comment={c}
								isAdmin={isAdmin}
								editing={editing === c.id}
								onEdit={() => setEditing(c.id)}
								onCancelEdit={() => setEditing(null)}
								onSaveEdit={(body) => saveEdit(c.id, body)}
								onRemove={() => void remove(c.id)}
								onModerate={(a) => void moderate(c.id, a)}
								onReply={authed ? () => setReplyTo(replyTo === c.id ? null : c.id) : undefined}
								replyOpen={replyTo === c.id}
							/>

							{replyTo === c.id && authed && (
								<div className="mt-4 border-l-2 border-dbz-orange/40 pl-4">
									<Composer
										placeholder={`Répondre à ${c.authorName}…`}
										draftKey={`reply:${c.id}`}
										compact
										onSubmit={(body) => submitComment(body, c.id)}
										onCancel={() => setReplyTo(null)}
									/>
								</div>
							)}

							{(expanded[c.id] ?? c.replies).length > 0 && (
								<ul className="mt-5 space-y-5 border-l-2 border-white/10 pl-4">
									{(expanded[c.id] ?? c.replies).map((r) => (
										<li key={r.id} id={`c-${r.id}`}>
											<CommentCard
												comment={r}
												isAdmin={isAdmin}
												editing={editing === r.id}
												onEdit={() => setEditing(r.id)}
												onCancelEdit={() => setEditing(null)}
												onSaveEdit={(body) => saveEdit(r.id, body)}
												onRemove={() => void remove(r.id)}
												onModerate={(a) => void moderate(r.id, a)}
											/>
										</li>
									))}
								</ul>
							)}

							{!expanded[c.id] && c.replyCount > c.replies.length && (
								<button
									type="button"
									onClick={() => void loadReplies(c.id)}
									className="ml-4 mt-3 text-[0.8125rem] text-dbz-orange underline-offset-4 hover:underline"
								>
									Voir les {c.replyCount} réponses
								</button>
							)}
						</li>
					))}
				</ul>
			)}

			{pages > 1 && (
				<nav
					aria-label="Pagination des commentaires"
					className="mt-8 flex items-center justify-between gap-4 border-t-2 border-white/12 pt-5 font-display text-[0.75rem] uppercase tracking-[0.1em] text-white/55"
				>
					<button
						type="button"
						disabled={page <= 1 || loading}
						onClick={() => setPage((p) => Math.max(1, p - 1))}
						className="min-h-11 transition-colors hover:text-white disabled:opacity-30"
					>
						← Précédents
					</button>
					<span className="tabular-nums">
						Page {page} / {pages}
					</span>
					<button
						type="button"
						disabled={page >= pages || loading}
						onClick={() => setPage((p) => Math.min(pages, p + 1))}
						className="min-h-11 transition-colors hover:text-white disabled:opacity-30"
					>
						Suivants →
					</button>
				</nav>
			)}
		</section>
	);
}

/** Champ de saisie + envoi. Partagé par le commentaire, la réponse et l'édition. */
function Composer({
	placeholder,
	draftKey,
	initialValue = "",
	compact = false,
	onSubmit,
	onCancel,
}: {
	placeholder: string;
	draftKey?: string;
	initialValue?: string;
	compact?: boolean;
	onSubmit: (body: string) => Promise<boolean>;
	onCancel?: () => void;
}) {
	const [value, setValue] = useState(initialValue);
	const [pending, setPending] = useState(false);

	async function publish(): Promise<void> {
		const body = value.trim();
		if (!body || pending) return;
		setPending(true);
		const ok = await onSubmit(body);
		setPending(false);
		if (!ok) return;
		setValue("");
		// Le brouillon local n'a plus de raison d'être une fois le texte publié.
		if (draftKey) {
			try {
				localStorage.removeItem(DRAFT_PREFIX + draftKey);
			} catch {
				// Stockage indisponible : sans importance.
			}
		}
	}

	return (
		<div className="space-y-3">
			<PlainField
				name="body"
				label={placeholder}
				hideLabel
				value={value}
				onChange={setValue}
				onSubmit={() => void publish()}
				placeholder={placeholder}
				maxLength={COMMENT_MAX}
				minRows={compact ? 3 : 4}
				maxRows={14}
				disabled={pending}
				draftKey={draftKey}
			/>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="text-[0.6875rem] uppercase tracking-[0.08em] text-white/40">
					Texte simple · {COMMENT_MAX - value.length} caractères restants
				</span>
				<div className="flex items-center gap-3">
					{onCancel && (
						<button
							type="button"
							onClick={onCancel}
							className="min-h-11 text-[0.75rem] uppercase tracking-[0.08em] text-white/55 hover:text-white"
						>
							Annuler
						</button>
					)}
					<button
						type="button"
						onClick={() => void publish()}
						disabled={pending || value.trim().length === 0}
						className="toriyama-btn !text-[0.75rem] disabled:cursor-not-allowed disabled:opacity-40"
					>
						{pending ? "Envoi…" : "Publier"}
					</button>
				</div>
			</div>
		</div>
	);
}

function CommentCard({
	comment,
	isAdmin,
	editing,
	onEdit,
	onCancelEdit,
	onSaveEdit,
	onRemove,
	onModerate,
	onReply,
	replyOpen,
}: {
	comment: CommentView;
	isAdmin: boolean;
	editing: boolean;
	onEdit: () => void;
	onCancelEdit: () => void;
	onSaveEdit: (body: string) => Promise<boolean>;
	onRemove: () => void;
	onModerate: (action: "hide" | "restore" | "pin" | "unpin") => void;
	onReply?: () => void;
	replyOpen?: boolean;
}) {
	return (
		<article className={comment.hidden ? "opacity-55" : undefined}>
			<header className="flex flex-wrap items-center gap-2.5 text-[0.8125rem] text-white/55">
				{comment.authorAvatar ? (
					// Avatar Discord : URL externe déjà dimensionnée, pas de next/image
					// (un domaine par CDN Discord ferait exploser la config des images).
					// `Avatar` bascule sur l'avatar Discord par défaut quand le hash est périmé.
					<Avatar src={comment.authorAvatar} size={24} className="border border-white/15" />
				) : (
					// Pas d'initiale dans un rond coloré : DESIGN.md l'exclut
					// explicitement (« on masque le champ vide, on ne le meuble pas »).
					// Un avatar absent ne laisse donc rien, et le pseudo porte seul
					// l'identité.
					<span aria-hidden className="size-6 rounded-full border border-white/10" />
				)}
				<span className="font-display text-white/85">{comment.authorName}</span>
				{/* Marqueur CONSERVÉ même après le nettoyage des mentions techniques du
				    2026-09-12 : il ne documente pas le fonctionnement du site, il évite
				    qu'un message automatique passe pour celui d'un membre. Le libellé
				    reste court, sans expliquer par quoi il a été écrit. */}
				{comment.agentName && (
					<span
						className="rounded border border-white/20 px-1.5 font-display text-[0.625rem] uppercase tracking-[0.08em] text-white/55"
						title="Message automatique"
					>
						auto
					</span>
				)}
				{comment.pinned && (
					<span className="border border-dbz-orange/50 px-1.5 font-display text-[0.625rem] uppercase tracking-[0.08em] text-dbz-orange">
						épinglé
					</span>
				)}
				<time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
				{comment.edited && <span className="text-white/35">· modifié</span>}
			</header>

			{editing ? (
				<div className="mt-3">
					<Composer
						placeholder="Corriger mon message"
						initialValue={comment.body}
						compact
						onSubmit={onSaveEdit}
						onCancel={onCancelEdit}
					/>
				</div>
			) : (
				<p className="mt-2.5 whitespace-pre-wrap text-[1rem] leading-relaxed text-white/85">
					{comment.body}
				</p>
			)}

			{!comment.hidden && !editing && (
				<footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-white/50">
					<LikeButton target={`comment:${comment.id}`} initialLikes={comment.likes} compact />
					{onReply && (
						<button type="button" onClick={onReply} className="min-h-11 hover:text-white">
							{replyOpen ? "Fermer" : "Répondre"}
						</button>
					)}
					{comment.mine && (
						<>
							<button type="button" onClick={onEdit} className="min-h-11 hover:text-white">
								Modifier
							</button>
							<button type="button" onClick={onRemove} className="min-h-11 hover:text-red-300">
								Supprimer
							</button>
						</>
					)}
					{isAdmin && (
						<>
							<button
								type="button"
								onClick={() => onModerate(comment.pinned ? "unpin" : "pin")}
								className="min-h-11 hover:text-dbz-orange"
							>
								{comment.pinned ? "Désépingler" : "Épingler"}
							</button>
							<button
								type="button"
								onClick={() => onModerate("hide")}
								className="min-h-11 hover:text-red-300"
							>
								Masquer
							</button>
						</>
					)}
				</footer>
			)}

			{comment.hidden && isAdmin && (
				<button
					type="button"
					onClick={() => onModerate("restore")}
					className="mt-3 min-h-11 text-[0.8125rem] text-white/55 hover:text-white"
				>
					Rétablir
				</button>
			)}
		</article>
	);
}

"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { assetUrl } from "@/lib/assets";
import type { TierlistItem, TierlistTier } from "@/db/schema";
import type { OfficialTierlistPayload, SaveTierlistResult } from "@/lib/tierlist-input";

interface Board {
	tiers: TierlistTier[];
	pool: TierlistItem[];
}

// Client-safe (lib/tierlists est `server-only`) : on recopie juste le libellé.
const CUSTOM_CATEGORY = "Mes ajouts";
const ALL = "__all__";

/**
 * Éditeur de tierlist. Trois apports pour l'usage réel :
 *  - tap-pour-placer (mobile + desktop) + glisser-déposer HTML5 (desktop) ;
 *  - **catégories + recherche** dans la réserve pour retrouver une carte vite ;
 *  - **ajout de ses propres cartes** : upload d'image, image par URL, ou carte
 *    texte. À la publication, POST /api/tierlists → redirection.
 */
export function TierlistEditor({
	templateKey,
	defaultTitle,
	defaultDescription,
	pool,
	initialTiers,
	admin = false,
	tierlistId = null,
	initialOfficial = true,
	initialFeatured = false,
	initialPublished = true,
	onSave,
}: {
	templateKey: string | null;
	defaultTitle: string;
	defaultDescription: string;
	pool: TierlistItem[];
	initialTiers: TierlistTier[];
	/** Active le mode admin : drapeaux de curation + sauvegarde via `onSave`. */
	admin?: boolean;
	/** Id de la tier list à mettre à jour (édition). `null` = création. */
	tierlistId?: string | null;
	initialOfficial?: boolean;
	initialFeatured?: boolean;
	initialPublished?: boolean;
	/** Server Action de sauvegarde (mode admin). Si absent → flux public `/api/tierlists`. */
	onSave?: (input: OfficialTierlistPayload) => Promise<SaveTierlistResult>;
}) {
	const router = useRouter();
	const [title, setTitle] = useState(defaultTitle);
	const [description, setDescription] = useState(defaultDescription);
	const [board, setBoard] = useState<Board>({ tiers: initialTiers, pool });
	const [selected, setSelected] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dragId = useRef<string | null>(null);

	// Drapeaux de curation (mode admin uniquement).
	const [official, setOfficial] = useState(initialOfficial);
	const [featured, setFeatured] = useState(initialFeatured);
	const [published, setPublished] = useState(initialPublished);
	const isAdmin = admin && typeof onSave === "function";

	// Filtres de la réserve.
	const [search, setSearch] = useState("");
	const [activeCat, setActiveCat] = useState<string>(ALL);

	// Panneau d'ajout de carte custom.
	const [addOpen, setAddOpen] = useState(false);
	const [addLabel, setAddLabel] = useState("");
	const [addUrl, setAddUrl] = useState("");
	const [uploading, setUploading] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement | null>(null);

	function place(itemId: string, targetId: string) {
		setBoard((prev) => {
			let moved: TierlistItem | undefined;
			const take = (arr: TierlistItem[]) =>
				arr.filter((i) => {
					if (i.id === itemId) {
						moved = i;
						return false;
					}
					return true;
				});
			const tiers = prev.tiers.map((t) => ({ ...t, items: take(t.items) }));
			let pool2 = take(prev.pool);
			if (!moved) return prev;
			if (targetId === "pool") {
				pool2 = [...pool2, moved];
			} else {
				const t = tiers.find((x) => x.id === targetId);
				if (t) t.items = [...t.items, moved];
				else pool2 = [...pool2, moved];
			}
			return { tiers, pool: pool2 };
		});
		setSelected(null);
	}

	function onTapZone(targetId: string) {
		if (selected) place(selected, targetId);
	}

	function onDrop(e: DragEvent<HTMLElement>, targetId: string) {
		// Sans `preventDefault`, un fichier ou une image déposés depuis l'extérieur
		// font naviguer le navigateur vers cette image et on perd le travail en cours.
		e.preventDefault();
		if (dragId.current) place(dragId.current, targetId);
		dragId.current = null;
	}

	/** `libelle` explicite : l'appelant qui vient de calculer un nom ne peut pas
	 * le passer par `setAddLabel` (état React asynchrone, invisible dans le même
	 * tour). Sans lui, toute image importée s'appelait « Carte ». */
	function addCard(image: string | null, libelle?: string) {
		const label = (libelle ?? addLabel).trim() || (image ? "Carte" : "");
		if (!label) {
			setAddError("Donne un nom à ta carte (ou ajoute une image).");
			return;
		}
		const item: TierlistItem = {
			id: `custom:${crypto.randomUUID().slice(0, 12)}`,
			label: label.slice(0, 60),
			image,
			category: CUSTOM_CATEGORY,
		};
		setBoard((prev) => ({ ...prev, pool: [item, ...prev.pool] }));
		setAddLabel("");
		setAddUrl("");
		setAddError(null);
		setActiveCat(CUSTOM_CATEGORY);
		if (fileRef.current) fileRef.current.value = "";
	}

	async function onPickFile(file: File) {
		setAddError(null);
		if (file.size > 4 * 1024 * 1024) {
			setAddError("Image trop lourde (max 4 Mo).");
			return;
		}
		setUploading(true);
		try {
			const fd = new FormData();
			fd.append("file", file);
			const res = await fetch("/api/tierlists/upload", { method: "POST", body: fd });
			const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
			if (!res.ok || !data.path) {
				setAddError(data.error ?? "Échec de l'upload.");
				return;
			}
			const nomFichier = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60);
			addCard(data.path, addLabel.trim() || nomFichier);
		} catch {
			setAddError("Réseau indisponible pour l'upload.");
		} finally {
			setUploading(false);
		}
	}

	function addByUrl() {
		const u = addUrl.trim();
		if (!/^https:\/\//i.test(u)) {
			setAddError("Colle une URL d'image en https.");
			return;
		}
		addCard(u);
	}

	async function save() {
		setError(null);
		if (title.trim().length < 2) {
			setError("Donne un titre à ta tierlist.");
			return;
		}
		if (board.tiers.every((t) => t.items.length === 0)) {
			setError("Place au moins une carte dans un tier.");
			return;
		}
		setSaving(true);

		// Mode admin : sauvegarde via la Server Action (création ou édition).
		if (isAdmin && onSave) {
			try {
				const res = await onSave({
					id: tierlistId,
					title: title.trim(),
					description: description.trim() || null,
					templateKey,
					tiers: board.tiers,
					official,
					featured,
					published,
				});
				if (!res.ok) {
					setError(res.error);
					setSaving(false);
					return;
				}
				router.push("/admin/tierlists");
				router.refresh();
			} catch {
				setError("Échec de l'enregistrement. Réessaie.");
				setSaving(false);
			}
			return;
		}

		// Flux public : POST /api/tierlists → page de la tierlist.
		try {
			const res = await fetch("/api/tierlists", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: title.trim(),
					description: description.trim() || null,
					templateKey,
					tiers: board.tiers,
				}),
			});
			const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
			// Sans le contrôle du slug, une réponse 200 sans slug envoyait sur
			// `/tierlists/undefined` (404) en laissant croire à un enregistrement réussi.
			if (!res.ok || !data.slug) {
				setError(data.error ?? "Échec de l'enregistrement.");
				setSaving(false);
				return;
			}
			router.push(`/tierlists/${data.slug}`);
		} catch {
			setError("Réseau indisponible. Réessaie.");
			setSaving(false);
		}
	}

	// Catégories présentes dans la réserve (pour les onglets de filtre).
	const categories = useMemo(() => {
		const set = new Set<string>();
		for (const it of board.pool) set.add(it.category || "Autres");
		return [...set].toSorted((a, b) =>
			a === CUSTOM_CATEGORY ? -1 : b === CUSTOM_CATEGORY ? 1 : a.localeCompare(b)
		);
	}, [board.pool]);

	// Si la catégorie active disparaît (toutes ses cartes placées dans des tiers),
	// on revient sur « Tous » pour ne pas bloquer la réserve sur un filtre vide.
	useEffect(() => {
		if (activeCat !== ALL && !categories.includes(activeCat)) setActiveCat(ALL);
	}, [categories, activeCat]);

	const visiblePool = useMemo(() => {
		const q = search.trim().toLowerCase();
		return board.pool.filter((it) => {
			if (activeCat !== ALL && (it.category || "Autres") !== activeCat) return false;
			if (q && !it.label.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [board.pool, search, activeCat]);

	const placedCount = board.tiers.reduce((n, t) => n + t.items.length, 0);

	const renderCard = (it: TierlistItem) => (
		<button
			key={it.id}
			type="button"
			draggable
			onDragStart={() => {
				dragId.current = it.id;
			}}
			onClick={(e) => {
				// Le clic ne doit PAS remonter à la zone (tier ou réserve) : elle y
				// placerait aussitôt la carte précédemment sélectionnée, puis
				// annulerait la sélection qu'on vient tout juste de faire.
				e.stopPropagation();
				setSelected((s) => (s === it.id ? null : it.id));
			}}
			aria-pressed={selected === it.id}
			title={it.label}
			className={`relative block h-14 w-14 shrink-0 cursor-grab overflow-hidden rounded-md border bg-white/5 transition-all active:cursor-grabbing sm:h-16 sm:w-16 ${
				selected === it.id
					? "border-[#ffd54f] ring-2 ring-[#ffd54f] scale-105"
					: "border-white/10 hover:border-white/40"
			}`}
		>
			{it.image ? (
				<img
					src={assetUrl(it.image)}
					alt={it.label}
					loading="lazy"
					className="h-full w-full object-cover object-top"
				/>
			) : (
				<span className="flex h-full w-full items-center justify-center px-0.5 text-center text-[8px] font-semibold leading-tight text-white/70">
					{it.label}
				</span>
			)}
		</button>
	);

	return (
		<div className="flex flex-col gap-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					maxLength={120}
					aria-label="Titre de ta tierlist"
					placeholder="Titre de ta tierlist"
					className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm font-bold text-white outline-none focus:border-[#ffd54f]"
				/>
				<input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					maxLength={200}
					aria-label="Description de la tierlist (optionnelle)"
					placeholder="Description (optionnelle)"
					className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white/80 outline-none focus:border-[#ffd54f]"
				/>
			</div>

			<p className="text-[12px] text-white/50">
				Sélectionne une carte puis tape un tier pour la placer — au clavier, Entrée sur la carte
				puis Entrée sur la pastille du tier. Ou glisse-la directement (sur ordinateur).{" "}
				{selected ? "Carte sélectionnée : tape un tier." : ""}
			</p>

			{/* Tiers */}
			<div className="flex flex-col gap-1.5">
				{board.tiers.map((t) => (
					<div
						key={t.id}
						onClick={() => onTapZone(t.id)}
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => onDrop(e, t.id)}
						className={`flex overflow-hidden rounded-lg border transition-colors ${
							selected ? "cursor-pointer border-[#ffd54f]/40" : "border-white/10"
						}`}
					>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onTapZone(t.id);
							}}
							aria-label={`Placer la carte sélectionnée dans le tier ${t.label}`}
							className="flex w-14 shrink-0 cursor-pointer items-center justify-center text-lg font-black text-black/85 sm:w-16"
							style={{ background: t.color }}
						>
							{t.label}
						</button>
						<div className="flex min-h-[4.5rem] flex-1 flex-wrap content-start gap-1 bg-black/30 p-1.5">
							{t.items.map(renderCard)}
						</div>
					</div>
				))}
			</div>

			{/* Réserve (cartes non classées) + filtres + ajout */}
			<div
				onClick={() => onTapZone("pool")}
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => onDrop(e, "pool")}
				className={`rounded-xl border bg-black/40 p-3 ${
					selected ? "cursor-pointer border-[#ffd54f]/40" : "border-white/10"
				}`}
			>
				<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onTapZone("pool");
						}}
						aria-label="Renvoyer la carte sélectionnée dans la réserve"
						className="cursor-pointer text-[12px] font-bold uppercase tracking-[0.14em] text-white/55"
					>
						Réserve · {visiblePool.length}
						{visiblePool.length !== board.pool.length ? ` / ${board.pool.length}` : ""}
					</button>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setAddOpen((v) => !v);
						}}
						className="rounded-md border border-[#ffd54f]/40 px-2.5 py-1 text-[12px] font-bold text-[#ffd54f] hover:bg-[#ffd54f]/10"
					>
						{addOpen ? "Fermer" : "+ Ajouter une image"}
					</button>
				</div>

				{/* Panneau d'ajout de carte custom */}
				{addOpen && (
					<div
						onClick={(e) => e.stopPropagation()}
						className="mb-3 grid gap-2 rounded-lg border border-white/10 bg-black/40 p-3 sm:grid-cols-[1fr_auto]"
					>
						<input
							value={addLabel}
							onChange={(e) => setAddLabel(e.target.value)}
							maxLength={60}
							aria-label="Nom de la nouvelle carte"
							placeholder="Nom de la carte (ex. Gogeta Blue)"
							className="rounded-md border border-white/15 bg-black/50 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#ffd54f] sm:col-span-2"
						/>
						<div className="flex flex-wrap items-center gap-2">
							<input
								ref={fileRef}
								type="file"
								aria-label="Image de la nouvelle carte"
								accept="image/png,image/jpeg,image/webp,image/gif"
								onChange={(e) => {
									const f = e.target.files?.[0];
									if (f) void onPickFile(f);
								}}
								className="max-w-[12rem] text-[12px] text-white/70 file:mr-2 file:rounded file:border-0 file:bg-[#ffd54f] file:px-2 file:py-1 file:text-[12px] file:font-bold file:text-black"
							/>
							{uploading && <span className="text-[12px] text-white/50">Upload…</span>}
						</div>
						<div className="flex items-center gap-2">
							<input
								value={addUrl}
								onChange={(e) => setAddUrl(e.target.value)}
								aria-label="URL de l'image de la carte"
								placeholder="…ou colle une URL d'image"
								className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/50 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#ffd54f]"
							/>
							<button
								type="button"
								onClick={addByUrl}
								className="shrink-0 rounded-md border border-white/20 px-2.5 py-1.5 text-[12px] font-bold text-white/80 hover:border-white/50"
							>
								URL
							</button>
						</div>
						<button
							type="button"
							onClick={() => addCard(null)}
							className="justify-self-start text-[12px] text-white/50 hover:text-white/80 sm:col-span-2"
						>
							+ Ajouter une carte texte (sans image)
						</button>
						{addError && (
							<p role="alert" className="text-[12px] font-semibold text-rose-400 sm:col-span-2">
								{addError}
							</p>
						)}
					</div>
				)}

				{/* Recherche + onglets catégories */}
				{board.pool.length > 0 && (
					<div className="mb-2 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
						<input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							aria-label="Rechercher une carte dans le vivier"
							placeholder="Rechercher une carte…"
							className="w-full rounded-md border border-white/12 bg-black/50 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#ffd54f] sm:max-w-xs"
						/>
						{categories.length > 1 && (
							<div className="flex flex-wrap gap-1.5">
								<button
									type="button"
									onClick={() => setActiveCat(ALL)}
									className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
										activeCat === ALL
											? "border-[#ffd54f] bg-[#ffd54f]/15 text-[#ffd54f]"
											: "border-white/12 text-white/55 hover:border-white/35"
									}`}
								>
									Tous
								</button>
								{categories.map((c) => (
									<button
										key={c}
										type="button"
										onClick={() => setActiveCat(c)}
										className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
											activeCat === c
												? "border-[#ffd54f] bg-[#ffd54f]/15 text-[#ffd54f]"
												: "border-white/12 text-white/55 hover:border-white/35"
										}`}
									>
										{c}
									</button>
								))}
							</div>
						)}
					</div>
				)}

				<div className="flex max-h-72 flex-wrap content-start gap-1 overflow-y-auto">
					{visiblePool.map(renderCard)}
					{board.pool.length === 0 &&
						(placedCount > 0 ? (
							<span className="text-[12px] italic text-white/50">
								Toutes les cartes sont classées.
							</span>
						) : (
							<span className="text-[12px] italic text-white/50">
								Ajoute tes propres cartes avec le bouton « + Ajouter une image ».
							</span>
						))}
					{board.pool.length > 0 && visiblePool.length === 0 && (
						<span className="text-[12px] italic text-white/50">
							Aucune carte ne correspond à ce filtre.
						</span>
					)}
				</div>
			</div>

			{/* Drapeaux de curation — admin uniquement. */}
			{isAdmin && (
				<div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#ffd54f]/25 bg-black/30 p-3">
					<span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#ffd54f]/80">
						Curation
					</span>
					<label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/85">
						<input
							type="checkbox"
							checked={official}
							onChange={(e) => setOfficial(e.target.checked)}
							className="h-4 w-4 accent-[#ffd54f]"
						/>
						Officielle
					</label>
					<label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/85">
						<input
							type="checkbox"
							checked={featured}
							onChange={(e) => setFeatured(e.target.checked)}
							className="h-4 w-4 accent-[#ffd54f]"
						/>
						Mise en avant
					</label>
					<label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/85">
						<input
							type="checkbox"
							checked={published}
							onChange={(e) => setPublished(e.target.checked)}
							className="h-4 w-4 accent-[#ffd54f]"
						/>
						Publiée
					</label>
				</div>
			)}

			{error && (
				<p role="alert" className="text-[13px] font-semibold text-rose-400">
					{error}
				</p>
			)}

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={save}
					disabled={saving}
					className="rounded-lg bg-[#ffd54f] px-5 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{saving
						? "Enregistrement…"
						: isAdmin
							? tierlistId
								? "Mettre à jour la tier list"
								: "Créer la tier list"
							: "Publier ma tierlist"}
				</button>
				<button
					type="button"
					onClick={() => {
						// Renvoyer TOUTES les cartes du plateau dans la réserve, pas seulement
						// le `pool` d'origine : en édition admin la réserve exclut déjà les
						// cartes classées, et une carte ajoutée à la main n'y figure jamais —
						// réinitialiser les faisait toutes disparaître définitivement.
						setBoard((prev) => {
							const vues = new Set<string>();
							const reserve = [...prev.pool, ...prev.tiers.flatMap((t) => t.items)].filter(
								(i) => !vues.has(i.id) && vues.add(i.id)
							);
							return { tiers: prev.tiers.map((t) => ({ ...t, items: [] })), pool: reserve };
						});
						setSelected(null);
					}}
					className="text-[13px] text-white/50 hover:text-white/80"
				>
					Réinitialiser
				</button>
			</div>
		</div>
	);
}

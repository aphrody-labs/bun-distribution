"use client";

import { type MouseEvent, useCallback, useEffect, useState } from "react";
import {
	Chargement,
	Coche,
	Crayon,
	Croix,
	Etincelle,
	Sac,
} from "@/components/icones";
import Link from "next/link";
import { formatZeni } from "@/lib/zeni";

interface EquippedState {
	card: string | null;
	badge: string | null;
	color: string | null;
	title: string | null;
	banner: string | null;
}

interface InventoryItem {
	type: string;
	key: string;
}

interface ShopCatalogItem {
	key: string;
	type: "card" | "badge" | "color" | "title" | "banner";
	name: string;
	description: string | null;
	price: number;
	preview?: string;
	roleColor?: string;
	meta?: Record<string, unknown>;
}

const DEFAULT_CARD_THEMES = [
	{ key: "card_default", id: "default", name: "DB Classic", accent: "#F3E603", preview: "/banners/banner-17.jpg" },
	{ key: "card_goku", id: "goku", name: "Son Goku", accent: "#F85B1A", preview: "/banners/banner-08.jpg" },
	{ key: "card_vegeta", id: "vegeta", name: "Prince Vegeta", accent: "#2955DC", preview: "/banners/banner-03.png" },
	{ key: "card_kaio", id: "kaio", name: "Kaio-ken", accent: "#FA0011", preview: "/banners/banner-10.jpg" },
	{ key: "card_ssj", id: "ssj", name: "Super Saiyan", accent: "#F9EE54", preview: "/banners/banner-04.jpg" },
	{ key: "card_blue", id: "blue", name: "Super Saiyan Blue", accent: "#00E5FF", preview: "/banners/banner-15.jpg" },
	{ key: "card_rose", id: "rose", name: "Super Saiyan Rosé", accent: "#FF4FB0", preview: "/banners/banner-16.png" },
	{ key: "card_ultra", id: "ultra", name: "Ultra Instinct", accent: "#E5E9F0", preview: "/banners/banner-02.jpg" },
];

export function ProfileCardCustomizer({
	discordId,
	username,
	initialEquipped,
	initialCardUrl,
	isOwner,
}: {
	discordId: string;
	username: string;
	initialEquipped: Partial<EquippedState>;
	initialCardUrl: string;
	isOwner: boolean;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<"card" | "badge" | "title" | "color" | "banner">("card");

	// État officiel en base
	const [currentEquipped, setCurrentEquipped] = useState<EquippedState>({
		card: initialEquipped.card ?? null,
		badge: initialEquipped.badge ?? null,
		color: initialEquipped.color ?? null,
		title: initialEquipped.title ?? null,
		banner: initialEquipped.banner ?? null,
	});

	// État de prévisualisation locale avant sauvegarde
	const [draftEquipped, setDraftEquipped] = useState<EquippedState>({
		card: initialEquipped.card ?? null,
		badge: initialEquipped.badge ?? null,
		color: initialEquipped.color ?? null,
		title: initialEquipped.title ?? null,
		banner: initialEquipped.banner ?? null,
	});

	const [ownedItems, setOwnedItems] = useState<InventoryItem[]>([]);
	const [catalog, setCatalog] = useState<ShopCatalogItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [previewTs, setPreviewTs] = useState<number>(Date.now());
	const [cardUrl, setCardUrl] = useState<string>(initialCardUrl);

	// Chargement inventaire & catalogue boutique
	const loadUserData = useCallback(async () => {
		try {
			setLoading(true);
			const [balRes, shopRes] = await Promise.all([
				fetch("/api/bot-user/economy/balance").catch(() => null),
				fetch("/api/public/shop").catch(() => null),
			]);

			if (balRes?.ok) {
				const balData = await balRes.json();
				if (balData.equipped) {
					const eq: EquippedState = {
						card: balData.equipped.card ?? null,
						badge: balData.equipped.badge ?? null,
						color: balData.equipped.color ?? null,
						title: balData.equipped.title ?? null,
						banner: balData.equipped.banner ?? null,
					};
					setCurrentEquipped(eq);
					setDraftEquipped(eq);
				}
				if (Array.isArray(balData.owned)) {
					setOwnedItems(balData.owned);
				}
			}

			if (shopRes?.ok) {
				const shopData = await shopRes.json();
				if (Array.isArray(shopData.items)) {
					setCatalog(shopData.items);
				}
			}
		} catch {
			// Erreur réseau tolérée
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen && isOwner) {
			void loadUserData();
		}
	}, [isOpen, isOwner, loadUserData]);

	// Vérifie si un objet est possédé
	const isOwned = (type: string, key: string) => {
		// Le thème par défaut est toujours possédé
		if (type === "card" && (key === "card_default" || key === "default")) return true;
		return ownedItems.some((it) => it.type === type && (it.key === key || it.key === key.replace(/^card_/, "")));
	};

	// Changement d'option avec mise à jour du rendu
	const handleSelectDraft = (type: keyof EquippedState, key: string | null) => {
		const next = { ...draftEquipped, [type]: key };
		setDraftEquipped(next);
		setPreviewLoading(true);
		setPreviewTs(Date.now());
	};

	// URL de prévisualisation dynamique (interroge Skia via l'API publique)
	const getLivePreviewUrl = () => {
		const params = new URLSearchParams();
		if (draftEquipped.card) params.set("theme", draftEquipped.card);
		if (draftEquipped.badge) params.set("badge", draftEquipped.badge);
		if (draftEquipped.title) params.set("title", draftEquipped.title);
		if (draftEquipped.color) params.set("color", draftEquipped.color);
		params.set("ts", String(previewTs));
		return `/api/public/profile/${discordId}/card.png?${params.toString()}`;
	};

	// Sauvegarde / Équipement des modifications
	const handleSaveAll = async () => {
		setSaving(true);
		setStatusMsg(null);
		const errors: string[] = [];

		const slots: Array<keyof EquippedState> = ["card", "badge", "title", "color", "banner"];

		for (const slot of slots) {
			const oldVal = currentEquipped[slot];
			const newVal = draftEquipped[slot];

			if (oldVal !== newVal) {
				try {
					if (!newVal) {
						// Retrait
						const res = await fetch("/api/bot-user/economy/unequip", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ type: slot }),
						});
						if (!res.ok) {
							const err = await res.json().catch(() => ({}));
							errors.push(`Échec retrait ${slot}: ${err.error || err.reason || "Erreur"}`);
						}
					} else {
						// Équipement
						const res = await fetch("/api/bot-user/economy/equip", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ type: slot, key: newVal }),
						});
						if (!res.ok) {
							const err = await res.json().catch(() => ({}));
							errors.push(`Échec équipement ${slot}: ${err.error || err.reason || "Erreur"}`);
						}
					}
				} catch {
					errors.push(`Erreur réseau sur ${slot}`);
				}
			}
		}

		setSaving(false);

		if (errors.length === 0) {
			setCurrentEquipped({ ...draftEquipped });
			setStatusMsg({ ok: true, text: "Ta carte de profil a été mise à jour avec succès !" });
			// Mettre à jour l'image de la carte principale
			const newTs = Date.now();
			setCardUrl(`/api/public/profile/${discordId}/card.png?v=${newTs}`);
			setTimeout(() => {
				setIsOpen(false);
				setStatusMsg(null);
			}, 1200);
		} else {
			setStatusMsg({ ok: false, text: errors.join(" · ") });
		}
	};

	const hasChanges =
		draftEquipped.card !== currentEquipped.card ||
		draftEquipped.badge !== currentEquipped.badge ||
		draftEquipped.title !== currentEquipped.title ||
		draftEquipped.color !== currentEquipped.color ||
		draftEquipped.banner !== currentEquipped.banner;

	// Objets du catalogue groupés
	const catalogByType = (type: string) => catalog.filter((it) => it.type === type);

	return (
		<figure className="relative rounded-2xl border border-white/10 bg-black/25 p-3 md:p-4">
			<div className="mb-3 flex items-center justify-between">
				<figcaption className="font-scouter text-[11px] uppercase tracking-[.18em] text-white/55">
					Carte officielle
				</figcaption>
				<div className="flex items-center gap-3">
					{isOwner && (
						<button
							type="button"
							onClick={() => setIsOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-full border border-dbz-orange/60 bg-dbz-orange/15 px-3 py-1 text-xs font-semibold text-dbz-orange transition hover:border-yellow-300 hover:bg-dbz-orange/25 hover:text-yellow-200"
						>
							<Crayon className="h-3 w-3" />
							Personnaliser ma carte
						</button>
					)}
					<a
						href={cardUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-xs text-dbz-orange hover:text-yellow-200"
					>
						PNG ↗
					</a>
				</div>
			</div>

			{/* Carte de profil principale */}
			<div className="relative overflow-hidden rounded-xl border border-dbz-orange/20">
				<img
					src={cardUrl}
					alt={`Carte de ${username}`}
					width="1200"
					height="630"
					fetchPriority="high"
					className="w-full object-cover transition-opacity duration-300"
				/>
			</div>

			<p className="mt-3 text-center text-xs text-white/40">
				Générée en direct par le bot Shenron · format officiel 1200×630
			</p>

			{/* MODAL / ÉDITEUR INTERACTIF COMPLET */}
			{isOpen && isOwner && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-md sm:p-6 overflow-y-auto">
					<div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-2xl border border-dbz-orange/40 bg-[#14120e] shadow-2xl">
						{/* En-tête Modal */}
						<div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
							<div className="flex items-center gap-2">
								<Etincelle className="h-5 w-5 text-dbz-orange" />
								<h2 className="font-saiyan text-2xl text-white">Personnalisation de ta Carte</h2>
							</div>
							<button
								type="button"
								onClick={() => setIsOpen(false)}
								className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition"
								aria-label="Fermer"
							>
								<Croix className="h-4 w-4" />
							</button>
						</div>

						{/* Corps de l'éditeur avec scroll */}
						<div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
							{/* 1. Zone d'Aperçu Temps Réel */}
							<div className="rounded-xl border border-white/10 bg-black/50 p-3 sm:p-4">
								<div className="mb-2 flex items-center justify-between">
									<span className="text-[10px] uppercase tracking-widest text-dbz-orange font-scouter">
										Aperçu en direct (Skia Engine)
									</span>
									{previewLoading && (
										<span className="flex items-center gap-1 text-[11px] text-zinc-400">
											<Chargement className="h-3 w-3 animate-spin text-dbz-orange" />
											Rendu du ki en cours…
										</span>
									)}
								</div>

								<div className="relative aspect-[1000/360] w-full overflow-hidden rounded-lg border border-dbz-orange/30 bg-black">
									<img
										src={getLivePreviewUrl()}
										alt="Aperçu carte"
										onLoad={() => setPreviewLoading(false)}
										className="h-full w-full object-cover"
									/>
								</div>

								{/* Résumé des éléments sélectionnés */}
								<div className="mt-3 flex flex-wrap gap-2 text-xs">
									<span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
										Fond : {draftEquipped.card || "DB Classic"}
									</span>
									<span className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-200">
										Badge : {draftEquipped.badge || "Aucun"}
									</span>
									<span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-purple-200">
										Titre : {draftEquipped.title || "Aucun"}
									</span>
									<span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-blue-200">
										Couleur : {draftEquipped.color || "Défaut"}
									</span>
									{draftEquipped.banner && (
										<span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">
											Bannière : {draftEquipped.banner}
										</span>
									)}
								</div>
							</div>

							{/* Feedback statut */}
							{statusMsg && (
								<div
									className={`flex items-center gap-2 rounded-xl p-3 text-sm font-medium ${
										statusMsg.ok
											? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
											: "border border-red-500/40 bg-red-500/10 text-red-300"
									}`}
								>
									{statusMsg.ok && <Coche className="h-4 w-4 shrink-0" />}
									<span>{statusMsg.text}</span>
								</div>
							)}

							{/* Indicateur de chargement des possessions */}
							{loading && (
								<div className="flex items-center justify-center gap-2 py-3 rounded-lg border border-white/5 bg-black/30 text-xs text-zinc-400">
									<Chargement className="h-4 w-4 animate-spin text-dbz-orange" />
									Chargement de tes objets et du catalogue…
								</div>
							)}

							{/* 2. Onglets de sélection des catégories */}
							<div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-2">
								<button
									type="button"
									onClick={() => setActiveTab("card")}
									className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
										activeTab === "card"
											? "bg-amber-500/20 text-amber-300 border border-amber-500/50"
											: "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
									}`}
								>
									札 Thème de Carte ({DEFAULT_CARD_THEMES.length})
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("badge")}
									className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
										activeTab === "badge"
											? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/50"
											: "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
									}`}
								>
									章 Badge d&apos;Emblème
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("title")}
									className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
										activeTab === "title"
											? "bg-purple-500/20 text-purple-300 border border-purple-500/50"
											: "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
									}`}
								>
									号 Titre Honorifique
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("color")}
									className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
										activeTab === "color"
											? "bg-blue-500/20 text-blue-300 border border-blue-500/50"
											: "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
									}`}
								>
									色 Couleur de Pseudo & Aura
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("banner")}
									className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
										activeTab === "banner"
											? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
											: "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
									}`}
								>
									旗 Bannière de Profil
								</button>
							</div>

							{/* 3. Contenu de la catégorie active */}

							{/* --- THÈMES DE CARTE --- */}
							{activeTab === "card" && (
								<div className="space-y-3">
									<p className="text-xs text-zinc-400">
										Sélectionne le thème visuel de ta carte officielle. Clique pour prévisualiser instantanément.
									</p>
									<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
										{DEFAULT_CARD_THEMES.map((theme) => {
											const owned = isOwned("card", theme.key) || isOwned("card", theme.id);
											const isSelected =
												draftEquipped.card === theme.id ||
												draftEquipped.card === theme.key ||
												(!draftEquipped.card && theme.id === "default");

											return (
												<div
													key={theme.id}
													onClick={() => handleSelectDraft("card", theme.id === "default" ? null : theme.id)}
													className={`group relative cursor-pointer overflow-hidden rounded-xl border p-2 transition-all ${
														isSelected
															? "border-amber-400 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
															: "border-white/10 bg-black/40 hover:border-white/30"
													}`}
												>
													<div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-black/60">
														<img
															src={theme.preview}
															alt={theme.name}
															className="h-full w-full object-cover transition-transform group-hover:scale-105"
														/>
														<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
														<span
															className="absolute bottom-1.5 left-2 text-[10px] font-bold"
															style={{ color: theme.accent }}
														>
															{theme.name}
														</span>
													</div>

													<div className="mt-2 flex items-center justify-between text-xs">
														{isSelected ? (
															<span className="flex items-center gap-1 font-bold text-amber-400 text-[11px]">
																<Coche className="h-3 w-3" /> Sélectionné
															</span>
														) : owned ? (
															<span className="text-zinc-400 text-[11px]">Possédé</span>
														) : (
															<Link
																href="/shop"
																onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
																className="text-dbz-orange hover:underline text-[10px]"
															>
																Boutique ↗
															</Link>
														)}
													</div>
												</div>
											);
										})}
									</div>
								</div>
							)}

							{/* --- BADGES D'EMBLÈME --- */}
							{activeTab === "badge" && (
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<p className="text-xs text-zinc-400">
											L&apos;insigne de ton maître ou de ton allégeance martiale, affiché à côté de ton nom.
										</p>
										{draftEquipped.badge && (
											<button
												type="button"
												onClick={() => handleSelectDraft("badge", null)}
												className="text-xs text-red-400 hover:text-red-300 underline"
											>
												Retirer le badge
											</button>
										)}
									</div>

									<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
										{/* Option Aucun Badge */}
										<div
											onClick={() => handleSelectDraft("badge", null)}
											className={`cursor-pointer rounded-xl border p-4 text-center transition ${
												!draftEquipped.badge
													? "border-fuchsia-400 bg-fuchsia-500/10"
													: "border-white/10 bg-black/40 hover:border-white/25"
											}`}
										>
											<div className="flex h-16 items-center justify-center text-zinc-500 text-sm">
												∅ Aucun
											</div>
											<p className="text-xs font-semibold text-white">Sans badge</p>
										</div>

										{/* Badges du catalogue ou de l'inventaire */}
										{catalogByType("badge").map((badge) => {
											const owned = isOwned("badge", badge.key);
											const isSelected = draftEquipped.badge === badge.key;

											return (
												<div
													key={badge.key}
													onClick={() => {
														if (owned) handleSelectDraft("badge", badge.key);
													}}
													className={`relative rounded-xl border p-3 text-center transition ${
														isSelected
															? "border-fuchsia-400 bg-fuchsia-500/15 shadow-[0_0_15px_rgba(217,70,239,0.2)]"
															: owned
																? "cursor-pointer border-white/10 bg-black/40 hover:border-white/30"
																: "opacity-40 border-dashed border-zinc-800 bg-black/20"
													}`}
												>
													<div className="flex h-16 items-center justify-center">
														{badge.preview ? (
															<img
																src={badge.preview}
																alt={badge.name}
																className="h-12 w-12 object-contain"
															/>
														) : (
															<span className="font-saiyan text-3xl text-fuchsia-400">章</span>
														)}
													</div>
													<p className="text-xs font-semibold text-white truncate mt-1">{badge.name}</p>
													<div className="mt-1">
														{isSelected ? (
															<span className="text-[10px] font-bold text-fuchsia-400">Équipé</span>
														) : owned ? (
															<span className="text-[10px] text-zinc-400">Possédé</span>
														) : (
															<Link
																href="/shop"
																className="text-[10px] text-dbz-orange hover:underline"
															>
																{formatZeni(badge.price)} ↗
															</Link>
														)}
													</div>
												</div>
											);
										})}
									</div>
								</div>
							)}

							{/* --- TITRES HONORIFIQUES --- */}
							{activeTab === "title" && (
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<p className="text-xs text-zinc-400">
											Titre de prestige gravé sur ta carte officielle au-dessus de ton pseudo.
										</p>
										{draftEquipped.title && (
											<button
												type="button"
												onClick={() => handleSelectDraft("title", null)}
												className="text-xs text-red-400 hover:text-red-300 underline"
											>
												Retirer le titre
											</button>
										)}
									</div>

									<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
										{/* Option Aucun Titre */}
										<div
											onClick={() => handleSelectDraft("title", null)}
											className={`cursor-pointer rounded-xl border p-3 text-center transition ${
												!draftEquipped.title
													? "border-purple-400 bg-purple-500/10"
													: "border-white/10 bg-black/40 hover:border-white/25"
											}`}
										>
											<p className="text-xs font-semibold text-zinc-400">∅ Aucun titre honorifique</p>
										</div>

										{/* Titres du catalogue */}
										{catalogByType("title").map((title) => {
											const owned = isOwned("title", title.key);
											const isSelected = draftEquipped.title === title.key;

											return (
												<div
													key={title.key}
													onClick={() => {
														if (owned) handleSelectDraft("title", title.key);
													}}
													className={`rounded-xl border p-3 transition ${
														isSelected
															? "border-purple-400 bg-purple-500/15 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
															: owned
																? "cursor-pointer border-white/10 bg-black/40 hover:border-white/30"
																: "opacity-40 border-dashed border-zinc-800 bg-black/20"
													}`}
												>
													<p className="font-serif italic text-xs font-bold text-amber-200">
														« {title.name} »
													</p>
													<div className="mt-1.5 flex items-center justify-between text-[10px]">
														{isSelected ? (
															<span className="font-bold text-purple-300">Équipé</span>
														) : owned ? (
															<span className="text-zinc-400">Possédé</span>
														) : (
															<Link
																href="/shop"
																className="text-dbz-orange hover:underline font-mono"
															>
																{formatZeni(title.price)} ↗
															</Link>
														)}
													</div>
												</div>
											);
										})}
									</div>
								</div>
							)}

							{/* --- COULEURS D'AURA & DE PSEUDO --- */}
							{activeTab === "color" && (
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<p className="text-xs text-zinc-400">
											Couleur attribuée à ton nom dans Discord et teinte de l&apos;aura de ta carte.
										</p>
										{draftEquipped.color && (
											<button
												type="button"
												onClick={() => handleSelectDraft("color", null)}
												className="text-xs text-red-400 hover:text-red-300 underline"
											>
												Couleur par défaut
											</button>
										)}
									</div>

									<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
										<div
											onClick={() => handleSelectDraft("color", null)}
											className={`cursor-pointer rounded-xl border p-3 flex items-center gap-2 transition ${
												!draftEquipped.color
													? "border-blue-400 bg-blue-500/10"
													: "border-white/10 bg-black/40 hover:border-white/25"
											}`}
										>
											<span className="h-4 w-4 rounded-full border border-white/30 bg-zinc-700" />
											<span className="text-xs font-semibold text-white">Couleur du Thème</span>
										</div>

										{catalogByType("color").map((col) => {
											const owned = isOwned("color", col.key);
											const isSelected = draftEquipped.color === col.key;

											return (
												<div
													key={col.key}
													onClick={() => {
														if (owned) handleSelectDraft("color", col.key);
													}}
													className={`rounded-xl border p-3 flex items-center justify-between gap-2 transition ${
														isSelected
															? "border-blue-400 bg-blue-500/15"
															: owned
																? "cursor-pointer border-white/10 bg-black/40 hover:border-white/30"
																: "opacity-40 border-dashed border-zinc-800 bg-black/20"
													}`}
												>
													<div className="flex items-center gap-2 min-w-0">
														<span
															className="h-4 w-4 shrink-0 rounded-full border border-white/20"
															style={{ background: col.roleColor || "#f59e0b" }}
														/>
														<span className="text-xs font-semibold text-white truncate">
															{col.name}
														</span>
													</div>
													{isSelected ? (
														<Coche className="h-3.5 w-3.5 text-blue-400 shrink-0" />
													) : !owned && (
														<Link
															href="/shop"
															className="text-[10px] text-dbz-orange hover:underline shrink-0"
														>
															Shop ↗
														</Link>
													)}
												</div>
											);
										})}
									</div>
								</div>
							)}

							{/* --- BANNIÈRES --- */}
							{activeTab === "banner" && (
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<p className="text-xs text-zinc-400">
											Bannière d&apos;en-tête de ton profil et fond alternatif.
										</p>
										{draftEquipped.banner && (
											<button
												type="button"
												onClick={() => handleSelectDraft("banner", null)}
												className="text-xs text-red-400 hover:text-red-300 underline"
											>
												Retirer la bannière
											</button>
										)}
									</div>

									<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
										<div
											onClick={() => handleSelectDraft("banner", null)}
											className={`cursor-pointer rounded-xl border p-3 text-center transition ${
												!draftEquipped.banner
													? "border-emerald-400 bg-emerald-500/10"
													: "border-white/10 bg-black/40 hover:border-white/25"
											}`}
										>
											<div className="aspect-[3/1] flex items-center justify-center text-xs text-zinc-500 bg-black/50 rounded-lg mb-1.5">
												∅ Aucune bannière
											</div>
											<span className="text-xs font-semibold text-white">Bannière par défaut</span>
										</div>

										{catalogByType("banner").map((ban) => {
											const owned = isOwned("banner", ban.key);
											const isSelected = draftEquipped.banner === ban.key;

											return (
												<div
													key={ban.key}
													onClick={() => {
														if (owned) handleSelectDraft("banner", ban.key);
													}}
													className={`rounded-xl border p-2 transition ${
														isSelected
															? "border-emerald-400 bg-emerald-500/15"
															: owned
																? "cursor-pointer border-white/10 bg-black/40 hover:border-white/30"
																: "opacity-40 border-dashed border-zinc-800 bg-black/20"
													}`}
												>
													<div className="aspect-[3/1] overflow-hidden rounded-lg bg-black/60">
														{ban.preview ? (
															<img
																src={ban.preview}
																alt={ban.name}
																className="h-full w-full object-cover"
															/>
														) : (
															<div className="h-full flex items-center justify-center text-xs text-zinc-600">
																Bannière
															</div>
														)}
													</div>
													<div className="mt-1.5 flex items-center justify-between text-xs">
														<span className="truncate text-white font-medium text-[11px]">{ban.name}</span>
														{isSelected ? (
															<span className="text-emerald-400 font-bold text-[10px]">Équipée</span>
														) : !owned && (
															<Link
																href="/shop"
																className="text-dbz-orange hover:underline text-[10px]"
															>
																Shop ↗
															</Link>
														)}
													</div>
												</div>
											);
										})}
									</div>
								</div>
							)}
						</div>

						{/* Pied de Modal avec Actions */}
						<div className="flex items-center justify-between border-t border-white/10 bg-black/40 px-5 py-3.5">
							<Link
								href="/shop"
								className="inline-flex items-center gap-1.5 text-xs text-dbz-orange hover:text-yellow-200"
							>
								<Sac className="h-3.5 w-3.5" />
								Aller à la Boutique pour débloquer plus d&apos;objets
							</Link>

							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => {
										setDraftEquipped({ ...currentEquipped });
										setIsOpen(false);
									}}
									className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white transition"
								>
									Annuler
								</button>
								<button
									type="button"
									disabled={saving || !hasChanges}
									onClick={handleSaveAll}
									className="dbz-button inline-flex items-center gap-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
								>
									{saving ? (
										<>
											<Chargement className="h-3.5 w-3.5 animate-spin" />
											Équipement en cours…
										</>
									) : (
										<>
											<Coche className="h-3.5 w-3.5" />
											Enregistrer ma carte
										</>
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</figure>
	);
}

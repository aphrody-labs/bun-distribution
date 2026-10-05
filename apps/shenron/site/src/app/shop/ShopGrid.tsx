"use client";

/**
 * Boutique Shenron — le comptoir de la Capsule Corporation.
 *
 * Catalogue public (rendu serveur, caché) + îlot client qui lit le solde et
 * l'inventaire du membre connecté (proxy bot-user signé) pour ACHETER, ÉQUIPER
 * et RETIRER directement sur le site.
 *
 * Trois informations économiques nouvelles, toutes mesurées côté bot :
 *  - le prix du jour, indexé sur l'inflation du serveur (prix de base barré
 *    quand il a bougé) ;
 *  - un repère canon par article (« ≈ 77 courses de taxi »), tiré de la grille
 *    de prix du Chōzenshū 4 — la planche est citée et cliquable ;
 *  - les avis URSAF et le gel des gains du membre, affichés AVANT l'achat : un
 *    joueur ne doit pas découvrir un prélèvement en ouvrant son solde.
 *
 * Design system : surface + filet 1 px, rayon 12 px, survol or, aucune ombre
 * portée, aucun emoji.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cadenas, Chargement, Coche, Piece, Sac } from "@/components/icones";
import { onTablistKeyDown } from "@/lib/tablist-keys";
import type { CanonPrice, ShopEconomy } from "@/lib/shenron";
import { formatZeni } from "@/lib/zeni";

interface ShopItem {
	key: string;
	type: "card" | "badge" | "color" | "title" | "banner";
	name: string;
	description: string | null;
	price: number;
	effectivePrice?: number;
	roleId: string | null;
	roleColor?: string;
	preview?: string;
	meta?: Record<string, unknown>;
}

type UrsafNotice = {
	reference: string;
	amount: number;
	collected: number;
	rate: number;
	status: "pending" | "notified" | "collected" | "cancelled";
	createdAt: number;
};

type Balance = {
	balance: number;
	owned: { type: string; key: string }[];
	equipped: Record<string, string | null>;
	frozen?: boolean;
	ursaf?: UrsafNotice[];
};

const TYPE_LABELS: Record<ShopItem["type"], string> = {
	card: "Carte",
	badge: "Badge",
	color: "Couleur",
	title: "Titre",
	banner: "Bannière",
};
const TYPE_KANJI: Record<ShopItem["type"], string> = {
	card: "札",
	badge: "章",
	color: "色",
	title: "号",
	banner: "旗",
};
const TYPE_ORDER: ShopItem["type"][] = ["banner", "card", "badge", "color", "title"];

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Prix réellement débité (indexé si l'inflation est active). */
const priceOf = (it: ShopItem) => it.effectivePrice ?? it.price;

/** Repère canon le plus parlant : le plus cher qui tient dans le montant. */
function canonEquivalent(zeni: number, prices: readonly CanonPrice[]) {
	let best: CanonPrice | null = null;
	for (const p of prices) if (p.zeni <= zeni && (!best || p.zeni >= best.zeni)) best = p;
	return best ? { price: best, times: zeni / best.zeni } : null;
}

const surface = "rounded-xl border border-white/10 bg-[#151412]";

export function ShopGrid({ items, economy }: { items: ShopItem[]; economy: ShopEconomy | null }) {
	const [state, setState] = useState<Balance | null>(null);
	const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [flash, setFlash] = useState<{ key: string; ok: boolean; msg: string } | null>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(items[0]?.key ?? null);
	const [filter, setFilter] = useState<ShopItem["type"] | "all">("all");
	const [query, setQuery] = useState("");
	/** Le solde n'a pas pu être lu alors qu'on ne sait rien de la session. */
	const [soldeIndisponible, setSoldeIndisponible] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/bot-user/economy/balance");
			if (res.status === 401) {
				setSoldeIndisponible(false);
				setLoggedIn(false);
				return;
			}
			// Une erreur du proxy (500, bot injoignable) renvoie du JSON sans `owned` :
			// on refuse la charge utile ET on quitte l'état « chargement » : sans cela la
			// boutique restait bloquée sur « Chargement de ton solde… » indéfiniment.
			const data = res.ok ? ((await res.json().catch(() => null)) as Partial<Balance> | null) : null;
			if (!data || !Array.isArray(data.owned) || typeof data.balance !== "number") {
				setSoldeIndisponible(true);
				return;
			}
			setSoldeIndisponible(false);
			setLoggedIn(true);
			setState({
				balance: data.balance,
				owned: data.owned,
				equipped: data.equipped ?? {},
				frozen: data.frozen,
				ursaf: data.ursaf ?? [],
			});
		} catch {
			// Réseau coupé : on ne sait pas si la session est valide, on ne prétend
			// donc pas que le membre est déconnecté — on dit que le solde manque.
			setSoldeIndisponible(true);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const owns = (it: ShopItem) => state?.owned.some((o) => o.type === it.type && o.key === it.key);
	const equipped = (it: ShopItem) => state?.equipped[it.type] === it.key;

	async function act(
		it: ShopItem,
		path: "purchase" | "equip" | "unequip",
		body: Record<string, string>,
		okMsg: string,
		koMsg: string
	) {
		setBusy(it.key);
		setFlash(null);
		try {
			const res = await fetch(`/api/bot-user/economy/${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = (await res.json().catch(() => null)) as {
				ok?: boolean;
				reason?: string;
				error?: string;
				balance?: number;
			} | null;
			if (res.ok && data?.ok) {
				setFlash({ key: it.key, ok: true, msg: okMsg });
				await refresh();
			} else {
				setFlash({ key: it.key, ok: false, msg: data?.reason ?? data?.error ?? koMsg });
				if (typeof data?.balance === "number") {
					const balance = data.balance;
					setState((s) => (s ? { ...s, balance } : s));
				}
			}
		} catch {
			setFlash({ key: it.key, ok: false, msg: "Erreur réseau." });
		} finally {
			setBusy(null);
		}
	}

	const buy = (it: ShopItem) =>
		act(it, "purchase", { key: it.key }, "Acheté ! Tu peux l'équiper.", "Achat impossible.");
	const equip = (it: ShopItem) =>
		act(it, "equip", { type: it.type, key: it.key }, "Équipé.", "Équipement impossible.");
	const unequip = (it: ShopItem) =>
		act(it, "unequip", { type: it.type }, "Retiré : apparence par défaut rétablie.", "Retrait impossible.");

	const visibleItems = useMemo(
		() =>
			items.filter(
				(it) =>
					(filter === "all" || it.type === filter) &&
					(!query.trim() ||
						`${it.name} ${it.description ?? ""}`.toLowerCase().includes(query.toLowerCase()))
			),
		[filter, items, query]
	);
	const selected = visibleItems.find((it) => it.key === selectedKey) ?? visibleItems[0] ?? items[0];
	const selectedColor = selected?.roleColor ?? (selected?.type === "color" ? "#7c3aed" : "#f5b52e");
	const grouped = visibleItems.reduce<Partial<Record<ShopItem["type"], ShopItem[]>>>((acc, it) => {
		(acc[it.type] ??= []).push(it);
		return acc;
	}, {});
	for (const list of Object.values(grouped)) list?.sort((a, b) => priceOf(a) - priceOf(b));

	const canon = economy?.canonPrices ?? [];
	const index = economy?.priceIndex ?? 1;
	const openNotices = (state?.ursaf ?? []).filter((n) => n.status !== "cancelled");

	return (
		<div className="space-y-8">
			{/* ── Comptoir : titre, solde, indice des prix ─────────────────── */}
			<header className={`${surface} relative overflow-hidden p-6 md:p-9`}>
				<span
					aria-hidden
					className="pointer-events-none absolute -right-4 -top-10 font-saiyan text-[11rem] leading-none text-dbz-orange/[.07]"
				>
					銭
				</span>
				<div className="relative grid gap-6 md:grid-cols-[1.3fr_.7fr] md:items-end">
					<div>
						<p className="font-scouter text-[11px] uppercase tracking-[.28em] text-dbz-orange">
							Capsule Corporation · comptoir de Shenron
						</p>
						<h1 className="mt-2 font-saiyan text-4xl leading-none text-white md:text-6xl">
							Boutique Shenron
						</h1>
						<p className="mt-4 max-w-xl text-sm leading-6 text-white/60">
							Bannières, couleurs, titres et badges à acheter et équiper directement sur le site.
							Les prix suivent l&apos;économie du serveur, comme ceux de l&apos;univers : le prix du
							Tenkaichi Budokai est lui-même passé de 500 000 à 1,48 million de Ƶ.
						</p>
					</div>
					<div className="grid gap-3">
						<div className={`${surface} bg-black/30 p-4`}>
							{loggedIn === false ? (
								<p className="flex items-center gap-2 text-sm text-white/70">
									<Cadenas className="h-4 w-4 text-dbz-orange" />
									Connecte-toi avec Discord pour acheter.
								</p>
							) : loggedIn === null && soldeIndisponible ? (
								<p className="text-sm text-white/70">Solde indisponible pour le moment.</p>
							) : loggedIn === null ? (
								<p className="flex items-center gap-2 text-sm text-white/50">
									<Chargement className="h-4 w-4 animate-spin" /> Lecture du solde…
								</p>
							) : (
								<>
									<p className="text-[10px] uppercase tracking-[.2em] text-white/45">Ton solde</p>
									<p className="mt-1 flex items-center gap-2 font-saiyan text-3xl text-dbz-yellow">
										<Piece className="h-6 w-6" />
										{formatZeni(state?.balance ?? 0)}
									</p>
								</>
							)}
							{loggedIn === false && (
								<a href="/signin" className="dbz-button mt-3 inline-flex text-sm">
									Se connecter
								</a>
							)}
							{loggedIn === null && soldeIndisponible && (
								<button
									type="button"
									onClick={() => void refresh()}
									className="cible-44 mt-3 rounded-xl border border-dbz-orange/50 px-4 py-2 text-xs font-semibold text-dbz-orange hover:border-dbz-yellow hover:text-dbz-yellow"
								>
									Réessayer
								</button>
							)}
						</div>
						<div className={`${surface} bg-black/30 px-4 py-3`}>
							<p className="text-[10px] uppercase tracking-[.2em] text-white/45">Indice des prix</p>
							{economy?.inflationEnabled ? (
								<p className="mt-1 text-sm text-white/80">
									<strong className="font-saiyan text-xl text-white">×{nf.format(index)}</strong>{" "}
									<span className={economy.change7d > 0 ? "text-red-300" : "text-emerald-300"}>
										{economy.change7d > 0 ? "+" : ""}
										{nf.format(economy.change7d)} % sur 7 jours
									</span>
									<span className="block text-[11px] text-white/40">
										Plafond : ×{nf.format(economy.ceiling)}, l&apos;inflation canon du Budokai.
									</span>
								</p>
							) : (
								<p className="mt-1 text-sm text-white/60">Prix stables : l&apos;inflation n&apos;est pas active.</p>
							)}
						</div>
					</div>
				</div>
			</header>

			{/* ── Alertes du membre : gel et avis URSAF ────────────────────── */}
			{state?.frozen && (
				<div role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200">
					<strong className="font-semibold">Gains gelés.</strong> L&apos;anti-triche a suspendu tes gains de
					zénis le temps d&apos;une vérification. Tes achats restent possibles ; pour contester, ouvre un
					ticket sur le serveur.
				</div>
			)}
			{openNotices.length > 0 && (
				<section aria-labelledby="ursaf-title" className="rounded-xl border border-amber-400/50 bg-amber-400/[.07] p-4">
					<h2 id="ursaf-title" className="text-sm font-semibold text-amber-200">
						URSAF · Union de Recouvrement des Saiyens et Autres Fraudeurs
					</h2>
					<ul className="mt-2 divide-y divide-amber-400/15 text-sm">
						{openNotices.map((n) => (
							<li key={n.reference} className="flex flex-wrap items-center justify-between gap-2 py-2">
								<span className="font-mono text-xs text-amber-100/80">{n.reference}</span>
								<span className="text-amber-100">
									{n.status === "collected"
										? `Recouvré : ${formatZeni(n.collected)}`
										: `Avis de ${formatZeni(n.amount)} · taux ${Math.round(n.rate * 100)} %`}
								</span>
							</li>
						))}
					</ul>
					<p className="mt-2 text-xs text-amber-100/60">
						Un avis porte uniquement sur des gains signalés comme anormaux. Contestation : ticket au staff.
					</p>
				</section>
			)}

			{/* ── Repères canon ────────────────────────────────────────────── */}
			{canon.length > 0 && (
				<section aria-labelledby="canon-prices-title" className={`${surface} p-5`}>
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2 id="canon-prices-title" className="font-saiyan text-xl text-white">
							Ce que valent les zénis dans l&apos;univers
						</h2>
						{economy?.parity && (
							<a
								href={economy.parity.source.url}
								className="text-xs text-white/50 underline-offset-4 hover:text-dbz-yellow hover:underline"
							>
								1 Ƶ ≈ 1 yen, selon Toriyama
							</a>
						)}
					</div>
					<ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						{canon
							.filter((p) => ["taxi", "capsule", "house", "aircar"].includes(p.key))
							.map((p) => (
								<li key={p.key}>
									<a
										href={p.source.url}
										className="block h-full rounded-xl border border-white/10 bg-black/25 p-3 transition-colors hover:border-dbz-yellow"
									>
										<span className="block font-saiyan text-lg text-dbz-yellow">{formatZeni(p.zeni)}</span>
										<span className="block text-xs text-white/65">{p.label}</span>
										<span className="mt-1 block text-[10px] text-white/35">{p.source.title}</span>
									</a>
								</li>
							))}
					</ul>
				</section>
			)}

			{/* ── Aperçu en direct ─────────────────────────────────────────── */}
			{selected && (
				<section className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]" aria-labelledby="shop-preview-title">
					<div className={`${surface} p-5 md:p-7`}>
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-[10px] uppercase tracking-[.2em] text-dbz-orange">Aperçu en direct</p>
								<h2 id="shop-preview-title" className="mt-1 font-saiyan text-2xl text-white">
									{selected.type === "card"
										? "Rendu du thème de carte"
										: selected.type === "banner"
											? "Rendu de la bannière"
											: selected.type === "title"
												? "Rendu du titre de profil"
												: selected.type === "badge"
													? "Rendu du badge d'emblème"
													: "Rendu dans le chat"}
								</h2>
							</div>
							<span className="rounded-xl border border-white/10 px-3 py-1 text-[10px] uppercase tracking-wider text-white/45">
								{TYPE_LABELS[selected.type]}
							</span>
						</div>

						{/* Aperçu dynamique adapté au type d'article */}
						{selected.type === "card" && (
							<div className="mt-6 overflow-hidden rounded-xl border border-white/15 bg-black p-4">
								<div className="relative aspect-[1000/360] w-full overflow-hidden rounded-lg border border-white/10">
									{selected.preview ? (
										<img
											src={selected.preview}
											alt=""
											className="h-full w-full object-cover"
										/>
									) : (
										<div className="h-full w-full bg-gradient-to-r from-[#201505] to-[#0a0a0c]" />
									)}
									<div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
									<div className="absolute inset-y-0 left-4 flex items-center gap-4">
										<div
											className="h-14 w-14 sm:h-16 sm:w-16 rounded-full border-2 bg-black/60 flex items-center justify-center font-saiyan text-2xl text-white"
											style={{ borderColor: (selected.meta?.accent as string) || "#f59e0b" }}
										>
											悟
										</div>
										<div>
											<p className="text-sm sm:text-base font-bold text-white">Son Goku</p>
											<p className="text-[11px] sm:text-xs text-dbz-yellow font-scouter">NIVEAU 42 · 1 480 000 Ƶ</p>
											<span
												className="mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase"
												style={{
													background: `${(selected.meta?.accent as string) || "#f59e0b"}33`,
													color: (selected.meta?.accent as string) || "#f59e0b",
												}}
											>
												{selected.name}
											</span>
										</div>
									</div>
								</div>
							</div>
						)}

						{selected.type === "banner" && (
							<div className="mt-6 overflow-hidden rounded-xl border border-white/15 bg-black">
								{selected.preview ? (
									<img
										src={selected.preview}
										alt=""
										className="aspect-[3/1] w-full object-cover"
									/>
								) : (
									<div className="aspect-[3/1] flex items-center justify-center text-zinc-500">
										Bannière
									</div>
								)}
							</div>
						)}

						{selected.type === "badge" && (
							<div className="mt-6 rounded-xl border border-fuchsia-500/30 bg-[#0d0c0b] p-6 flex flex-col items-center justify-center text-center">
								{selected.preview ? (
									<img src={selected.preview} alt="" className="h-20 w-20 object-contain drop-shadow" />
								) : (
									<span className="font-saiyan text-5xl text-fuchsia-400">章</span>
								)}
								<p className="mt-3 font-semibold text-white">{selected.name}</p>
								<p className="text-xs text-zinc-400 mt-1">
									Insigne officiel affiché sur ta carte de profil et ton identifiant de membre.
								</p>
							</div>
						)}

						{selected.type === "title" && (
							<div className="mt-6 rounded-xl border border-purple-500/30 bg-[#0d0c0b] p-6 text-center">
								<p className="text-[10px] uppercase tracking-widest text-purple-400 font-mono">
									Titre honorifique équipé sur ta carte
								</p>
								<p className="mt-2 font-serif italic text-xl font-bold text-amber-300">
									« {selected.name} »
								</p>
								<p className="mt-3 text-xs text-zinc-400">
									Apparaît directement au-dessus de ton pseudo sur ta carte officielle de joueur.
								</p>
							</div>
						)}

						{selected.type === "color" && (
							<div className="mt-6 rounded-xl border bg-[#0d0c0b] p-4" style={{ borderColor: `${selectedColor}55` }}>
								<div className="flex items-center gap-3">
									<div className="h-10 w-10 rounded-full border border-white/20 bg-gradient-to-br from-dbz-orange to-dbz-yellow" />
									<div>
										<p className="font-semibold" style={{ color: selectedColor }}>
											Son Goku <span className="text-white/40">· Niv. 42</span>
										</p>
										<p className="text-[10px] uppercase tracking-wider text-white/35">
											Dragon Ball France · maintenant
										</p>
									</div>
								</div>
								<p className="mt-4 rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm text-white/80">
									Voici le style de ton message avec{" "}
									<strong style={{ color: selectedColor }}>{selected.name}</strong>.
								</p>
							</div>
						)}
					</div>
					<div className={`${surface} p-5 md:p-7`}>
						<p className="text-[10px] uppercase tracking-[.2em] text-dbz-orange">Sélection</p>
						<h2 className="mt-1 font-saiyan text-2xl text-white">{selected.name}</h2>
						<p className="mt-3 text-sm leading-6 text-white/55">
							{selected.description || "Objet cosmétique de la communauté DBFR."}
						</p>
						<PriceBlock item={selected} canon={canon} large />
					</div>
				</section>
			)}

			{/* ── Filtres ──────────────────────────────────────────────────── */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div tabIndex={0} className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer la boutique" onKeyDown={onTablistKeyDown}>
					{(["all", ...TYPE_ORDER] as const).map((type) => (
						<button
							key={type}
							type="button"
							role="tab"
							aria-selected={filter === type}
							tabIndex={filter === type ? 0 : -1}
							onClick={() => setFilter(type)}
							className={`cible-44 inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
								filter === type
									? "border-dbz-yellow bg-dbz-yellow/15 text-dbz-yellow"
									: "border-white/10 text-white/55 hover:border-dbz-yellow/60 hover:text-white"
							}`}
						>
							{type !== "all" && (
								<span aria-hidden className="font-saiyan text-[11px] opacity-70">
									{TYPE_KANJI[type]}
								</span>
							)}
							{type === "all" ? "Tout" : TYPE_LABELS[type]}
						</button>
					))}
				</div>
				<label className="sr-only" htmlFor="shop-search">
					Rechercher un article
				</label>
				<input
					id="shop-search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Rechercher un article…"
					className="h-10 rounded-xl border border-white/10 bg-[#151412] px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-dbz-yellow sm:w-64"
				/>
			</div>
			{visibleItems.length === 0 && (
				<div className="rounded-xl border border-dashed border-white/15 bg-[#151412] p-10 text-center text-sm text-white/50">
					Aucun article ne correspond à ta recherche.
				</div>
			)}

			{/* ── Catalogue ────────────────────────────────────────────────── */}
			{TYPE_ORDER.filter((t) => grouped[t]?.length).map((type) => (
				<section key={type} aria-labelledby={`shop-${type}`}>
					<h2
						id={`shop-${type}`}
						className="mb-5 flex items-center gap-2 border-b border-white/10 pb-2 font-saiyan text-2xl uppercase text-dbz-orange"
					>
						<span aria-hidden className="text-dbz-yellow/70">
							{TYPE_KANJI[type]}
						</span>
						{TYPE_LABELS[type]}s ({grouped[type]!.length})
					</h2>
					<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{grouped[type]!.map((it) => {
							const isOwned = owns(it);
							const isEquipped = equipped(it);
							const canAfford = (state?.balance ?? 0) >= priceOf(it);
							const isBusy = busy === it.key;
							const f = flash?.key === it.key ? flash : null;
							return (
								<article
									key={it.key}
									className={`group flex flex-col overflow-hidden rounded-xl border bg-[#151412] transition-colors hover:border-dbz-yellow ${
										selected?.key === it.key ? "border-dbz-yellow/70" : "border-white/10"
									}`}
								>
									{/* L'aperçu est le point d'entrée clavier de la sélection. */}
									<button
										type="button"
										onClick={() => setSelectedKey(it.key)}
										aria-pressed={selected?.key === it.key}
										aria-label={`Prévisualiser ${it.name}`}
										className="block w-full text-left"
									>
										<ItemPreview item={it} />
									</button>
									<div className="flex flex-1 flex-col p-4">
										<h3 className="text-base font-bold leading-tight text-white">{it.name}</h3>
										{it.description && (
											<p className="mt-1 line-clamp-2 text-xs text-white/50">{it.description}</p>
										)}
										<PriceBlock item={it} canon={canon} />
										<div className="mt-auto pt-3">
											{loggedIn !== true ? (
												<div className="rounded-xl border border-white/10 p-2 text-center text-[11px] text-white/50">
													{loggedIn === null && soldeIndisponible ? "Achat indisponible" : "Connexion requise"}
												</div>
											) : isEquipped ? (
												// Un objet équipé restait figé sur un badge « Équipé » : impossible
												// de revenir en arrière (vécu sur les bannières). Le badge est un
												// bouton de retrait, l'état « équipé » reste lisible.
												<button
													type="button"
													disabled={isBusy}
													onClick={() => void unequip(it)}
													aria-label={`Retirer ${it.name}`}
													className="group/eq flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-2 text-sm font-bold text-emerald-300 transition-colors hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
												>
													{isBusy ? (
														<Chargement className="h-4 w-4 animate-spin" />
													) : (
														<>
															<Coche className="h-4 w-4 group-hover/eq:hidden" />
															<span className="group-hover/eq:hidden">Équipé</span>
															<span className="hidden group-hover/eq:inline">Retirer</span>
														</>
													)}
												</button>
											) : isOwned ? (
												<button
													type="button"
													disabled={isBusy}
													onClick={() => void equip(it)}
													className="dbz-button w-full justify-center disabled:opacity-50"
												>
													{isBusy ? <Chargement className="h-4 w-4 animate-spin" /> : "Équiper"}
												</button>
											) : (
												<button
													type="button"
													disabled={isBusy || !canAfford}
													onClick={() => void buy(it)}
													className="dbz-button w-full justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
												>
													{isBusy ? (
														<Chargement className="h-4 w-4 animate-spin" />
													) : (
														<>
															<Sac className="h-4 w-4" />
															{canAfford ? "Acheter" : "Solde insuffisant"}
														</>
													)}
												</button>
											)}
											{f && (
												<p
													role="status"
													className={`mt-1.5 text-center text-[11px] ${f.ok ? "text-emerald-300" : "text-red-300"}`}
												>
													{f.msg}
												</p>
											)}
										</div>
									</div>
								</article>
							);
						})}
					</div>
				</section>
			))}
		</div>
	);
}

/** Prix du jour, prix de base barré s'il a bougé, et repère canon. */
function PriceBlock({ item, canon, large = false }: { item: ShopItem; canon: readonly CanonPrice[]; large?: boolean }) {
	const price = priceOf(item);
	const moved = price !== item.price;
	const eq = canonEquivalent(price, canon);
	return (
		<div className={`mt-3 border-t border-white/10 pt-3 ${large ? "mt-6 pt-4" : ""}`}>
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-[10px] uppercase tracking-wider text-white/40">Prix du jour</span>
				<span className="text-right">
					{moved && <s className="mr-2 text-xs text-white/35">{formatZeni(item.price)}</s>}
					<strong className={`font-saiyan text-dbz-yellow ${large ? "text-3xl" : "text-xl"}`}>{formatZeni(price)}</strong>
				</span>
			</div>
			{eq && (
				<p className="mt-1 text-right text-[11px] text-white/40">
					≈ {nf.format(eq.times)} × {eq.price.label}
				</p>
			)}
		</div>
	);
}

/** Aperçu « exemple si achat » selon le type d'article. */
function ItemPreview({ item }: { item: ShopItem }) {
	// 1. Badge : l'emblème vectoriel seul, centré
	if (item.type === "badge") {
		return (
			<div className="flex aspect-[16/9] items-center justify-center border-b border-white/10 bg-gradient-to-b from-fuchsia-950/20 to-black/60 p-3">
				{item.preview ? (
					<img
						src={item.preview}
						alt={item.name}
						loading="lazy"
						className="h-20 w-20 object-contain transition-transform duration-300 group-hover:scale-110 drop-shadow"
					/>
				) : (
					<span className="font-saiyan text-4xl text-fuchsia-400">
						{item.name.match(/[\u3400-\u9FFF]/)?.[0] ?? "章"}
					</span>
				)}
			</div>
		);
	}

	// 2. Thème de carte de profil : aperçu de fond + pastille thème
	if (item.type === "card") {
		const accent = (item.meta?.accent as string) || "#F3E603";
		return (
			<div className="relative aspect-[16/9] overflow-hidden border-b border-white/10 bg-black">
				{item.preview ? (
					<img
						src={item.preview}
						alt={item.name}
						loading="lazy"
						className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
					/>
				) : (
					<div
						className="h-full w-full"
						style={{ background: `linear-gradient(135deg, ${accent}44, #0d0d10)` }}
					/>
				)}
				<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
				<div className="absolute bottom-2 left-2 flex items-center gap-2">
					<div
						className="h-7 w-7 rounded-full border bg-black/60 flex items-center justify-center text-xs font-bold"
						style={{ borderColor: accent, color: accent }}
					>
						札
					</div>
					<div>
						<div className="text-[11px] font-bold text-white leading-tight">{item.name}</div>
						<div className="text-[9px] text-white/50">Thème de carte</div>
					</div>
				</div>
				<span
					className="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black"
					style={{ background: accent }}
				>
					Thème
				</span>
			</div>
		);
	}

	// 3. Titre honorifique : plaque de titre stylisée
	if (item.type === "title") {
		return (
			<div className="relative flex aspect-[16/9] flex-col items-center justify-center border-b border-white/10 bg-gradient-to-br from-[#1a140f] via-black to-[#0e0c0a] p-4 text-center">
				<span className="text-[9px] uppercase tracking-[.25em] text-purple-400 font-mono">
					Titre de Guerrier
				</span>
				<span className="mt-1.5 font-serif italic text-sm font-bold text-amber-200 line-clamp-2 px-2">
					« {item.name} »
				</span>
				<span className="absolute bottom-2 right-2 text-[10px] font-saiyan text-purple-400/50">
					号
				</span>
			</div>
		);
	}

	// 4. Bannière
	if (item.preview) {
		return (
			<div className="relative aspect-[16/9] overflow-hidden border-b border-white/10 bg-black">
				<img
					src={item.preview}
					alt={item.name}
					loading="lazy"
					className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
				<div className="absolute bottom-2 left-2 flex items-center gap-2">
					<div className="h-8 w-8 rounded-full border border-white/70 bg-white/20" />
					<div>
						<div className="h-2 w-16 rounded bg-white/70" />
						<div className="mt-1 h-1.5 w-10 rounded bg-dbz-yellow/80" />
					</div>
				</div>
				<span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
					Bannière
				</span>
			</div>
		);
	}

	// 5. Couleur
	if (item.type === "color") {
		return (
			<div
				className="flex aspect-[16/9] items-center justify-center border-b border-white/10"
				style={{ background: item.roleColor ?? "#7c3aed" }}
			>
				<span className="rounded bg-black/40 px-2 py-1 text-xs font-bold uppercase tracking-widest text-white">
					{item.roleColor ?? "Couleur de pseudo"}
				</span>
			</div>
		);
	}

	return (
		<div className="flex aspect-[16/9] items-center justify-center gap-2 border-b border-white/10 bg-black/40">
			<span aria-hidden className="font-saiyan text-2xl" style={{ color: item.roleColor ?? "#f5b52e" }}>
				{TYPE_KANJI[item.type]}
			</span>
			<span
				className="rounded-xl border px-3 py-1 text-sm font-bold"
				style={{ borderColor: item.roleColor ?? "#f5b52e", color: item.roleColor ?? "#f5b52e" }}
			>
				{item.name}
			</span>
		</div>
	);
}

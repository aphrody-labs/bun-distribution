"use client";

/**
 * Palette de recherche ⌘K — le contenu lourd, chargé à la demande.
 *
 * Séparée de son déclencheur (`CommandMenu`) parce qu'elle vivait dans la nav,
 * donc dans le socle JS de TOUTES les pages : `cmdk` et les douze groupes de
 * résultats étaient téléchargés par chaque visiteur, y compris ceux qui
 * n'ouvriront jamais la recherche. Ici, le module n'est demandé qu'au premier
 * survol ou à la première ouverture du bouton.
 *
 * Les résultats viennent déjà filtrés et rankés par Postgres (pg_trgm) → on coupe
 * le filtrage interne de cmdk (`shouldFilter={false}`) pour ne rien re-masquer.
 *
 * Client-only : utilise `@/lib/assets` (jamais db-universe, server-only) pour les
 * vignettes ; `SearchResults` est recopié localement pour la même raison.
 */
import { assetUrl } from "@/lib/assets";
import { DragonBallLoader } from "@/components/DragonBall";
import { DragonRadar } from "@/components/icones";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { track } from "@/lib/telemetry";
import { useCallback, useEffect, useRef, useState } from "react";

// Miroir client de la forme renvoyée par `/api/search` (= `SearchResults` de
// db-universe). Défini localement pour ne pas importer le module server-only
// (postgres) dans le bundle client, même en `import type`.
type SearchResults = {
	q: string;
	characters: Array<{
		id: number;
		name: string;
		name_ja: string | null;
		image: string | null;
		race: string | null;
	}>;
	planets: Array<{
		id: number;
		name: string;
		name_ja: string | null;
		image: string | null;
	}>;
	sagas: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		series: string | null;
	}>;
	movies: Array<{
		id: number;
		slug: string;
		title: string;
		title_ja: string | null;
		series: string | null;
	}>;
	games: Array<{
		id: number;
		slug: string;
		title: string;
		title_ja: string | null;
	}>;
	episodes: Array<{
		id: number;
		series: string;
		number_in_series: number;
		title: string;
		image: string | null;
	}>;
	techniques: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		type: string | null;
	}>;
	races: Array<{ id: number; slug: string; name: string; name_ja: string | null }>;
	transformations: Array<{ id: number; name: string; image: string | null; character_id: number }>;
	arcs: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		saga_slug: string | null;
	}>;
	mangaVolumes: Array<{
		id: number;
		series: string;
		volume_number: number | null;
		title: string | null;
		cover: string | null;
	}>;
	mangaChapters: Array<{
		id: number;
		series: string;
		chapter_number: number | null;
		title: string | null;
	}>;
	battles: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		saga: string;
	}>;
	locations: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		realm_type: string;
		image: string | null;
	}>;
	tournaments: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		saga: string;
	}>;
	voiceActors: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		nationality: string;
	}>;
	soundtracks: Array<{
		id: number;
		slug: string;
		title: string;
		title_ja: string | null;
		track_type: string;
		series: string;
	}>;
	powerLevels: Array<{
		id: number;
		character_name: string;
		battle_or_context: string | null;
		power_value_formatted: string;
	}>;
	items: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		category: string;
		image: string | null;
	}>;
	dragons: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		creator: string | null;
		image: string | null;
	}>;
	contributors?: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		category: string;
	}>;
	sources: Array<{ url: string; kind: string; title: string; excerpt: string; httpStatus: number }>;
};

const EMPTY: SearchResults = {
	q: "",
	characters: [],
	planets: [],
	sagas: [],
	movies: [],
	games: [],
	episodes: [],
	techniques: [],
	races: [],
	transformations: [],
	arcs: [],
	mangaVolumes: [],
	mangaChapters: [],
	battles: [],
	locations: [],
	tournaments: [],
	voiceActors: [],
	soundtracks: [],
	powerLevels: [],
	items: [],
	dragons: [],
	contributors: [],
	sources: [],
};

function count(r: SearchResults): number {
	return (
		r.characters.length +
		r.planets.length +
		r.sagas.length +
		r.movies.length +
		r.games.length +
		r.episodes.length +
		r.techniques.length +
		r.races.length +
		r.transformations.length +
		r.arcs.length +
		r.mangaVolumes.length +
		r.mangaChapters.length +
		r.battles.length +
		r.locations.length +
		r.tournaments.length +
		r.voiceActors.length +
		r.soundtracks.length +
		r.powerLevels.length +
		r.items.length +
		r.dragons.length +
		(r.contributors?.length ?? 0) +
		r.sources.length
	);
}

export default function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const router = useRouter();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResults>(EMPTY);
	const [loading, setLoading] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Recherche debouncée ; annule la requête en vol à chaque frappe.
	useEffect(() => {
		const term = query.trim();
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (term.length < 2) {
			abortRef.current?.abort();
			setResults(EMPTY);
			setLoading(false);
			return;
		}
		setLoading(true);
		debounceRef.current = setTimeout(async () => {
			abortRef.current?.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
					signal: ctrl.signal,
				});
				if (!res.ok) throw new Error(String(res.status));
				// Aucun filtrage ici : `/api/search` ne renvoie déjà que les catégories
				// dont la route détail est publique (il lit la même config d'accès que
				// le proxy). La liste en dur qui vivait ici — héritée de la bêta, 4
				// catégories sur 12 — restait fausse à chaque ouverture de rubrique.
				const recus = (await res.json()) as SearchResults;
				setResults(recus);
				// Ce que les gens cherchent est le signal le plus utile du site :
				// une recherche sans résultat désigne un contenu qui manque, une
				// recherche fréquente désigne un contenu à mettre en avant. Le
				// type `search` était déclaré depuis le début et n'était émis
				// nulle part.
				track("search", { query: term, resultCount: count(recus) });
			} catch (e) {
				if ((e as Error).name !== "AbortError") setResults(EMPTY);
			} finally {
				if (!ctrl.signal.aborted) setLoading(false);
			}
		}, 180);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query]);

	const go = useCallback(
		(href: string) => {
			onOpenChange(false);
			setQuery("");
			setResults(EMPTY);
			router.push(href);
		},
		[router, onOpenChange]
	);

	const total = count(results);
	const term = query.trim();

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label="Recherche Dragon Ball"
			shouldFilter={false}
			loop
			overlayClassName="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
			contentClassName="fixed left-1/2 top-[12vh] z-[101] w-[92vw] max-w-2xl -translate-x-1/2 overflow-hidden rounded-2xl border border-dbz-border bg-dbz-card/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
		>
			<div className="flex items-center gap-3 border-b border-dbz-border px-4">
				<DragonRadar size={20} className="text-dbz-orange/70 shrink-0" />
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder="Un personnage, une saga, une technique, un épisode…"
					className="h-14 w-full bg-transparent text-white placeholder:text-white/50 font-display text-base outline-none"
				/>
				{loading && (
					<span className="shrink-0">
						<DragonBallLoader size={18} stars={4} decorative />
					</span>
				)}
			</div>

			<Command.List className="max-h-[60vh] overflow-y-auto overscroll-contain p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-display [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-white/50">
				{term.length >= 2 && !loading && total === 0 && (
					<Command.Empty className="px-3 py-10 text-center text-sm text-white/50">
						Aucune énergie détectée pour «&nbsp;
						<span className="text-dbz-orange">{term}</span>&nbsp;».
					</Command.Empty>
				)}
				{term.length < 2 && (
					<p className="px-3 py-10 text-center text-sm text-white/50">
						Tape au moins 2 caractères pour scanner l'univers.
					</p>
				)}

				{results.characters.length > 0 && (
					<Command.Group heading="Personnages">
						{results.characters.map((c) => (
							<Item
								key={`char-${c.id}`}
								value={`char-${c.id}-${c.name}`}
								onSelect={() => go(`/wiki/personnages/${c.id}`)}
								image={c.image}
								title={c.name}
								subtitle={c.name_ja ?? c.race ?? undefined}
								kind="Guerrier"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.planets.length > 0 && (
					<Command.Group heading="Lieux">
						{results.planets.map((p) => (
							<Item
								key={`planet-${p.id}`}
								value={`planet-${p.id}-${p.name}`}
								onSelect={() => go("/wiki/lieux")}
								image={p.image}
								title={p.name}
								subtitle={p.name_ja ?? undefined}
								kind="Lieu"
								accent="blue"
							/>
						))}
					</Command.Group>
				)}

				{results.sagas.length > 0 && (
					<Command.Group heading="Sagas">
						{results.sagas.map((s) => (
							<Item
								key={`saga-${s.id}`}
								value={`saga-${s.id}-${s.name}`}
								onSelect={() => go(`/wiki/sagas/${s.slug}`)}
								title={s.name}
								subtitle={s.series ?? undefined}
								kind="Saga"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.movies.length > 0 && (
					<Command.Group heading="Films">
						{results.movies.map((m) => (
							<Item
								key={`movie-${m.id}`}
								value={`movie-${m.id}-${m.title}`}
								onSelect={() => go(`/wiki/films/${m.slug}`)}
								title={m.title}
								subtitle={m.title_ja ?? m.series ?? undefined}
								kind="Film"
								accent="red"
							/>
						))}
					</Command.Group>
				)}

				{results.games.length > 0 && (
					<Command.Group heading="Jeux">
						{results.games.map((g) => (
							<Item
								key={`game-${g.id}`}
								value={`game-${g.id}-${g.title}`}
								onSelect={() => go(`/wiki/jeux/${g.slug}`)}
								title={g.title}
								subtitle={g.title_ja ?? undefined}
								kind="Jeu"
								accent="blue"
							/>
						))}
					</Command.Group>
				)}

				{results.episodes.length > 0 && (
					<Command.Group heading="Épisodes">
						{results.episodes.map((e) => (
							<Item
								key={`ep-${e.id}`}
								value={`ep-${e.id}-${e.title}`}
								onSelect={() => go(`/wiki/episodes/${e.id}`)}
								image={e.image}
								title={e.title}
								subtitle={`${e.series} · épisode ${e.number_in_series}`}
								kind="Épisode"
								accent="blue"
							/>
						))}
					</Command.Group>
				)}

				{results.techniques.length > 0 && (
					<Command.Group heading="Techniques">
						{results.techniques.map((t) => (
							<Item
								key={`tech-${t.id}`}
								value={`tech-${t.id}-${t.name}`}
								onSelect={() => go(`/wiki/techniques/${t.slug}`)}
								title={t.name}
								subtitle={t.name_ja ?? t.type ?? undefined}
								kind="Technique"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.races.length > 0 && (
					<Command.Group heading="Races">
						{results.races.map((r) => (
							<Item
								key={`race-${r.id}`}
								value={`race-${r.id}-${r.name}`}
								onSelect={() => go(`/wiki/races/${r.slug}`)}
								title={r.name}
								subtitle={r.name_ja ?? undefined}
								kind="Race"
								accent="purple"
							/>
						))}
					</Command.Group>
				)}

				{results.transformations.length > 0 && (
					<Command.Group heading="Transformations">
						{results.transformations.map((t) => (
							<Item
								key={`transfo-${t.id}`}
								value={`transfo-${t.id}-${t.name}`}
								onSelect={() => go(`/wiki/personnages/${t.character_id}`)}
								image={t.image}
								title={t.name}
								kind="Transfo"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.arcs.length > 0 && (
					<Command.Group heading="Arcs">
						{results.arcs.map((a) => (
							<Item
								key={`arc-${a.id}`}
								value={`arc-${a.id}-${a.name}`}
								onSelect={() => go(`/wiki/arcs/${a.slug}`)}
								title={a.name}
								subtitle={a.name_ja ?? undefined}
								kind="Arc"
								accent="red"
							/>
						))}
					</Command.Group>
				)}

				{results.mangaVolumes.length > 0 && (
					<Command.Group heading="Tomes (manga)">
						{results.mangaVolumes.map((v) => (
							<Item
								key={`vol-${v.id}`}
								value={`vol-${v.id}-${v.title ?? v.volume_number}`}
								onSelect={() => go(`/wiki/manga/volume/${v.id}`)}
								image={v.cover}
								title={v.title ? `Tome ${v.volume_number} — ${v.title}` : `Tome ${v.volume_number}`}
								subtitle={v.series}
								kind="Tome"
								accent="blue"
							/>
						))}
					</Command.Group>
				)}

				{results.mangaChapters.length > 0 && (
					<Command.Group heading="Chapitres (manga)">
						{results.mangaChapters.map((c) => (
							<Item
								key={`chap-${c.id}`}
								value={`chap-${c.id}-${c.title ?? c.chapter_number}`}
								onSelect={() => go(`/wiki/manga/${c.id}`)}
								title={
									c.title
										? `Chapitre ${c.chapter_number} — ${c.title}`
										: `Chapitre ${c.chapter_number}`
								}
								subtitle={c.series}
								kind="Chapitre"
								accent="blue"
							/>
						))}
					</Command.Group>
				)}

				{results.battles.length > 0 && (
					<Command.Group heading="Combats Légendaires">
						{results.battles.map((b) => (
							<Item
								key={`battle-${b.id}`}
								value={`battle-${b.id}-${b.name}`}
								onSelect={() => go(`/wiki/combats/${b.slug}`)}
								title={b.name}
								subtitle={b.name_ja ?? b.saga ?? undefined}
								kind="Combat"
								accent="red"
							/>
						))}
					</Command.Group>
				)}

				{results.locations.length > 0 && (
					<Command.Group heading="Lieux & Sanctuaires">
						{results.locations.map((l) => (
							<Item
								key={`loc-${l.id}`}
								value={`loc-${l.id}-${l.name}`}
								onSelect={() => go(`/wiki/lieux/${l.slug}`)}
								image={l.image}
								title={l.name}
								subtitle={l.name_ja ?? l.realm_type ?? undefined}
								kind="Lieu"
								accent="green"
							/>
						))}
					</Command.Group>
				)}

				{results.tournaments.length > 0 && (
					<Command.Group heading="Tournois d'Arts Martiaux">
						{results.tournaments.map((t) => (
							<Item
								key={`tourn-${t.id}`}
								value={`tourn-${t.id}-${t.name}`}
								onSelect={() => go(`/wiki/tournois/${t.slug}`)}
								title={t.name}
								subtitle={t.name_ja ?? t.saga ?? undefined}
								kind="Tournoi"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.voiceActors.length > 0 && (
					<Command.Group heading="Casting & Voix (Seiyū & VF)">
						{results.voiceActors.map((va) => (
							<Item
								key={`va-${va.id}`}
								value={`va-${va.id}-${va.name}`}
								onSelect={() => go(`/wiki/voix/${va.slug}`)}
								title={va.name}
								subtitle={va.name_ja ?? (va.nationality === "ja" ? "Seiyū (VO)" : "Doublage Français (VF)")}
								kind="Voix"
								accent="purple"
							/>
						))}
					</Command.Group>
				)}

				{results.contributors && results.contributors.length > 0 && (
					<Command.Group heading="Staff & Créateurs">
						{results.contributors.map((c) => (
							<Item
								key={`contrib-${c.id}`}
								value={`contrib-${c.id}-${c.name}`}
								onSelect={() =>
									go(c.slug === "akira-toriyama" ? "/wiki/toriyama" : `/wiki/contributeurs/${c.slug}`)
								}
								title={c.name}
								subtitle={c.name_ja ? `${c.name_ja} · ${c.category}` : c.category}
								kind="Staff"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.soundtracks.length > 0 && (
					<Command.Group heading="Musiques & Bandes Originales">
						{results.soundtracks.map((s) => (
							<Item
								key={`ost-${s.id}`}
								value={`ost-${s.id}-${s.title}`}
								onSelect={() => go(`/wiki/musiques`)}
								title={s.title}
								subtitle={s.title_ja ?? s.series ?? undefined}
								kind="OST"
								accent="blue"
							/>
						))}
					</Command.Group>
				)}

				{results.powerLevels.length > 0 && (
					<Command.Group heading="Niveaux de Puissance (Scouter)">
						{results.powerLevels.map((p) => (
							<Item
								key={`pl-${p.id}`}
								value={`pl-${p.id}-${p.character_name}-${p.battle_or_context ?? ""}`}
								onSelect={() => go(`/wiki/puissances`)}
								title={`${p.character_name} : ${p.power_value_formatted}`}
								subtitle={p.battle_or_context || undefined}
								kind="Scouter"
								accent="red"
							/>
						))}
					</Command.Group>
				)}

				{results.items.length > 0 && (
					<Command.Group heading="Objets & Technologies">
						{results.items.map((i) => (
							<Item
								key={`item-${i.id}`}
								value={`item-${i.id}-${i.name}`}
								onSelect={() => go(`/wiki/objets/${i.slug}`)}
								image={i.image}
								title={i.name}
								subtitle={i.name_ja ?? i.category ?? undefined}
								kind="Objet"
								accent="green"
							/>
						))}
					</Command.Group>
				)}

				{results.dragons.length > 0 && (
					<Command.Group heading="Dragons Sacrés">
						{results.dragons.map((d) => (
							<Item
								key={`dragon-${d.id}`}
								value={`dragon-${d.id}-${d.name}`}
								onSelect={() => go(`/wiki/dragons#${d.slug}`)}
								image={d.image}
								title={d.name}
								subtitle={d.name_ja ?? (d.creator ? `Créé par ${d.creator}` : undefined)}
								kind="Dragon"
								accent="orange"
							/>
						))}
					</Command.Group>
				)}

				{results.sources.length > 0 && (
					<Command.Group heading="Sources BXC — toutes classifications">
						{results.sources.map((source) => (
							<Item
								key={`source-${source.url}`}
								value={`source-${source.url}-${source.title}`}
								onSelect={() => go(`/sources/dragon-ball?q=${encodeURIComponent(term)}`)}
								title={source.title}
								subtitle={`${source.kind} · HTTP ${source.httpStatus}`}
								kind="BXC"
								accent="purple"
							/>
						))}
					</Command.Group>
				)}

				{/* Sortie vers la recherche complète : la palette plafonne chaque
				    groupe, la page ne plafonne pas. Rendu dès qu'un terme est saisi,
				    y compris sans résultat — c'est là qu'on a le plus besoin d'aller
				    voir plus large. */}
				{term.length >= 2 && (
					<Command.Group heading="Aller plus loin">
						<Item
							value={`tous-${term}`}
							onSelect={() => go(`/wiki/search?q=${encodeURIComponent(term)}`)}
							title={`Voir tous les résultats pour « ${term} »`}
							kind="Recherche"
							accent="orange"
						/>
						<Item
							value={`ask-${term}`}
							onSelect={() => go(`/ask?q=${encodeURIComponent(term)}`)}
							title={`Poser la question à l'assistant`}
							subtitle="Réponse rédigée et sourcée sur le wiki"
							kind="Assistant"
							accent="purple"
						/>
					</Command.Group>
				)}
			</Command.List>
		</Command.Dialog>
	);
}

const ACCENT = {
	orange: "group-data-[selected=true]:text-dbz-orange",
	blue: "group-data-[selected=true]:text-dbz-blue-light",
	red: "group-data-[selected=true]:text-dbz-red",
	purple: "group-data-[selected=true]:text-purple-400",
	green: "group-data-[selected=true]:text-emerald-400",
} as const;

function Item({
	value,
	onSelect,
	image,
	title,
	subtitle,
	kind,
	accent,
}: {
	value: string;
	onSelect: () => void;
	image?: string | null;
	title: string;
	subtitle?: string;
	kind: string;
	accent: keyof typeof ACCENT;
}) {
	return (
		<Command.Item
			value={value}
			onSelect={onSelect}
			className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 data-[selected=true]:bg-white/[0.06]"
		>
			<span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-dbz-bg ring-1 ring-white/10">
				{image ? (
					<img
						src={assetUrl(image)}
						alt=""
						className="h-full w-full object-cover object-top"
						loading="lazy"
					/>
				) : (
					<span className="font-saiyan text-xs text-white/25">{title.charAt(0)}</span>
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-display text-sm font-medium text-white/90">
					{title}
				</span>
				{subtitle && (
					<span className="block truncate font-display text-[11px] text-white/50">{subtitle}</span>
				)}
			</span>
			<span
				className={`shrink-0 font-display text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 transition-colors ${ACCENT[accent]}`}
			>
				{kind}
			</span>
		</Command.Item>
	);
}

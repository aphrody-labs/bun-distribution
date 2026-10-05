import Link from "next/link";
import type { Metadata } from "next";
import { Cadenas, FlecheDroite } from "@/components/icones";
import { effectiveOpenKeys, LAUNCH_CATEGORIES } from "@/lib/wiki-launch";
import { getOpenCategoryKeys } from "@/lib/wiki-launch-config";

/** Kanji décoratif par catégorie (repli vide pour les nouvelles ouvertures). */
const KANJI: Record<string, string> = {
	episodes: "話",
	films: "映画",
	manga: "漫画",
	chronologie: "年表",
	personnages: "人物",
	planetes: "惑星",
	sagas: "編",
	races: "種族",
	techniques: "技",
	transformations: "変身",
	arcs: "章",
	jeux: "遊",
	databooks: "資料",
};

// Écran « section fermée » servi *à l'URL d'origine* (via rewrite du
// proxy) pour les sections wiki/tierlists encore gated en bêta — au lieu de
// renvoyer silencieusement le visiteur sur la home. Jamais indexable.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Section fermée",
	robots: { index: false, follow: true },
};

// Libellé lisible d'une section à partir de son chemin (plus long préfixe).
const SECTION_LABELS: Record<string, string> = {
	"/wiki/personnages": "les personnages",
	"/wiki/lieux": "les lieux",
	"/wiki/sagas": "les sagas",
	"/wiki/races": "les races",
	"/wiki/transformations": "les transformations",
	"/wiki/techniques": "les techniques",
	"/wiki/jeux": "les jeux vidéo",
	"/wiki/search": "la recherche du wiki",
	"/wiki": "cette partie du wiki",
	"/tierlists": "les tier lists",
};

function labelFor(from: string): string {
	const match = Object.keys(SECTION_LABELS)
		.filter((p) => from === p || from.startsWith(p + "/") || from.startsWith(p))
		.toSorted((a, b) => b.length - a.length)[0];
	return match ? SECTION_LABELS[match] : "cette section";
}

// Sections déjà ouvertes au public (miroir de WIKI_OPEN dans proxy.ts).
export default async function WikiComingSoonPage({
	searchParams,
}: {
	searchParams: Promise<{ from?: string }>;
}) {
	const { from = "" } = await searchParams;
	// Sections déjà ouvertes = source unique (config DB), plus de liste en dur.
	const open = effectiveOpenKeys(await getOpenCategoryKeys());
	const OPEN_SECTIONS = LAUNCH_CATEGORIES.filter((c) => c.href && open.has(c.key)).map((c) => ({
		href: c.href as string,
		label: c.label,
		kanji: KANJI[c.key] ?? "",
	}));
	const label = labelFor(from);

	return (
		<div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 py-20 text-center">
			<div className="dbz-panel relative w-full overflow-hidden p-10">
				<div className="screentone pointer-events-none absolute inset-0 opacity-40" />
				<div className="relative z-10">
					<span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dbz-orange/40 bg-dbz-orange/10">
						<Cadenas className="h-7 w-7 text-dbz-orange" />
					</span>
					<p className="mb-3 font-scouter text-[11px] uppercase tracking-[0.35em] text-dbz-orange">
						Bêta · accès progressif
					</p>
					<h1 className="mb-4 font-saiyan text-4xl uppercase tracking-widest text-white sm:text-5xl">
						Section fermée
					</h1>
					<p className="mx-auto mb-8 max-w-xl text-gray-300">
						Accès fermé pour {label}. Ce qui est ouvert se parcourt ici&nbsp;:
					</p>

					<div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
						{OPEN_SECTIONS.map((s) => (
							<Link
								key={s.href}
								href={s.href}
								className="dbz-panel group flex flex-col items-center gap-2 border border-dbz-border p-4 transition-colors hover:border-dbz-orange"
							>
								<span className="font-jp text-2xl text-dbz-blue-light transition-colors group-hover:text-dbz-orange">
									{s.kanji}
								</span>
								<span className="font-saiyan text-xs uppercase tracking-wider text-gray-200 group-hover:text-white">
									{s.label}
								</span>
							</Link>
						))}
					</div>

					<div className="flex flex-wrap items-center justify-center gap-3">
						<Link href="/" className="dbz-button inline-flex items-center gap-2">
							Retour à l'accueil
							<FlecheDroite className="h-4 w-4" />
						</Link>
						<Link href="/wiki/chronologie" className="dbz-button-ghost">
							Voir la chronologie
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}

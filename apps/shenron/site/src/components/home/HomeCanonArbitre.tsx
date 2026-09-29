import Link from "next/link";
import type { HomeCanonConfig } from "@/lib/home-scenes";
import type { CanonConfig } from "@/lib/canon-engine";
import { T } from "@/components/T";

/**
 * L'arbitre de canonicité sur l'accueil.
 *
 * Un `<form method="get">` vers `/wiki/canon` — même contrat que `BarreCanon` :
 * navigation faite par le navigateur, résultat rendu côté serveur, page
 * partageable par son URL, lisible sans JavaScript. Le bloc est un composant
 * serveur pur : il reçoit la doctrine déjà lue par la page (pas de cookie, pas
 * d'en-tête, l'accueil reste cacheable) et n'affiche que ce qu'elle contient —
 * les rangs tels qu'ils sont définis, et des sujets tranchés à la main.
 */
export function HomeCanonArbitre({
	config,
	doctrine,
	references,
}: {
	config: HomeCanonConfig;
	doctrine: CanonConfig;
	/** Nombre de preuves du corpus ingéré (table `canon_references`). */
	references: number;
}) {
	if (!config.enabled) return null;
	const rangs = doctrine.tiers;
	const sujets = config.sujets > 0 ? doctrine.entries.slice(0, config.sujets) : [];
	const placeholder = doctrine.placeholder?.trim() || config.placeholder;

	return (
		<section
			aria-labelledby="canon-title"
			className="home-discovery-section w-full border-t border-white/10 bg-[radial-gradient(circle_at_85%_0%,rgba(98,200,255,.12),transparent_32%),#0a0908] py-16 text-white md:py-24"
		>
			<div className="page-shell">
				<header className="max-w-3xl">
					<p className="text-xs font-bold uppercase tracking-[0.22em] text-[#62c8ff]">
						{config.eyebrow}
					</p>
					<h2 id="canon-title" className="mt-3 text-balance font-saiyan text-4xl sm:text-6xl">
						{config.title}
					</h2>
					<p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-white/60 sm:text-base">
						{config.subtitle}
					</p>
				</header>

				<form
					action="/wiki/canon"
					method="get"
					role="search"
					aria-labelledby="home-canon-form-label"
					className="mt-8 flex max-w-3xl flex-col gap-3 sm:flex-row"
				>
					{/* Un composant serveur ne sait pas remplir un `aria-label` depuis le
					    dictionnaire — il n'a pas de contexte de langue. L'étiquette est
					    donc un nœud, traduit comme le reste, que l'élément désigne. */}
					<span id="home-canon-form-label" className="sr-only">
						<T k="home.canon.formLabel" />
					</span>
					<label htmlFor="home-canon-q" className="sr-only">
						<T k="home.canon.inputLabel" />
					</label>
					<input
						id="home-canon-q"
						name="q"
						type="search"
						required
						minLength={2}
						maxLength={400}
						placeholder={placeholder}
						autoComplete="off"
						className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-5 py-3.5 text-base text-white placeholder:text-white/35 focus:border-[#62c8ff] focus:outline-none focus:ring-2 focus:ring-[#62c8ff]/40"
					/>
					<button
						type="submit"
						className="rounded-full bg-[#62c8ff] px-6 py-3.5 text-sm font-bold uppercase tracking-wider text-[#0a0908] transition hover:bg-white"
					>
						<T k="home.canon.submit" />
					</button>
				</form>

				<p id="home-canon-rangs" className="sr-only">
					<T k="home.canon.tiersLabel" />
				</p>
				<ul className="mt-8 flex flex-wrap gap-2" aria-labelledby="home-canon-rangs">
					{rangs.map((rang) => (
						<li
							key={rang.id}
							className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75"
							title={rang.definition}
						>
							<span
								aria-hidden
								className="inline-block size-2.5 rounded-full"
								style={{ backgroundColor: rang.couleur }}
							/>
							{rang.court}
						</li>
					))}
				</ul>

				{sujets.length > 0 && (
					<div className="mt-10">
						<p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
							<T k="home.canon.settled" />
						</p>
						<ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{sujets.map((sujet) => {
								const rang = rangs.find((t) => t.id === sujet.tier);
								return (
									<li key={sujet.id}>
										<Link
											href={`/wiki/canon?q=${encodeURIComponent(sujet.title)}`}
											className="group flex h-full flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/25 hover:bg-white/[0.06]"
										>
											<span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
												<span
													aria-hidden
													className="inline-block size-2 rounded-full"
													style={{ backgroundColor: rang?.couleur ?? "#9ca3af" }}
												/>
												{rang?.court ?? sujet.tier}
											</span>
											<span className="font-semibold text-white group-hover:text-[#62c8ff]">
												{sujet.title}
											</span>
											<span className="line-clamp-2 text-sm leading-5 text-white/55">
												{sujet.verdict}
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					</div>
				)}

				<p className="mt-8 text-xs text-white/40">
					<T
						k="home.canon.counts"
						values={{ sujets: doctrine.entries.length, references }}
					/>{" "}
					·{" "}
					<Link href="/wiki/canon" className="underline decoration-white/30 hover:text-white">
						<T k="home.canon.readDoctrine" />
					</Link>
				</p>
			</div>
		</section>
	);
}

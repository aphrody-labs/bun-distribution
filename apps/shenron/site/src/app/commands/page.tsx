import { PageShell } from "@/components/kit";
import Link from "next/link";
import type { Metadata } from "next";
import { ogMeta } from "@/lib/og";
import { getShenronCommands, getShenronPersonas } from "@/lib/shenron";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
	title: "Toutes les commandes du bot",
	description:
		"La liste complète des commandes Discord de Dragon Ball France, persona par persona : économie, niveaux, wiki, modération et mini-jeux.",
	...ogMeta({
		title: "Commandes du bot — DBFR",
		description: "Toutes les commandes Discord de Dragon Ball France, persona par persona.",
		type: "website",
		canonical: "/commands",
	}),
};

// Le catalogue est servi par l'API publique du bot : une courte revalidation
// évite que le site affiche des commandes supprimées ou nouvellement ajoutées
// pendant une heure.
export const revalidate = 300;

const PERSONA_LABELS: Record<string, string> = {
	shenron: "Shenron",
	beerus: "Beerus",
	whis: "Whis",
	grandPretre: "Grand Prêtre",
	enma: "Enma",
	kaio: "Kaïo",
};

const PERSONA_COLORS: Record<string, string> = {
	shenron: "text-dbz-yellow border-dbz-yellow",
	beerus: "text-purple-400 border-purple-400",
	whis: "text-cyan-400 border-cyan-400",
	grandPretre: "text-pink-400 border-pink-400",
	enma: "text-red-400 border-red-400",
	kaio: "text-dbz-orange border-dbz-orange",
};

export default async function CommandsPage({
	searchParams,
}: {
	searchParams: Promise<{ persona?: string; q?: string }>;
}) {
	const params = await searchParams;
	const [commands, personas] = await Promise.all([getShenronCommands(), getShenronPersonas()]);

	const filterPersona = params.persona;
	const query = params.q?.toLowerCase() ?? "";

	const total = Object.values(commands).reduce((s, c) => s + c.length, 0);

	// Les sections qui rendront réellement quelque chose, une fois filtre de
	// persona et recherche appliqués. Sert à décider de l'état vide, qui manquait.
	const sections = Object.entries(commands)
		.filter(([pid]) => !filterPersona || pid === filterPersona)
		.filter(([, cmds]) =>
			query
				? cmds.some(
						(c) =>
							c.name.toLowerCase().includes(query) || c.description.toLowerCase().includes(query)
					)
				: cmds.length > 0
		);

	return (
		<PageShell width="default">
			<PageHeader
				eyebrow="Catalogue live du bot"
				title="Commandes"
				className="mb-10"
				subtitle={`${total} commandes slash · catalogue live du bot · ${personas.length} personas`}
			/>
			<p className="mx-auto -mt-6 mb-8 max-w-xl text-center text-xs text-white/40">
				Cette liste est synchronisée automatiquement avec les commandes réellement enregistrées par
				Shenron.
			</p>

			{/* Persona filter pills */}
			<div className="flex flex-wrap gap-2 mb-8 justify-center">
				<a
					href="/commands"
					className={`px-3 py-2 font-saiyan uppercase tracking-wider text-sm border-2 transition-all ${
						!filterPersona
							? "bg-dbz-orange text-white border-dbz-orange"
							: "border-dbz-border text-dbz-blue-light hover:border-dbz-orange"
					}`}
				>
					TOUTES ({total})
				</a>
				{personas.map((p) => (
					<a
						key={p.id}
						href={`/commands?persona=${p.id}`}
						className={`px-3 py-2 font-saiyan uppercase tracking-wider text-sm border-2 transition-all flex items-center gap-2 ${
							filterPersona === p.id
								? "bg-dbz-orange text-white border-dbz-orange"
								: `${PERSONA_COLORS[p.id] ?? ""} hover:bg-dbz-bg`
						}`}
					>
						{p.avatar && (
							<img src={p.avatar} alt="" className="w-5 h-5 rounded-full border border-current" />
						)}
						{PERSONA_LABELS[p.id] ?? p.id} ({p.commandCount})
					</a>
				))}
			</div>

			{/* Search */}
			<form className="mb-8 max-w-md mx-auto">
				{filterPersona && <input type="hidden" name="persona" value={filterPersona} />}
				<input
					name="q"
					defaultValue={query}
					aria-label="Rechercher une commande"
					placeholder="Rechercher une commande..."
					className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none text-white"
				/>
			</form>

			{/* Commands grid */}
			<div className="space-y-12">
				{sections.length === 0 && (
					// La page rendait un vide TOTAL — ni liste, ni explication — dans deux
					// cas : une recherche sans résultat, et le filtre « Grand Prêtre »,
					// dont le persona n'expose aucune commande (il ne fait que
					// journaliser). Or c'est précisément là que le bouton « Découvrir »
					// de /personas envoie le visiteur.
					<p className="dbz-panel px-6 py-12 text-center text-white/60">
						{filterPersona && !query ? (
							<>
								<span className="font-display font-bold text-white">
									{PERSONA_LABELS[filterPersona] ?? filterPersona}
								</span>{" "}
								n'expose aucune commande : ce persona observe et journalise le serveur (messages,
								interactions, audit) sans jamais être invoqué.{" "}
								<Link
									href="/commands"
									className="text-dbz-orange underline-offset-2 hover:underline"
								>
									Voir toutes les commandes
								</Link>
								.
							</>
						) : (
							<>
								Aucune commande ne correspond à cette recherche.{" "}
								<Link
									href="/commands"
									className="text-dbz-orange underline-offset-2 hover:underline"
								>
									Tout afficher
								</Link>
								.
							</>
						)}
					</p>
				)}
				{Object.entries(commands)
					.filter(([pid]) => !filterPersona || pid === filterPersona)
					.map(([pid, cmds]) => {
						const filtered = query
							? cmds.filter(
									(c) =>
										c.name.toLowerCase().includes(query) ||
										c.description.toLowerCase().includes(query)
								)
							: cmds;
						if (filtered.length === 0) return null;
						const colorClass = PERSONA_COLORS[pid] ?? "";
						return (
							<section key={pid}>
								<h2 className={`text-3xl font-saiyan uppercase mb-4 border-b-4 pb-2 ${colorClass}`}>
									{PERSONA_LABELS[pid] ?? pid} ({filtered.length})
								</h2>
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									{filtered.map((c) => (
										<div
											key={`${pid}-${c.name}`}
											className="dbz-panel p-4 hover:border-dbz-orange transition-colors"
										>
											<div className="flex items-baseline justify-between gap-2 mb-1">
												<code className="text-dbz-orange font-mono text-sm font-bold">
													/{c.name}
												</code>
												{c.options && c.options.length > 0 && (
													<span className="text-[10px] text-gray-500 uppercase">
														{c.options.length} opt
													</span>
												)}
											</div>
											<p className="text-xs text-gray-300 leading-snug">
												{c.description || (
													<span className="italic text-gray-600">(sans description)</span>
												)}
											</p>
											{c.options && c.options.length > 0 && (
												<details className="mt-2">
													<summary className="text-[10px] text-dbz-blue-light cursor-pointer hover:text-dbz-orange uppercase tracking-widest">
														Options
													</summary>
													<ul className="mt-1 space-y-1">
														{c.options.slice(0, 8).map((o, i) => (
															<li key={i} className="text-[10px] font-mono text-gray-400">
																<span className="text-dbz-yellow">{o.name}</span>
																{o.required && <span className="text-red-400 ml-1">*</span>}
																{o.description && (
																	<span className="text-gray-600"> — {o.description}</span>
																)}
															</li>
														))}
													</ul>
												</details>
											)}
										</div>
									))}
								</div>
							</section>
						);
					})}
			</div>
		</PageShell>
	);
}

"use client";

/**
 * Frise des **versions d'un personnage saga par saga** — « Goku, saga Namek »,
 * « Goku, saga Majin Boo ».
 *
 * Client, mais sans aucun chargement : la liste complète arrive en props depuis
 * le RSC, donc tout est déjà dans le HTML rendu au serveur (indexable). Le
 * client ne sert qu'à changer de saga sans recharger la page.
 *
 * Ce que la fiche ne doit PAS faire croire : une variante amorcée
 * automatiquement (`origin = "ocr-manga"`) dit seulement que le nom du
 * personnage a été relevé sur N planches des tomes X à Y. Ce n'est pas la même
 * chose que « il combat dans cette saga » — un personnage mort peut être cité
 * pendant trois tomes. Le bandeau de provenance le dit mot pour mot plutôt que
 * de laisser la frise se faire passer pour une biographie vérifiée.
 */
import { useEffect, useId, useRef, useState } from "react";
import { WikiImg } from "@/components/wiki/WikiImg";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
// `ClientGatedWrap` et NON `GatedWrap` : ce dernier lit la configuration de
// lancement côté serveur, donc tire `postgres` — dans un composant client, cela
// fait échouer le rendu (`Module not found: dns/net/tls`). L'instantané d'accès
// est résolu par la page et descend en props.
import { ClientGatedWrap } from "@/components/GatedClientLink";
import { onTablistKeyDown } from "@/lib/tablist-keys";
import type { AccessSnapshot } from "@/lib/wiki-launch";
import type { CharacterVariant } from "@/lib/shenron";

/** Libellé court pour la pilule : « Saga Majin Boo » → « Majin Boo ». */
function courte(label: string): string {
	return label.replace(/^saga\s+(de\s+l['’]|de\s+la\s+|de\s+|du\s+|des\s+)?/i, "").trim() || label;
}

function Champ({ titre, valeur }: { titre: string; valeur: string }) {
	return (
		<div className="dbz-panel border-l-4 border-l-dbz-blue-light p-4">
			<p className="mb-1 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">{titre}</p>
			<p className="scouter-text text-xl text-dbz-blue-light">{valeur}</p>
		</div>
	);
}

export function CharacterSagaVariants({
	variants,
	characterName,
	characterImage,
	access,
}: {
	variants: CharacterVariant[];
	characterName: string;
	/** Apparence de la fiche — repli quand la variante n'a pas d'image propre. */
	characterImage: string | null;
	/** Instantané de la configuration de lancement, résolu côté serveur. */
	access?: AccessSnapshot | null;
}) {
	const [actif, setActif] = useState(0);
	/**
	 * Le motif ARIA « onglets » n'était qu'à moitié posé : les pilules portaient
	 * `role="tab"` sans jamais dire quel panneau elles commandent, et le panneau
	 * n'était pas un `tabpanel`. Un lecteur d'écran annonçait « onglet 3 sur 14 »
	 * puis laissait le lecteur chercher lui-même ce qui avait changé. Un seul
	 * panneau vit dans le DOM (celui de la saga active) : tous les onglets
	 * désignent donc le même identifiant, stable d'un rendu à l'autre.
	 */
	const panneauId = useId();

	/**
	 * Ouverture sur une version précise via `#saga-<id>`.
	 *
	 * La grille des personnages lie désormais chaque version (« Goku (Saga
	 * Namek) ») vers cette fiche. Sans ce relais, le lien retombait sur la
	 * première version de la liste : les versions sont un jeu d'onglets client,
	 * pas des ancres — le navigateur n'avait rien à viser.
	 */
	const ancre = useRef<HTMLElement | null>(null);
	useEffect(() => {
		const applyHash = () => {
			const m = /^#saga-(\d+)$/.exec(window.location.hash);
			if (!m) return;
			const cible = Number(m[1]);
			const i = variants.findIndex((x) => x.sagaId === cible);
			if (i < 0) return;
			setActif(i);
			// Le défilement attend la peinture : viser un élément qui n'a pas encore
			// sa hauteur définitive amène à côté.
			requestAnimationFrame(() =>
				ancre.current?.scrollIntoView({ behavior: "smooth", block: "start" })
			);
		};

		applyHash();
		window.addEventListener("hashchange", applyHash);
		return () => window.removeEventListener("hashchange", applyHash);
	}, [variants]);

	function selectVariant(index: number, sagaId?: number) {
		setActif(index);
		if (typeof window !== "undefined" && window.history?.replaceState && sagaId != null) {
			window.history.replaceState(null, "", `#saga-${sagaId}`);
		}
	}

	if (!variants.length) return null;
	const v = variants[Math.min(actif, variants.length - 1)]!;
	const tomes =
		v.firstVolume != null && v.lastVolume != null
			? v.firstVolume === v.lastVolume
				? `tome ${v.firstVolume}`
				: `tomes ${v.firstVolume} à ${v.lastVolume}`
			: null;
	const episodes =
		v.firstEpisode != null && v.lastEpisode != null
			? // La série est indispensable : les épisodes 1 à 20 de Daima n'ont rien
				// à voir avec les épisodes 1 à 20 de Z.
				`${v.episodeSeries ?? ""} ${
					v.firstEpisode === v.lastEpisode
						? `épisode ${v.firstEpisode}`
						: `épisodes ${v.firstEpisode} à ${v.lastEpisode}`
				}`.trim()
			: null;
	const mesuree = v.origin != null && v.origin !== "editorial";

	return (
		<section className="space-y-8" ref={ancre}>
			<p className="max-w-3xl text-sm text-white/50">
				{characterName} au fil des sagas : ce qui change d'une époque à l'autre — apparence, forme
				atteinte, rôle. {variants.length} saga{variants.length > 1 ? "s" : ""} référencée
				{variants.length > 1 ? "s" : ""}.
			</p>

			{/* Rail défilant sur mobile : quatorze sagas ne tiennent pas sur une
			    ligne d'écran de téléphone, et les empiler pousserait le contenu
			    hors de vue avant qu'on ait lu la première. */}
			<div tabIndex={0}
				className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
				role="tablist"
				aria-label={`Sagas de ${characterName}`}
				// Le rôle `tablist` promet les flèches ←/→ et Début/Fin ; sans ce
				// gestionnaire, la promesse n'était pas tenue et la frise ne se
				// parcourait qu'onglet par onglet à la tabulation.
				onKeyDown={onTablistKeyDown}
			>
				{variants.map((x, i) => {
					const on = i === actif;
					return (
						<button
							key={x.id}
							type="button"
							role="tab"
							id={`${panneauId}-onglet-${x.id}`}
							aria-controls={panneauId}
							aria-selected={on}
							// `tabIndex` tournant : le jeu d'onglets = UN arrêt de tabulation.
							tabIndex={on ? 0 : -1}
							onClick={() => selectVariant(i, x.sagaId)}
							className={`inline-flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors sm:min-h-0 sm:py-1.5 ${
								on
									? "border-dbz-orange bg-dbz-orange/10 text-white"
									: "border-dbz-border text-white/60 hover:border-dbz-orange/40 hover:text-white"
							}`}
						>
							{courte(x.label)}
							{x.form && <span className="text-[10px] text-dbz-yellow/80">{x.form}</span>}
						</button>
					);
				})}
			</div>

			<div
				className="dbz-panel flex flex-col gap-6 p-6 sm:flex-row"
				role="tabpanel"
				id={panneauId}
				aria-labelledby={`${panneauId}-onglet-${v.id}`}
			>
				<div className="w-full shrink-0 sm:w-56">
					{/* `aspect-[3/4]` obligatoire : passer `sizes` à WikiImg bascule le
					    rendu sur next/image en mode `fill`, qui se positionne en absolu
					    et ne donne AUCUNE hauteur à son parent. Sans ratio ici, la
					    colonne s'effondrait à une bande de vingt pixels. */}
					<div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-dbz-border bg-dbz-bg">
						<div aria-hidden className="halftone absolute inset-0 z-10 opacity-10" />
						<WikiImg
							src={v.image ?? characterImage}
							alt={v.displayName ?? `${characterName} — ${v.label}`}
							sizes="(min-width: 640px) 224px, 100vw"
							loading="lazy"
							className="object-contain p-2"
							placeholderClassName="absolute inset-0 flex items-center justify-center rounded"
						/>
					</div>
				</div>

				<div className="min-w-0 flex-1 space-y-4">
					<div>
						{/* `h2` et non `h3` : cette frise est une rubrique de la fiche au
						    même titre que « Transformations » ou « Personnages affiliés »,
						    qui titrent toutes en `h2`. Elle sautait donc un niveau sous le
						    `h1` du personnage, et la fiche n'avait aucun `h2` quand la
						    frise était sa seule rubrique. */}
						<h2 className="font-saiyan text-2xl uppercase tracking-widest text-white sm:text-3xl">
							{v.displayName ?? `${characterName} — ${v.label}`}
						</h2>
						<div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
							<ClientGatedWrap
								access={access}
								href={`/wiki/sagas/${v.sagaSlug}`}
								className="font-bold uppercase tracking-widest text-dbz-orange hover:text-white"
							>
								{v.sagaName} →
							</ClientGatedWrap>
							{v.sagaSeries && (
								<span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
									{v.sagaSeries}
								</span>
							)}
							{v.role && (
								<span className="border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
									{v.role}
								</span>
							)}
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{v.form && <Champ titre="Forme atteinte" valeur={v.form} />}
						{v.age != null && <Champ titre="Âge" valeur={`${v.age} ans`} />}
						{v.powerLevel && <Champ titre="Puissance" valeur={v.powerLevel} />}
						{v.ki && <Champ titre="Ki" valeur={v.ki} />}
						{v.maxKi && <Champ titre="Ki maximum" valeur={v.maxKi} />}
						{v.affiliation && <Champ titre="Affiliation" valeur={v.affiliation} />}
						{/* Les deux seules valeurs qu'on tienne d'une mesure et non d'une
						    rédaction : elles occupent le bloc tant que le reste n'est pas
						    écrit, et elles restent vraies après. */}
						{tomes && <Champ titre="Manga" valeur={tomes} />}
						{episodes && <Champ titre="Série animée" valeur={episodes} />}
						{!!v.evidence?.planches && (
							<Champ titre="Planches où le nom paraît" valeur={String(v.evidence.planches)} />
						)}
						{!!v.evidence?.synopsis && (
							<Champ titre="Résumés d'épisode" valeur={String(v.evidence.synopsis)} />
						)}
					</div>

					{v.summary && (
						<div className="prose-invert max-w-none text-sm">
							<WikiMarkdown body={v.summary} />
						</div>
					)}

					{/* Épisodes dont le TITRE nomme le personnage : ni un résumé ni une
					    interprétation, la liste de ce que la série a mis à son nom
					    pendant la saga. C'est le seul contenu de la variante qu'on
					    tienne d'une mesure et pas d'une rédaction. */}
					{v.keyEpisodes && v.keyEpisodes.length > 0 && (
						<div>
							<p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
								Épisodes à son nom
							</p>
							<ul className="flex flex-wrap gap-2">
								{v.keyEpisodes.map((e) => (
									<li key={e.id}>
										<ClientGatedWrap
											access={access}
											href={`/wiki/episodes/${e.id}`}
											className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dbz-border px-3 py-1.5 text-xs text-white/75 transition-colors hover:border-dbz-orange/50 hover:text-white"
										>
											<span className="tabular-nums text-dbz-orange/80">#{e.num}</span>
											{e.title}
										</ClientGatedWrap>
									</li>
								))}
							</ul>
						</div>
					)}

					{v.highlights && v.highlights.length > 0 && (
						<ul className="space-y-2 text-sm text-white/75">
							{v.highlights.map((h) => (
								<li key={h} className="flex gap-3">
									<span aria-hidden className="text-dbz-orange">
										▸
									</span>
									<span>{h}</span>
								</li>
							))}
						</ul>
					)}

					{/* Provenance — dit ce que la mesure prouve, et ce qu'elle ne prouve pas. */}
					{mesuree && (
						<p className="border-t border-white/10 pt-4 text-xs leading-relaxed text-white/45">
							Relevé automatique : le nom est <em>cité</em> dans{" "}
							{v.origin === "synopsis-episodes"
								? "ces résumés d'épisode"
								: v.origin === "ocr-manga"
									? "ces planches"
									: "ces planches et ces résumés"}
							, ce qui ne dit pas à soi seul quel rôle le personnage tient dans la saga.
							{v.origin === "synopsis-episodes" &&
								" Cette saga n'a pas de manga : la présence n'est attestée que par l'adaptation animée."}{" "}
							Forme, puissance et faits marquants restent à écrire.
						</p>
					)}
				</div>
			</div>
		</section>
	);
}

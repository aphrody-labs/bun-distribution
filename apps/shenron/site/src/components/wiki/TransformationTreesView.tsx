"use client";

import { useState } from "react";

import { Flame, Shield, Layers } from "lucide-react";

interface EvolutionTreeNode {
	name: string;
	slug?: string;
	stage: string;
	description: string;
	users: string[];
	canonRank: "canon" | "supervised" | "non_canon";
}

interface EvolutionTree {
	id: string;
	title: string;
	lineage: string;
	color: string;
	borderColor: string;
	badgeColor: string;
	nodes: EvolutionTreeNode[];
}

const EVOLUTION_TREES: EvolutionTree[] = [
	{
		id: "saiyan_golden",
		title: "1. Lignée Saiyan Canonique — Voie Dorée",
		lineage: "Akira Toriyama (Manga Tomes 1 à 42)",
		color: "from-amber-950/40 via-yellow-950/20 to-black",
		borderColor: "border-amber-500/40",
		badgeColor: "border-amber-500/30 bg-amber-950/60 text-amber-300",
		nodes: [
			{
				name: "Ōzaru (Singe Géant)",
				stage: "Forme Primordiale",
				description: "Métamorphose sous les rayons Blutz de la pleine lune via la queue de Saiyan. Multiplie la force par 10.",
				users: ["Goku", "Gohan", "Vegeta"],
				canonRank: "canon",
			},
			{
				name: "Super Saiyan (SSJ1)",
				stage: "Éveil de la Colère",
				description: "Le guerrier de légende aux cheveux d'or éveillé par une rage extrême. Multiplie la puissance de base par 50.",
				users: ["Goku", "Vegeta", "Gohan", "Trunks", "Goten"],
				canonRank: "canon",
			},
			{
				name: "SSJ Dai Ni & San Dankai",
				stage: "Stades Intermédiaires",
				description: "Gonflement musculaire extrême développé dans la Salle de l'Esprit et du Temps. Augmente la force brute mais pénalise la vélocité.",
				users: ["Vegeta", "Trunks", "Goku"],
				canonRank: "canon",
			},
			{
				name: "Super Saiyan Pleine Puissance",
				stage: "Maîtrise Parfaite (Grade 4)",
				description: "Élimination totale de l'agressivité et de la déperdition d'énergie. Maintien continu du Super Saiyan à l'état de repos.",
				users: ["Goku", "Gohan"],
				canonRank: "canon",
			},
			{
				name: "Super Saiyan 2",
				stage: "Dépassement du Mur",
				description: "Éveil des étincelles bio-électriques. Vitesse et puissance doublées par rapport au Super Saiyan (Gohan vs Cell).",
				users: ["Gohan", "Goku", "Vegeta"],
				canonRank: "canon",
			},
			{
				name: "Super Saiyan 3",
				stage: "Extraction Totale du Potentiel",
				description: "Longue crinière et disparition des sourcils. Consommation d'énergie titanesque limitant son usage sur Terre.",
				users: ["Goku", "Gotenks"],
				canonRank: "canon",
			},
		],
	},
	{
		id: "saiyan_divine",
		title: "2. Lignée Saiyan Divine — Ki des Dieux",
		lineage: "Supervision Akira Toriyama (Battle of Gods & DBS)",
		color: "from-blue-950/40 via-cyan-950/20 to-black",
		borderColor: "border-cyan-500/40",
		badgeColor: "border-cyan-500/30 bg-cyan-950/60 text-cyan-300",
		nodes: [
			{
				name: "Super Saiyan God",
				stage: "Rituel des 6 Cœurs Purs",
				description: "Chevelure et aura rouge rubis. Accès au Ki Divin, indétectable pour les mortels, conférant agilité et régénération.",
				users: ["Goku", "Vegeta"],
				canonRank: "supervised",
			},
			{
				name: "Super Saiyan Blue (SSGSS)",
				stage: "Dieu Super Saiyan",
				description: "Le stade Super Saiyan appliqué par-dessus le Ki divin du Super Saiyan God. Aura azur et puissance stellaire.",
				users: ["Goku", "Vegeta"],
				canonRank: "supervised",
			},
			{
				name: "SSJ Blue Évolution (SSJBE)",
				stage: "Dépassement Princier",
				description: "Forme exclusive à Vegeta au Tournoi du Pouvoir, brisant ses propres limites par sa fierté royale pour égaler les Dieux.",
				users: ["Vegeta"],
				canonRank: "supervised",
			},
		],
	},
	{
		id: "divine_supreme",
		title: "3. Domaine Suprême — Anges & Destructeurs",
		lineage: "Toriyama & Toyotarō (DBS Manga & Film)",
		color: "from-purple-950/40 via-fuchsia-950/20 to-black",
		borderColor: "border-purple-500/40",
		badgeColor: "border-purple-500/30 bg-purple-950/60 text-purple-300",
		nodes: [
			{
				name: "Ultra Instinct (Signes / Kizashi)",
				stage: "Réflexe Inconscient",
				description: "Le corps esquive et attaque sans passer par la commande cérébrale. Chevelure noire aux reflets argentés.",
				users: ["Goku"],
				canonRank: "supervised",
			},
			{
				name: "Ultra Instinct Maîtrisé",
				stage: "Sérénité Angélique Absolue",
				description: "Cheveux et yeux argentés. Harmonie totale de l'esprit et du corps atteignant l'état naturel des Anges.",
				users: ["Goku"],
				canonRank: "supervised",
			},
			{
				name: "Ultra Ego (Wagamama no Gokui)",
				stage: "Puissance de la Destruction (Hakai)",
				description: "Cheveux pourpres sans sourcils. La puissance augmente proportionnellement aux dégâts encaissés et à la soif de bataille.",
				users: ["Vegeta"],
				canonRank: "supervised",
			},
		],
	},
	{
		id: "hybrids_earthlings",
		title: "4. Lignée Hybrides & Éveils Terrestres",
		lineage: "Gohan & Piccolo (DBS: Super Hero)",
		color: "from-emerald-950/40 via-teal-950/20 to-black",
		borderColor: "border-emerald-500/40",
		badgeColor: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300",
		nodes: [
			{
				name: "Potentiel Éveillé (Gohan Ultime)",
				stage: "Rituel du Doyen Kaio Shin",
				description: "Libération totale du potentiel sans avoir besoin de se transformer en Super Saiyan. Regard perçant et mèches noires.",
				users: ["Gohan"],
				canonRank: "canon",
			},
			{
				name: "Gohan Beast",
				stage: "Éveil Primordial Furieux",
				description: "Chevelure argentée dressée et yeux rouges. Éveil de la bête intérieure surpassant les combattants divins.",
				users: ["Gohan"],
				canonRank: "supervised",
			},
			{
				name: "Orange Piccolo",
				stage: "Bénédiction de Shenron",
				description: "Forme massive et peau orangée offerte par le dragon Shenron comme bonus au-delà de son potentiel débloqué.",
				users: ["Piccolo"],
				canonRank: "supervised",
			},
		],
	},
	{
		id: "freezer_evolution",
		title: "5. Lignée des Métamorphoses de Freezer",
		lineage: "Clan Cold & Armée de Freezer",
		color: "from-rose-950/40 via-red-950/20 to-black",
		borderColor: "border-rose-500/40",
		badgeColor: "border-rose-500/30 bg-rose-950/60 text-rose-300",
		nodes: [
			{
				name: "1re, 2e, 3e Formes",
				stage: "Formes de Réduction",
				description: "Enveloppes corporelles créées pour contenir et contrôler une puissance naturelle trop dévastatrice.",
				users: ["Freezer"],
				canonRank: "canon",
			},
			{
				name: "Forme Finale (Originale)",
				stage: "Véritable Apparence",
				description: "Corps épuré, blanc et violet. La véritable anatomie de naissance de Freezer révélée sur Namek.",
				users: ["Freezer"],
				canonRank: "canon",
			},
			{
				name: "Golden Freezer",
				stage: "Entraînement de 4 Mois",
				description: "Peau dorée forgée pour humilier les Super Saiyans. Puissance rivalisant avec le Super Saiyan Blue.",
				users: ["Freezer"],
				canonRank: "supervised",
			},
			{
				name: "Black Freezer",
				stage: "10 Ans dans la Salle du Temps",
				description: "Forme ténébreuse invincible capable de terrasser Goku UI et Vegeta Ultra Ego en un coup unique.",
				users: ["Freezer"],
				canonRank: "supervised",
			},
		],
	},
	{
		id: "gt_alternative",
		title: "6. Lignée Alternative GT — Voie Primordiale (Non-Canon)",
		lineage: "Toei Animation & Katsuyoshi Nakatsuru (DBGT)",
		color: "from-purple-950/40 via-violet-950/20 to-black",
		borderColor: "border-purple-500/40",
		badgeColor: "border-purple-500/30 bg-purple-950/60 text-purple-300",
		nodes: [
			{
				name: "Ōzaru Doré (Golden Great Ape)",
				stage: "Singe Géant Super Saiyan",
				description: "Transformation en singe géant doré sous l'influence des ondes Terrestres. Perte totale de contrôle conscient.",
				users: ["Goku", "Vegeta", "Baby Vegeta"],
				canonRank: "non_canon",
			},
			{
				name: "Super Saiyan 4",
				stage: "Maîtrise de la Bête",
				description: "Design iconique de Katsuyoshi Nakatsuru avec fourrure écarlate et chevelure noire. Fusion de l'humain et du singe légendaire.",
				users: ["Goku", "Vegeta", "Gogeta"],
				canonRank: "non_canon",
			},
		],
	},
];

export function TransformationTreesView() {
	const [activeTreeId, setActiveTreeId] = useState<string>("saiyan_golden");

	const activeTree = EVOLUTION_TREES.find((t) => t.id === activeTreeId) ?? EVOLUTION_TREES[0]!;

	return (
		<div className="space-y-6">
			{/* En-tête explicatif */}
			<div className="rounded-2xl border border-white/10 bg-black/50 p-4 sm:p-5 backdrop-blur-xl">
				<div className="flex items-center gap-2 font-saiyan text-xl text-white">
					<Layers className="h-5 w-5 text-orange-400" />
					<span>ARBORESCENCE &amp; FAMILLES D&apos;ÉVOLUTION DES TRANSFORMATIONS</span>
				</div>
				<p className="mt-1 text-xs text-white/70 max-w-2xl">
					Chaque stade de transformation s&apos;inscrit dans une généalogie précise : la lignée dorée classique des 42 tomes, l&apos;accès au Ki Divin, les éveils hybrides et les voies alternatives.
				</p>
			</div>

			{/* Onglets des grandes branches */}
			<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 scrollbar-thin lg:flex-wrap">
				{EVOLUTION_TREES.map((tree) => {
					const isSelected = tree.id === activeTreeId;
					return (
						<button
							key={tree.id}
							type="button"
							onClick={() => setActiveTreeId(tree.id)}
							className={`shrink-0 snap-start rounded-xl border px-3.5 py-2.5 text-left transition-all ${
								isSelected
									? "border-orange-500 bg-orange-500/20 text-white shadow-lg shadow-orange-950/40 ring-1 ring-orange-500/40"
									: "border-white/5 bg-white/[0.03] text-white/65 hover:border-white/20 hover:text-white"
							}`}
						>
							<div className="text-xs font-bold">{tree.title}</div>
							<div className="text-[10px] text-white/40">{tree.nodes.length} stades d&apos;évolution</div>
						</button>
					);
				})}
			</div>

			{/* Arbre Actif avec cheminement séquentiel */}
			<div className={`rounded-3xl border ${activeTree.borderColor} bg-gradient-to-br ${activeTree.color} p-6 sm:p-8 backdrop-blur-2xl shadow-2xl space-y-6`}>
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-white/10 pb-4">
					<div>
						<div className="text-xs font-bold uppercase tracking-wider text-orange-400">
							Lignée Généalogique
						</div>
						<h3 className="font-saiyan text-2xl sm:text-3xl text-white tracking-wide mt-0.5">
							{activeTree.title}
						</h3>
						<div className="text-xs text-white/60 mt-1">Source : {activeTree.lineage}</div>
					</div>
					<span className={`self-start sm:self-auto rounded-full border px-3 py-1 text-xs font-bold ${activeTree.badgeColor}`}>
						{activeTree.nodes.length} Métamorphoses Liées
					</span>
				</div>

				{/* Flux d'évolution des stades */}
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{activeTree.nodes.map((node, idx) => (
						<div
							key={node.name}
							className="relative flex flex-col justify-between rounded-2xl border border-white/10 bg-black/60 p-4 sm:p-5 backdrop-blur-md shadow-xl transition-all hover:border-orange-500/50 hover:bg-black/80"
						>
							<div>
								{/* Numéro d'ordre & Rang canon */}
								<div className="flex items-center justify-between gap-2 text-[10px]">
									<span className="font-mono text-orange-400 font-bold">
										STADE {idx + 1}
									</span>
									<span
										className={`rounded-md border px-2 py-0.5 font-bold uppercase ${
											node.canonRank === "canon"
												? "border-amber-500/30 bg-amber-950/60 text-amber-300"
												: node.canonRank === "supervised"
												? "border-cyan-500/30 bg-cyan-950/60 text-cyan-300"
												: "border-purple-500/30 bg-purple-950/60 text-purple-300"
										}`}
									>
										{node.canonRank === "canon"
											? "Canon Manga"
											: node.canonRank === "supervised"
											? "Super Canon"
											: "Dérivé GT"}
									</span>
								</div>

								{/* Nom du Stade */}
								<h4 className="text-lg font-bold text-white mt-2">
									{node.name}
								</h4>
								<div className="text-xs font-semibold text-orange-300/90 mt-0.5">
									{node.stage}
								</div>

								{/* Description mécanique */}
								<p className="text-xs leading-relaxed text-white/70 mt-2.5">
									{node.description}
								</p>
							</div>

							{/* Guerriers Maîtrisant cette forme */}
							<div className="mt-4 pt-3 border-t border-white/10">
								<div className="text-[10px] uppercase font-bold text-white/40 tracking-wider mb-1">
									Utilisateurs Clés
								</div>
								<div className="flex flex-wrap gap-1">
									{node.users.map((u) => (
										<span
											key={u}
											className="rounded bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/80"
										>
											{u}
										</span>
									))}
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

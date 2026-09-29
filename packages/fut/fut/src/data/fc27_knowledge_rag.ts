/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { z } from "zod";

export const Fc27RagEntrySchema = z.object({
	id: z.string(),
	category: z.enum([
		"pitch_notes",
		"patch_notes",
		"gameplay_deep_dive",
		"ultimate_team_deep_dive",
		"fc_iq_tactics",
		"playstyles_lexicon",
		"market_economy_rules",
		"official_guides",
		"leaks_and_roadmap",
	]),
	title: z.string(),
	source_url: z.string().url(),
	published_at: z.string(),
	author_or_source: z.string(),
	summary: z.string(),
	keywords: z.array(z.string()),
	content_markdown: z.string(),
	factual_entities: z.record(z.string(), z.any()).optional(),
});

export type Fc27RagEntry = z.infer<typeof Fc27RagEntrySchema>;

export const FC27_RAG_CORPUS: Fc27RagEntry[] = [
	{
		id: "pitch-notes-fc27-fut-deep-dive",
		category: "ultimate_team_deep_dive",
		title: "Pitch Notes : Plongée au cœur d'EA SPORTS FC 27 Ultimate Team (Deep Dive)",
		source_url: "https://www.ea.com/fr/games/ea-sports-fc/fc-27/news/pitch-notes-fc27-fut-deep-dive",
		published_at: "2026-08-12T16:00:00Z",
		author_or_source: "EA SPORTS FC Ultimate Team Development Team",
		summary: "Analyse exhaustive et notes des développeurs présentant les innovations majeures d'Ultimate Team dans FC 27 : intégration native du système FC IQ, refonte des PlayStyles+, stockage des doublons invendables, compétitions Rivals/Champions restructurées et nouveau marché.",
		keywords: [
			"Pitch Notes",
			"FC 27",
			"Ultimate Team",
			"FC IQ",
			"PlayStyles+",
			"Player Roles",
			"Doublons",
			"Rivals",
			"Champions",
			"Weekend League",
			"Rush",
		],
		factual_entities: {
			game_version: "27.0.0",
			modes: ["Rush 5v5", "Champions", "Rivals", "Squad Battles", "Draft"],
			max_duplicate_storage: 100,
			champions_matches: 15,
			rivals_weekly_points_target: 15,
		},
		content_markdown: `
# Pitch Notes EA SPORTS FC 27 : Plongée au cœur d'Ultimate Team (Deep Dive)

## 1. Intégration Native d'EA SPORTS FC IQ dans Ultimate Team
Dans EA SPORTS FC 27, le système tactique traditionnel hérité des Workrates statiques (Faible / Moyen / Élevé) est définitivement abandonné au profit du moteur **FC IQ**.
- **Player Roles** : Chaque carte de joueur possède entre 1 et 3 rôles assignés à son poste principal et à ses postes secondaires.
- **Niveaux de Familiarité** :
  - **Base** : Le joueur évolue dans le rôle avec l'intelligence de déplacement standard.
  - **Role+ (+)** : Débloqué pour les joueurs accomplis dans cette fonction (temps de réaction réduit, démarquage plus tranchant).
  - **Role++ (++)** : Niveau d'élite mondial conférant des animations exclusives, un synchronisme idéal avec les transitions offensives/défensives et un placement chirurgical sans consigne manuelle.
- **Focalisations Tactiques (Focus)** : Les rôles sont affinés selon les axes d'équipe : *Defend*, *Balanced*, *Attack*, *Build-Up*, *Roaming*, *Complete*, et *Sweeper*.

## 2. Nouveau Système de Stockage des Doublons Invendables (SBC Storage)
Répondant à la demande numéro un de la communauté :
- Un espace de stockage dédié pouvant contenir jusqu'à **100 éléments joueurs invendables en doublon**.
- Accès direct depuis l'interface des Défis de Création d'Équipe (DCE / SBC) sans obligation de recyclage immédiat ou de vente rapide pour 0 crédit.

## 3. PlayStyles & Équilibrage des PlayStyles+
- Les PlayStyles définissent la physionomie des matchs bien plus que les statistiques brutes.
- Introduction des nouveaux PlayStyles gardiens (*Cross Claimer*, *Deflector*, *Far Reach*, *Footwork*, *Rush Out*, *Far Throw*).
- Rééquilibrage du tir enroulé (*Finesse Shot+*) et de la course rapide (*Rapid+* / *Quick Step+*) avec inertie physique accrue lors des virages à haute vitesse.

## 4. Refonte des Compétitions : Rivals et Champions
- **Rivals** : Passage à un système de points cumulés par victoires et nuls (3 points par victoire, 1 par match nul) pour valider les paliers hebdomadaires de récompenses, éliminant la frustration des séries interrompues.
- **Champions (Weekend League)** : Format recalibré sur 15 matchs à haute intensité, avec des rangs de récompenses progressifs garantissant des choix de joueurs et des packs de cartes TOTW/Promos échangeables dès le Palier 3.
- **Mode Rush 5v5** : Intégration au cœur d'Ultimate Team avec des objectifs de groupe récurrents, octroyant des bonus d'EXP de passe saisonnier et des points de club.
		`.trim(),
	},
	{
		id: "pitch-notes-fc27-gameplay-fc-iq-deep-dive",
		category: "fc_iq_tactics",
		title: "Pitch Notes : Gameplay & Moteur Tactique FC IQ 2.0",
		source_url: "https://www.ea.com/fr/games/ea-sports-fc/fc-27/news/pitch-notes-fc27-gameplay-deep-dive",
		published_at: "2026-07-28T15:00:00Z",
		author_or_source: "EA SPORTS FC Gameplay Engineering",
		summary: "Spécifications techniques du moteur Frostbite Next, de l'animation volumétrique HyperMotionV 3.0 et du modèle décisionnel des équipiers guidé par l'IA tactique FC IQ.",
		keywords: [
			"Gameplay",
			"HyperMotionV",
			"Frostbite",
			"FC IQ",
			"Tactique",
			"AcceleRATE 2.0",
			"Physique de balle",
		],
		factual_entities: {
			accelerate_archetypes: 7,
			tick_rate: "60hz",
			hypermotion_volumetric_captures: 1800,
		},
		content_markdown: `
# Pitch Notes Gameplay FC 27 : Révolution Tactique FC IQ & HyperMotionV

## 1. Moteur Décisionnel FC IQ & Données Opta Réelles
Le système FC IQ s'appuie sur l'analyse volumétrique de plus de 1 800 matchs professionnels capturés par caméras haute fidélité.
- L'IA des coéquipiers hors possession analyse désormais l'espace 3 lignes à l'avance.
- Les latéraux inverses (*Falseback / Inverted Wingback*) repiquent automatiquement dans l'axe lors des phases de relance basse pour former un double pivot 3-2-5 ou 2-3-5.
- Les ailiers intérieurs (*Inside Forward*) exploitent systématiquement le demi-espace (*half-space*) laissé libre par le décrochage d'un attaquant en faux 9 (*False 9*).

## 2. AcceleRATE 2.0 : Les 7 Profils d'Accélération
La vitesse en ligne droite est régie par la corrélation Taille / Poids / Écart Agilité-Force :
1. **Explosive** : Démarrage supersonique sur les premiers mètres (idéal ailiers légers < 175 cm).
2. **Mostly Explosive** : Forte accélération initiale avec transition linéaire rapide.
3. **Controlled Explosive** : Profil hybride offrant motricité et réactivité dans les petits espaces.
4. **Controlled** : Montée en puissance uniforme standard.
5. **Controlled Lengthy** : Transition progressive vers une vitesse de pointe dévastatrice.
6. **Mostly Lengthy** : Démarrage lourd mais foulées amples rattrapant tout joueur lancé.
7. **Lengthy** : Archétype réservé aux gabarits imposants (> 188 cm, Force >= Agilité + 14), inatteignable sur 40 mètres.

## 3. Précision du Passement de Jambes et Physique de Balle
- Réduction drastique des rebonds automatiques dans les pieds des attaquants lors d'un tacle réussi grâce au PlayStyle *Anticipate+*.
- Nouveaux tirs tendus sans rebond (*Low Driven Shot*) déclenchables à l'entrée de surface en maintenant L1+R1 (LB+RB) lors de la frappe.
		`.trim(),
	},
	{
		id: "patch-notes-fc27-tu1-day-one-update",
		category: "patch_notes",
		title: "Patch Notes : Mise à jour de lancement FC 27 (Title Update 1)",
		source_url: "https://www.ea.com/fr/games/ea-sports-fc/fc-27/news/patch-notes-title-update-1",
		published_at: "2026-09-15T08:00:00Z",
		author_or_source: "EA Operations & Live Service",
		summary: "Détail des ajustements de gameplay, corrections de bugs du marché des transferts, stabilité de la Web App et calibration des gardiens de but pour le lancement officiel.",
		keywords: [
			"Title Update 1",
			"Patch Notes",
			"Équilibrage",
			"Gardiens",
			"Marché des transferts",
			"Stabilité",
		],
		factual_entities: {
			patch_version: "1.0.1",
			platforms: ["PC", "PS5", "Xbox Series X|S"],
			release_date: "2026-09-15",
		},
		content_markdown: `
# EA SPORTS FC 27 : Notes de version Title Update 1

## Gameplay & Ajustements
- **Gardiens de but** : Correction d'une anomalie où les gardiens dotés du PlayStyle *Far Reach* ne déployaient pas la pleine extension sur les frappes croisées à mi-hauteur.
- **Passe en profondeur lobée** : Légère augmentation de la trajectoire parabolique pour éviter les interceptions systématiques par les défenseurs sans saut actif.
- **Sprint contrôlé (R1/RB)** : Ajustement de la dégradation d'endurance lors d'une utilisation continue de plus de 4 secondes consécutives.
- **Tacles glissés** : Diminution de 12% du temps de relèvement après un tacle glissé manqué.

## Ultimate Team & Marché
- Résolution du problème d'affichage des prix minimum d'achat immédiat sur l'application Web et Companion.
- Correction d'un bug visuel affichant l'icône de rôle *Role++* comme un rôle standard sur certaines cartes Heroes de première génération.
- Amélioration de la fluidité de recherche dans le Marché des transferts lors du filtrage par ligues combinées hommes/femmes.
		`.trim(),
	},
	{
		id: "fc27-market-economy-and-price-ranges-guide",
		category: "market_economy_rules",
		title: "Guide de l'Économie du Marché des Transferts & Fourchettes de Prix FC 27",
		source_url: "https://www.ea.com/fr/games/ea-sports-fc/fc-27/news/transfer-market-guide",
		published_at: "2026-09-01T12:00:00Z",
		author_or_source: "EA Sports FC Live Economy Team",
		summary: "Règles économiques d'Ultimate Team : fonctionnement des Price Ranges dynamiques, taxe EA de 5%, paliers d'enchères fixes et cycles hebdomadaires d'offre et de demande.",
		keywords: [
			"Marché",
			"Price Ranges",
			"Taxe 5%",
			"Crédits",
			"Transfer Market",
			"Fourchettes de prix",
			"Investissement",
		],
		factual_entities: {
			ea_tax_percentage: 5,
			bid_increment_brackets: [
				{ max: 1000, step: 50 },
				{ max: 10000, step: 100 },
				{ max: 50000, step: 250 },
				{ max: 100000, step: 500 },
				{ max: 99999999, step: 1000 },
			],
		},
		content_markdown: `
# Guide Officiel : Économie & Fonctionnement du Marché des Transferts FC 27

## 1. La Taxe EA de 5%
Sur chaque transaction conclue sur le marché des transferts, une retenue fiscale automatique de **5%** est prélevée sur le montant final de la vente :
$$\\text{Crédits Reçus} = \\text{Prix de Vente} \\times 0.95$$
Cette taxe agit comme un puits de monnaie (*coin sink*) régulant l'inflation globale de la masse monétaire en jeu.

## 2. Fourchettes de Prix Dynamiques (Price Ranges)
Chaque élément échangeable possède une fourchette de vente délimitée par :
- **Min BIN / Min Bid** : Prix plancher en-deçà duquel la carte ne peut être listée.
- **Max BIN** : Prix plafond absolu.
- Les fourchettes sont ajustées de manière algorithmique par EA en fonction de l'offre et de la demande observées sur le marché. Lorsqu'une carte atteint constamment son Max BIN (*extinct card*), la fourchette est rehaussée dans les 6 à 24 heures.

## 3. Paliers d'Incrémentation des Enchères (Bid Steps)
Les surenchères respectent des paliers stricts :
- Moins de 1 000 crédits : incrément de **50 crédits**.
- De 1 000 à 10 000 crédits : incrément de **100 crédits**.
- De 10 000 à 50 000 crédits : incrément de **250 crédits**.
- De 50 000 à 100 000 crédits : incrément de **500 crédits**.
- Au-delà de 100 000 crédits : incrément de **1 000 crédits**.

## 4. Cycles Hebdomadaires Clés
- **Jeudi 08h00 UTC** : Distribution des récompenses Division Rivals (afflux massif de cartes, baisse des prix sur les cartes courantes).
- **Vendredi 18h00 UTC** : Lancement des nouvelles promos et des équipes événementielles (forte demande en crédits, injection de packs spéciaux).
- **Dimanche soir / Lundi matin** : Vente massive des équipes Weekend League (*sell-off*), baisse des prix des cartes métas de compétition.
		`.trim(),
	},
	{
		id: "fc27-complete-lexicon-and-glossary",
		category: "playstyles_lexicon",
		title: "Lexique et Glossaire Factuel Officiel EA SPORTS FC 27",
		source_url: "https://www.ea.com/fr/games/ea-sports-fc/fc-27/news/official-lexicon-and-glossary",
		published_at: "2026-09-10T10:00:00Z",
		author_or_source: "Ecosystem Data Architecture Team",
		summary: "Dictionnaire encyclopédique de référence pour FC 27 : définitions normées de tous les acronymes, mécaniques, statuts de cartes et concepts du jeu.",
		keywords: [
			"Lexique",
			"Glossaire",
			"Acronymes",
			"OVR",
			"TOTW",
			"POTM",
			"SBC",
			"DCE",
			"BIN",
			"AcceleRATE",
			"PlayStyles",
		],
		factual_entities: {
			total_lexicon_terms: 24,
			governance: "BXC Unified Knowledge Engine",
		},
		content_markdown: `
# Lexique et Glossaire Factuel EA SPORTS FC 27

- **BIN (Buy It Now / Achat Immédiat)** : Achat instantané d'une carte au prix fixé par le vendeur sans passer par le système d'enchères avec compte à rebours.
- **DCE / SBC (Squad Building Challenge)** : Défis de création d'équipe permettant d'échanger des cartes non utilisées contre des récompenses exclusives, packs ou joueurs thématiques.
- **OVR (Overall Rating / Note Générale)** : Note globale synthétique pondérée d'un joueur, comprise entre 45 et 99.
- **TOTW (Team of the Week / Équipe de la Semaine)** : Cartes spéciales publiées chaque mercredi récompensant les meilleures performances du football réel mondial avec un boost de stats et de rôles.
- **POTM (Player of the Month / Joueur du Mois)** : Carte SBC exclusive récompensant le meilleur joueur élu par chaque ligue officielle (Premier League, LaLiga, Serie A, Bundesliga, Ligue 1).
- **FC IQ** : Moteur tactique d'EA SPORTS FC remplaçant les tactiques personnalisées à glissières par des rôles prédéfinis adossés aux données de modélisation réelle.
- **Role+ / Role++** : Degré d'affinité d'un joueur avec un rôle tactique donné. Role++ confère le positionnement optimal sans faille.
- **PlayStyle / PlayStyle+** : Trait de gameplay signature. La version dorée (+) confère des animations prioritaires et des coefficients d'efficacité maximaux.
- **AcceleRATE 2.0** : Algorithme dynamique scindant les joueurs en 7 archétypes d'accélération en fonction de leur vélocité, agilité, force et morphologie.
- **Fodder** : Cartes à haute note générale (84, 85, 86, 87, 88, 89+) dont la valeur marchande est principalement déterminée par leur utilité pour compléter les exigences des DCE coûteux.
- **Extinct** : Terme désignant une carte dont aucune unité n'est disponible à l'achat sur le marché des transferts car la demande dépasse l'offre à sa fourchette de prix maximale autorisée.
- **Shadow Striker** : Rôle tactique de numéro 10 qui s'infiltre dans le dos de la défense adverse pour frapper au but dès que l'attaquant de pointe décroche.
- **Falseback** : Latéral moderne qui se repositionne dans l'axe aux côtés du milieu défensif lors des phases de possession.
- **Inverted Wingback** : Piston d'aile rentrant dans l'axe pour participer activement à la construction du jeu et au contre-pressing.
		`.trim(),
	},
];

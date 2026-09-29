/**
 * Script d'enrichissement canonique exhaustif de Shenron (ID 1090)
 * Consolide les données du Manga original (42 tomes, Akira Toriyama) et des Daizenshuu (2, 4, 7).
 *
 * Persiste via :
 * 1. BXC Dataset -> data/shenron-enriched.sqlite (avec FTS5) et data/shenron-enriched.json
 * 2. BxcDB.upsertScrape -> data/bxc.sqlite
 * 3. Validation via CLI bxc export
 */

import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Dataset } from "../src/storage/Dataset.ts";
import { BxcDB } from "../src/db/BxcDB.ts";

export interface ShenronConsolidatedData {
	character_id: number;
	slug: string;
	name: string;
	name_ja: string;
	name_romaji: string;
	title_canon: string;
	race_id: number;
	race_slug: string;
	race_name: string;
	origin_planet_id: number;
	origin_planet_name: string;
	location: string;
	affiliation: string;
	creators: Array<{
		name: string;
		role: string;
		race: string;
		title: string;
	}>;
	dragon_balls: {
		count: number;
		diameter_cm: number;
		color: string;
		stars: string;
		summon_chant_ja: string;
		summon_chant_romaji: string;
		summon_chant_fr: string;
		appearance_phenomenon: string;
	};
	rules: {
		wishes_count_kami_sama: number;
		wishes_count_dende: number;
		mass_resurrection_cost_dende: number;
		cooldown_full_year: number;
		cooldown_partial_months_per_wish: number;
		natural_death_restriction: string;
		one_time_resurrection_limit: string;
		one_year_mass_resurrection_limit: string;
		creator_power_ceiling: string;
		power_consent_rule: string;
		moral_neutrality: string;
	};
	deaths_and_rebirths: Array<{
		event_number: number;
		year_dragon_world: number;
		type: "death" | "resurrection" | "deactivation" | "recreation";
		cause: string;
		actors: string[];
		manga_reference: string;
		details: string;
	}>;
	manga_canon_wishes: Array<{
		invocation_number: number;
		era: "Kami-sama" | "Dendé";
		chapter: number;
		volume: number;
		year_published: number;
		summoner: string;
		wish_text: string;
		consequence: string;
		wishes_consumed: number;
	}>;
	primary_sources: Array<{
		work: string;
		nature: string;
		authority: string;
		citations: string[];
	}>;
}

export const SHENRON_CONSOLIDATED: ShenronConsolidatedData = {
	character_id: 1090,
	slug: "shenron",
	name: "Shenron",
	name_ja: "神龍",
	name_romaji: "Shen Long / Shenlong",
	title_canon: "Dragon Sacré (神の使い - Messager des Dieux)",
	race_id: 11,
	race_slug: "namek-shenron",
	race_name: "Race de Shenron (神龍)",
	origin_planet_id: 2,
	origin_planet_name: "Terre (Chikyuu)",
	location: "Sanctuaire Céleste (Palais de Kami-sama, Terre)",
	affiliation: "Panthéon divin terrestre",
	creators: [
		{
			name: "Kami-sama (Le Tout-Puissant)",
			role: "Créateur primordial. Insuffle la vie, l'âme et la puissance divine dans la statuette.",
			race: "Namek (Clan du Dragon / Ryūzoku)",
			title: "Dieu de la Terre (ancien)"
		},
		{
			name: "Mr. Popo",
			role: "Artisan céleste. Sculpte minutieusement la maquette originale de Shenron et assure sa réparation après sa destruction par Piccolo Daimaô.",
			race: "Entité céleste de l'Autre Monde",
			title: "Serviteur et gardien du Sanctuaire de Dieu"
		},
		{
			name: "Dendé",
			role: "Second créateur et bienfaiteur. Recrée et modernise Shenron après la fusion de Kami-sama avec Piccolo, élevant le nombre de vœux à 3.",
			race: "Namek (Clan du Dragon / Ryūzoku)",
			title: "Dieu de la Terre (actuel)"
		}
	],
	dragon_balls: {
		count: 7,
		diameter_cm: 7.5,
		color: "Orange translucide ambré avec étoiles rouges incrustées",
		stars: "De une à sept étoiles à cinq branches",
		summon_chant_ja: "いでよ神龍、そして願いをかなえたまえ！",
		summon_chant_romaji: "Ide yo Shenron, soshite negai o kanae tamae!",
		summon_chant_fr: "Sors, Shenron ! Et réalise mon souhait ! (ou : Apparais, Shenron, et exauce mon vœu !)",
		appearance_phenomenon: "Le ciel diurne s'obscurcit instantanément sur toute la planète, plongée dans une obscurité totale ponctuée d'éclairs dorés et de grondements de tonnerre."
	},
	rules: {
		wishes_count_kami_sama: 1,
		wishes_count_dende: 3,
		mass_resurrection_cost_dende: 2,
		cooldown_full_year: 1,
		cooldown_partial_months_per_wish: 4,
		natural_death_restriction: "Shenron ne peut ressusciter une personne décédée de causes naturelles (vieillesse, maladie incurable).",
		one_time_resurrection_limit: "Shenron ne peut ressusciter un même individu qu'une seule et unique fois dans son existence (règle absolue maintenue sous Kami-sama et Dendé).",
		one_year_mass_resurrection_limit: "Shenron peut ressusciter une multitude de personnes à la fois, sous condition que leur décès remonte à moins d'un an terrestre.",
		creator_power_ceiling: "Shenron ne peut exaucer un souhait qui dépasse la puissance magique ou martiale de son créateur (impuissant à détruire les Saiyans ou Freezer).",
		power_consent_rule: "Shenron ne peut affecter ou déplacer contre son gré un être dont la puissance surpasse celle de son créateur.",
		moral_neutrality: "Shenron est d'une neutralité éthique absolue : il exauce le vœu du premier être qui formule une demande intelligible après l'invocation."
	},
	deaths_and_rebirths: [
		{
			event_number: 1,
			year_dragon_world: 753,
			type: "death",
			cause: "Détruit par un rayon d'énergie buccal tiré par le Roi Démon Piccolo (Piccolo Daimaô) immédiatement après l'exaucement de son souhait de jeunesse.",
			actors: ["Piccolo Daimaô"],
			manga_reference: "Manga Dragon Ball Tome 13, Chapitre 148",
			details: "Piccolo Daimaô élimine le dragon pour empêcher quiconque de formuler un contre-vœu."
		},
		{
			event_number: 2,
			year_dragon_world: 753,
			type: "resurrection",
			cause: "Mr. Popo recolle les morceaux de la statuette brisée et Kami-sama lui réinsuffle l'énergie vitale sur le Sanctuaire Céleste.",
			actors: ["Kami-sama", "Mr. Popo", "Son Goku"],
			manga_reference: "Manga Dragon Ball Tome 14, Chapitre 165",
			details: "Impressionné par la bravoure et la pureté de Son Goku, Kami-sama accorde la renaissance du dragon."
		},
		{
			event_number: 3,
			year_dragon_world: 762,
			type: "deactivation",
			cause: "Mort de Piccolo tué par Nappa, provoquant la mort liée de Kami-sama.",
			actors: ["Nappa", "Piccolo", "Kami-sama"],
			manga_reference: "Manga Dragon Ball Tome 18, Chapitre 214-215",
			details: "La perte de Kami-sama désactive instantanément les Dragon Balls qui se transforment en vulgaires pierres."
		},
		{
			event_number: 4,
			year_dragon_world: 762,
			type: "resurrection",
			cause: "Résurrection de Kami-sama sur Terre grâce au vœu formulé auprès de Porunga sur Namek ressuscitant le Grand Doyen Saichôrô.",
			actors: ["Porunga", "Dendé", "Kami-sama", "Mr. Popo"],
			manga_reference: "Manga Dragon Ball Tome 28, Chapitre 329",
			details: "Kami-sama revenant à la vie, Shenron et les Dragon Balls redeviennent immédiatement opérationnels."
		},
		{
			event_number: 5,
			year_dragon_world: 767,
			type: "deactivation",
			cause: "Fusion définitive de Kami-sama avec Piccolo face à la menace des Cyborgs et de Cell.",
			actors: ["Kami-sama", "Piccolo"],
			manga_reference: "Manga Dragon Ball Tome 30, Chapitre 356-360",
			details: "Kami-sama renonce à sa divinité pour redevenir un être unique avec Piccolo, désactivant définitivement la première incarnation de Shenron."
		},
		{
			event_number: 6,
			year_dragon_world: 767,
			type: "recreation",
			cause: "Dendé est amené sur Terre par Son Goku pour devenir le nouveau Dieu et recrée Shenron en améliorant ses pouvoirs.",
			actors: ["Dendé", "Son Goku", "Mr. Popo"],
			manga_reference: "Manga Dragon Ball Tome 33, Chapitre 393-394",
			details: "Dendé retouche la statuette et dote Shenron de la capacité d'accorder 3 vœux au lieu d'un seul."
		},
		{
			event_number: 7,
			year_dragon_world: 774,
			type: "resurrection",
			cause: "Restauration de la Terre et des Dragon Balls par Porunga après la destruction de la Terre par Pure Buu.",
			actors: ["Porunga", "Dendé", "Vegeta"],
			manga_reference: "Manga Dragon Ball Tome 42, Chapitre 513-517",
			details: "Shenron est invoqué sur Terre restaurée pour effacer le souvenir de Majin Buu dans l'esprit des Terriens."
		}
	],
	manga_canon_wishes: [
		{
			invocation_number: 1,
			era: "Kami-sama",
			chapter: 20,
			volume: 2,
			year_published: 1985,
			summoner: "Oolong",
			wish_text: "Donne-moi une culotte de fille !",
			consequence: "Empêche Pilaf de devenir le maître du monde.",
			wishes_consumed: 1
		},
		{
			invocation_number: 2,
			era: "Kami-sama",
			chapter: 110,
			volume: 10,
			year_published: 1987,
			summoner: "Upa",
			wish_text: "Ressuscite mon père Bora !",
			consequence: "Bora, assassiné par le mercenaire Tao Pai Pai au pied de la Tour Karin, revient à la vie.",
			wishes_consumed: 1
		},
		{
			invocation_number: 3,
			era: "Kami-sama",
			chapter: 148,
			volume: 13,
			year_published: 1988,
			summoner: "Piccolo Daimaô",
			wish_text: "Rends-moi ma jeunesse éternelle et ma force d'autrefois !",
			consequence: "Piccolo Daimaô retrouve sa vigueur maximale et détruit ensuite Shenron.",
			wishes_consumed: 1
		},
		{
			invocation_number: 4,
			era: "Kami-sama",
			chapter: 165,
			volume: 14,
			year_published: 1988,
			summoner: "Bulma, Yamcha, Oolong",
			wish_text: "Ressuscite toutes les personnes innocentes tuées par Piccolo Daimaô et ses sbires !",
			consequence: "Krillin, Kamé Sennin (Roshi) et Chaozu reviennent à la vie.",
			wishes_consumed: 1
		},
		{
			invocation_number: 5,
			era: "Kami-sama",
			chapter: 212,
			volume: 18,
			year_published: 1989,
			summoner: "Kamé Sennin (Muten Roshi)",
			wish_text: "Ressuscite Son Goku !",
			consequence: "Son Goku est ressuscité pour affronter les Saiyans Vegeta et Nappa.",
			wishes_consumed: 1
		},
		{
			invocation_number: 6,
			era: "Kami-sama",
			chapter: 329,
			volume: 28,
			year_published: 1991,
			summoner: "Mr. Popo (sur ordre de Kami-sama via Kaio)",
			wish_text: "Ressuscite toutes les personnes tuées par Freezer et ses sbires sur la planète Namek !",
			consequence: "Saichôrô, Vegeta, et tous les Nameks massacrés reviennent à la vie.",
			wishes_consumed: 1
		},
		{
			invocation_number: 7,
			era: "Dendé",
			chapter: 417,
			volume: 35,
			year_published: 1993,
			summoner: "Yamcha",
			wish_text: "Ressuscite toutes les personnes tuées par Cell !",
			consequence: "Trunks du futur et C-17 sont ressuscités (Son Goku refuse étant déjà mort une fois). Consomme l'énergie de 2 vœux.",
			wishes_consumed: 2
		},
		{
			invocation_number: 8,
			era: "Dendé",
			chapter: 418,
			volume: 35,
			year_published: 1993,
			summoner: "Krillin",
			wish_text: "Retire le dispositif d'autodestruction explosif situé dans le corps de C-17 et C-18 !",
			consequence: "Les bombes internes des cyborgs sont neutralisées sans altérer leurs composants cybernétiques.",
			wishes_consumed: 1
		},
		{
			invocation_number: 9,
			era: "Dendé",
			chapter: 453,
			volume: 38,
			year_published: 1994,
			summoner: "Bulma",
			wish_text: "Ressuscite toutes les personnes mortes aujourd'hui au 25e Tenkaichi Budokai !",
			consequence: "Les victimes innocentes massacrées par Majin Vegeta sont ramenées à la vie. Seul 1 vœu est utilisé ; les deux autres sont mis en réserve, réduisant le délai de recharge à 4 mois.",
			wishes_consumed: 1
		},
		{
			invocation_number: 10,
			era: "Dendé",
			chapter: 517,
			volume: 42,
			year_published: 1995,
			summoner: "Son Goku et les guerriers Z",
			wish_text: "Efface de la mémoire de tous les Terriens le souvenir de Majin Buu et des ravages qu'il a causés !",
			consequence: "L'humanité oublie les méfaits de Buu, permettant à Mister Buu de vivre paisiblement avec Mister Satan sur Terre.",
			wishes_consumed: 1
		}
	],
	primary_sources: [
		{
			work: "Dragon Ball Manga Original (42 tomes)",
			nature: "Canon Absolu (Akira Toriyama, Shueisha)",
			authority: "Source primaire suprême de l'univers",
			citations: [
				"Tome 2, Chapitre 20 : Première apparition et invocation de Shenron",
				"Tome 10, Chapitre 110 : Résurrection de Bora",
				"Tome 13, Chapitre 148 : Meurtre de Shenron par Piccolo Daimaô",
				"Tome 14, Chapitre 165 : Résurrection de Shenron par Kami-sama et Mr. Popo",
				"Tome 18, Chapitres 212-215 : Mort de Piccolo/Kami-sama et résurrection de Goku",
				"Tome 28, Chapitre 329 : Résurrection de masse des victimes de Freezer",
				"Tome 30, Chapitre 356-360 : Fusion Kami-sama et Piccolo",
				"Tome 33, Chapitres 393-394 : Avènement de Dendé et réactivation de Shenron à 3 vœux",
				"Tome 35, Chapitres 417-418 : Vœux d'après Cell Games et dépose des bombes",
				"Tome 38, Chapitre 453 : Résurrection partielle et réserve de vœux (4 mois)",
				"Tome 42, Chapitre 517 : Oubli collectif de Majin Buu"
			]
		},
		{
			work: "Dragon Ball Daizenshuu 4 — World Guide (1995)",
			nature: "Extension Officielle Supervisée (Bird Studio / Shueisha)",
			authority: "Encyclopédie officielle de l'univers et de la cosmologie",
			citations: [
				"Planche 29 : Définition des Dragon Balls, rôle mystique et nature de Shenron",
				"Planche 30 : Processus de dispersion céleste et transformation en pierre",
				"Planche 31 : Genèse et fabrication de Shenron par Popo et Kami-sama",
				"Planche 32 : Histoire des destructions de Shenron et règle des limites du Créateur",
				"Planche 33 : Comparaison comparative Shenron vs Porunga et règles de recharge proportionnelle",
				"Planche 35 : Récapitulatif officiel des 22 vœux canoniques exaucés dans le manga",
				"Planche 47 : Capacités créatrices du Clan du Dragon (Ryūzoku) chez les Nameks"
			]
		},
		{
			work: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten (1996)",
			nature: "Extension Officielle Supervisée (Bird Studio / Shueisha)",
			authority: "Grand dictionnaire encyclopédique de référence des personnages et concepts",
			citations: [
				"Planche 18 : Chronologie des événements de l'an 749 à 750",
				"Planche 29 : Chronologie de la fin de Majin Buu et amnésie collective",
				"Planche 44-45 : Lexique namek, invocation et comparaison Porunga/Shenron",
				"Planche 46 : Biologie des Nameks du Clan du Dragon et fabrication des orbes",
				"Planche 57 : Fiche de Kami-sama, télépathie et insufflation d'âme dans le dragon",
				"Planche 67 : Fiche encyclopédique majeure de Shenron (conditions d'invocation, règles sous Dendé, interdictions)"
			]
		},
		{
			work: "Dragon Ball Daizenshuu 2 — Story Guide (1995)",
			nature: "Extension Officielle Supervisée (Bird Studio / Shueisha)",
			authority: "Guide narratif des tomes et des sagas du manga",
			citations: [
				"Planche 168 : Rôle de Mr. Popo comme sculpteur de la maquette et Dendé comme invocateur de génie"
			]
		}
	]
};

async function main(): Promise<void> {
	console.log("=== BXC DRAGON BALL ENRICHMENT ENGINE ===");
	console.log("Cible : Shenron (ID 1090 dans dragonballfr.com)");
	console.log("Doctrine : Manga 42 tomes (Akira Toriyama) + Daizenshuu 2, 4 & 7\n");

	const outDir = resolve(process.cwd(), "data");
	await mkdir(outDir, { recursive: true });

	const sqliteOutPath = join(outDir, "shenron-enriched.sqlite");
	const jsonOutPath = join(outDir, "shenron-enriched.json");

	// 1. Définition des documents d'enrichissement pour le Dataset BXC
	const mainArticleMarkdown = `# Shenron (神龍) — Dossier Canonique Consolidé

## 1. Identité et Enracinement Cosmique
- **Nom officiel** : Shenron (神龍, Shen Long, Shenlong)
- **Prononciation japonaise** : シェンロン (Shenron)
- **Titre divin** : Dragon Sacré (*Kami no tsukai* — 神の使い, messager des Dieux)
- **Race (ID 11)** : **Race de Shenron** (\`namek-shenron\`). Entité magique et divine propre aux créations du Clan du Dragon namekien.
- **Planète d'origine (ID 2)** : **Terre** (*Chikyuu*, Univers 7).
- **Lieu de résidence / point d'ancrage** : Le Sanctuaire Céleste (Palais de Kami-sama), situé au-dessus de la Tour Karin.
- **Affiliation** : Panthéon divin de la Terre.
- **Genre** : Asexué (masculin par convention grammaticale et vocale).
- **Ki mesuré** : Non applicable numériquement. Shenron ne possède pas une puissance de combat martiale classique, mais un pouvoir magique divin directement corrélé à l'énergie de son créateur.

---

## 2. Genèse et Confection : Le rôle de Kami-sama, Mr. Popo et Dendé
Le Daizenshuu 4 (planche 31) et le Daizenshuu 2 (planche 168) dévoilent le secret séculaire de la naissance de Shenron :
1. **La sculpture de la maquette physique** : C'est **Mr. Popo**, serviteur du Tout-Puissant, qui façonne de ses mains une petite maquette en argile/pierre représentant un dragon oriental longiligne.
2. **L'insufflation de l'âme et de la vie** : **Kami-sama** (le Tout-Puissant), un Namek de génie issu du Clan du Dragon (*Ryūzoku*), insuffle son énergie vitale et une âme divine dans la maquette placée sous une cloche de verre. Dès que l'énergie est suffisante, la maquette s'illumine et le dragon naît, lié aux 7 Dragon Balls terrestres.
3. **La transcendance par Dendé** : Après la réunification de Kami-sama avec Piccolo durant la saga Cell, Son Goku fait venir le jeune prodige namek **Dendé**. Dendé prend la statuette réparée par Mr. Popo, prononce les incantations du Clan du Dragon et décuple les capacités de Shenron, lui permettant d'exaucer **trois souhaits**.

---

## 3. Les Boules de Cristal Terrestres & l'Invocation
- **Nombre d'orbes** : 7 sphères de cristal de couleur ambre orangé.
- **Dimensions** : Diamètre d'environ **7,5 cm** (à l'échelle d'une paume de main, contrastant avec les gigantesques Dragon Balls de Namek de la taille d'un rocher).
- **Inscriptions** : Étoiles translucides rouges de une à sept.
- **Formule rituelle d'invocation** :
  - Japonais : 「**いでよ神龍、そして願いをかなえたまえ！**」
  - Rōmaji : *Ide yo Shenron, soshite negai o kanae tamae!*
  - Français officiel : « **Sors, Shenron ! Et réalise mon souhait !** » (ou « *Apparais Shenron et exauce mon vœu !* »)
- **Phénomène d'apparition** : Dès que la formule est prononcée, le ciel diurne de toute la planète s'obscurcit instantanément dans une nuit d'encre zébrée d'orages et d'éclairs dorés. Un rayon d'énergie lumineuse jaillit des boules pour matérialiser le gigantesque corps serpentiforme vert aux yeux rougeoyants.

---

## 4. Les Règles Canoniques Intégrales des Souhaits (Toriyama + Daizenshuu 4 & 7)

1. **Capacité numérique de souhaits** :
   - *Ère Kami-sama* : **1 vœu unique** par rassemblement des sept boules (Daizenshuu 4 p. 31-32, Daizenshuu 7 p. 67).
   - *Ère Dendé* : **3 vœux distincts** par invocation (Manga chap. 394).
   - *Pénalité de résurrection collective sous Dendé* : Si un vœu demande de ressusciter un groupe ou une multitude de défunts simultanément, ce vœu consomme la dépense énergétique de **deux vœux**, ne laissant qu'un seul vœu supplémentaire pour la session (maximum de 2 vœux au lieu de 3, Daizenshuu 7 p. 67).

2. **Temps de léthargie et de dispersion** :
   - Après exaucement, les boules s'élèvent dans le ciel, se dispersent violemment aux quatre coins du globe terrestre et se transforment en simples pierres grises inertes pendant **un an terrestre (365 jours)**.
   - *Règle de réserve sous Dendé* : Si tous les vœux ne sont pas consommés, le temps de recharge est raccourci de manière strictement proportionnelle. Si un seul vœu sur trois est formulé, les boules redeviennent actives au bout de **4 mois** (1/3 d'année, observé au chap. 453-454 lors de la saga Boo).

3. **Interdiction formelle de résurrection des morts naturelles** :
   - Shenron est strictement incapable de ramener à la vie une personne décédée de causes naturelles (vieillesse, maladie comme la défaillance cardiaque virale de Goku dans le futur de Trunks).

4. **Règle d'unicité absolue de la résurrection** :
   - Shenron **ne peut ressusciter une même personne qu'une seule et unique fois**. Toute personne déjà ramenée par Shenron ne peut plus jamais l'être par lui en cas de nouveau décès (Krillin, Kamé Sennin, Chaozu). Cette restriction le distingue fondamentalement de Porunga sur Namek, qui peut ressusciter le même individu indéfiniment.

5. **Résurrection de masse avec plafond temporel** :
   - Contrairement au Porunga original qui ne pouvait ressusciter qu'un seul mort par vœu, Shenron peut ressusciter un **nombre illimité d'individus** en un seul vœu (« toutes les victimes de Piccolo Daimaô », « toutes les victimes de Freezer », « toutes les victimes de Cell »), sous réserve expresse que le décès soit survenu il y a **moins d'un an** (chapitre 329).

6. **Le Plafond de puissance du Créateur** :
   - Le Daizenshuu 4 (planche 32) l'énonce clairement : *« Un vœu dépassant le pouvoir de son créateur ne peut être exaucé »* (自分を生み出した神様の力を超えてしまう願いは、神龍にも叶えられない). Shenron ne peut donc pas détruire des ennemis dont la force surpasse celle de Kami-sama ou Dendé (incapable d'anéantir Nappa, Vegeta, Freezer ou les Cyborgs).

7. **Règle du consentement des êtres supérieurs** :
   - Shenron ne peut contraindre ni téléporter contre son gré un individu dont la puissance surpasse celle du Créateur (Son Goku refuse ainsi d'être rapatrié sur Terre après Namek).

8. **Neutralité éthique absolue** :
   - Shenron ne juge pas la valeur morale de celui qui l'invoque ni la nature du souhait. Il exauce sans distinction le souhait d'un héros (ressusciter des innocents), d'un despote sanguinaire (Piccolo Daimaô demandant la jeunesse) ou un caprice comique (Oolong demandant une culotte).

---

## 5. Chronologie des Morts, Disparitions et Résurrections de Shenron

1. **An 753 — Assassinat par Piccolo Daimaô** (*Manga Tome 13, Chapitre 148*) :
   Aussitôt son vœu de jeunesse exaucé, le Roi Démon Piccolo crache une redoutable vague déferlante buccale d'énergie qui pulvérise Shenron pour anéantir les boules et empêcher ses ennemis de les utiliser.
2. **An 753 — Résurrection par Kami-sama et Mr. Popo** (*Manga Tome 14, Chapitre 165*) :
   Mr. Popo recolle la statuette en morceaux et Kami-sama lui redonne vie sur le Sanctuaire Céleste en récompense de la bravoure et du cœur pur de Son Goku.
3. **An 762 — Désactivation par la mort de Piccolo face à Nappa** (*Manga Tome 18, Chapitres 214-215*) :
   Piccolo s'interpose pour protéger Gohan du bombardement de Nappa et périt. Lié à lui, Kami-sama meurt en même temps, transformant les Dragon Balls terrestres en pierre inerte.
4. **An 762 — Réactivation via Porunga sur Namek** (*Manga Tome 28, Chapitre 329*) :
   Dendé formule le souhait auprès de Porunga de ressusciter Saichôrô, ce qui ressuscite Kami-sama sur Terre et restaure instantanément Shenron.
5. **An 767 — Extinction définitive de la première version par fusion** (*Manga Tome 30, Chapitres 356-360*) :
   Face aux Cyborgs C-17/C-18 et à l'émergence de Cell, Kami-sama fusionne définitivement avec Piccolo, redevenant l'unique être namekien d'antan et abandonnant son statut divin.
6. **An 767 — Renaissance et transcendance par Dendé** (*Manga Tome 33, Chapitres 393-394*) :
   Son Goku va chercher Dendé sur la Nouvelle Namek. Le jeune Namek du Clan du Dragon retouche la maquette et dote Shenron de la capacité d'accorder trois vœux.
7. **An 774 — Restauration après la destruction de la Terre par Majin Buu** (*Manga Tome 42, Chapitres 513-517*) :
   Pure Buu fait exploser la Terre. Après la résurrection de la planète par Porunga, Shenron est invoqué pour effacer les souvenirs du monstre dans l'esprit des humains.

---

## 6. Registre Exhaustif des 10 Invocations Canoniques dans le Manga de Toriyama

| N° | Chapitre / Tome | Année | Invocateur | Vœu Formulé | Conséquence Canonique | Coût |
|---|---|---|---|---|---|---|
| **1** | Chap. 20 (T. 2) | 1985 | Oolong | « Donne-moi une culotte de fille ! » | Annihile le plan de domination de Pilaf. | 1 |
| **2** | Chap. 110 (T. 10) | 1987 | Upa | « Ressuscite mon père Bora ! » | Bora, tué par Tao Pai Pai, revient à la vie. | 1 |
| **3** | Chap. 148 (T. 13) | 1988 | Piccolo Daimaô | « Rends-moi ma jeunesse éternelle ! » | Piccolo Daimaô retrouve sa force maximale puis tue Shenron. | 1 |
| **4** | Chap. 165 (T. 14) | 1988 | Bulma, Yamcha, Oolong | « Ressuscite les victimes de Piccolo Daimaô ! » | Krillin, Kamé Sennin et Chaozu ressuscitent. | 1 |
| **5** | Chap. 212 (T. 18) | 1989 | Kamé Sennin | « Ressuscite Son Goku ! » | Goku revient du Royaume des Morts pour contrer les Saiyans. | 1 |
| **6** | Chap. 329 (T. 28) | 1991 | Mr. Popo | « Ressuscite les victimes de Freezer sur Namek ! » | Saichôrô, Vegeta et les Nameks reviennent à la vie. | 1 |
| **7** | Chap. 417 (T. 35) | 1993 | Yamcha (Dendé) | « Ressuscite les personnes tuées par Cell ! » | Trunks du futur et C-17 reviennent à la vie. | 2 |
| **8** | Chap. 418 (T. 35) | 1993 | Krillin (Dendé) | « Retire les bombes dans le corps de C-17 et C-18 ! » | Les explosifs cybernétiques sont détruits sans blesser les cyborgs. | 1 |
| **9** | Chap. 453 (T. 38) | 1994 | Bulma (Dendé) | « Ressuscite les victimes du 25e Tenkaichi Budokai ! » | Victimes de Majin Vegeta ressuscitées. 1 seul vœu utilisé (recharge 4 mois). | 1 |
| **10**| Chap. 517 (T. 42) | 1995 | Son Goku & Z-Fighters | « Efface le souvenir de Majin Buu chez les Terriens ! » | L'humanité oublie le tyran, permettant à Mister Buu de vivre en paix. | 1 |

---

## 7. Preuves et Références Primaires
- **Manga Dragon Ball (Akira Toriyama, 42 tomes)** : Chapitres 1, 20, 21, 110, 111, 148, 149, 165, 212, 214, 215, 329, 356, 360, 393, 394, 417, 418, 453, 517.
- **Dragon Ball Daizenshuu 4 — World Guide (1995)** : Planches 29, 30, 31, 32, 33, 35, 47.
- **Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten (1996)** : Planches 18, 29, 44, 45, 46, 57, 67.
- **Dragon Ball Daizenshuu 2 — Story Guide (1995)** : Planche 168.
`;

	const items = [
		{
			url: "https://dragonballfr.com/wiki/personnages/shenron",
			title: "Shenron (神龍) — Dossier Canonique Consolidé & Enrichi",
			markdown: mainArticleMarkdown,
			status: 200,
			metadata: {
				entity_id: 1090,
				category: "characters",
				slug: "shenron",
				race_id: 11,
				race_slug: "namek-shenron",
				origin_planet_id: 2,
				origin_planet_slug: "terre",
				affiliation: "Divinité",
				authoritative_tier: "CANON_ABSOLU + EXTENSION_OFFICIELLE",
				last_curated: new Date().toISOString()
			},
			data: SHENRON_CONSOLIDATED
		},
		{
			url: "https://dragonballfr.com/wiki/dragons#shenron",
			title: "Dragon Sacré Shenron — Spécifications Techniques et Comparatif Porunga",
			markdown: `# Dragon Sacré Shenron (神龍 - シェンロン)

- **Nombre d'orbes** : 7 sphères de 7,5 cm de diamètre.
- **Créateurs successifs** : Kami-sama (Dieu de la Terre) puis Dendé (Nameks du Clan du Dragon).
- **Artisan physique** : Mr. Popo (statue en argile).
- **Nombre de vœux** : 1 (Kami-sama) -> 3 (Dendé).
- **Délai de léthargie** : 1 an (réduit à 4 mois si 1 seul vœu utilisé sous Dendé).
- **Règles clés** :
  1. Pas de résurrection de morts naturelles.
  2. Une seule résurrection par personne.
  3. Résurrection de masse possible (décès < 1 an).
  4. Plafond de puissance du Créateur.
  5. Coût de 2 vœux pour résurrection de masse sous Dendé.`,
			status: 200,
			metadata: {
				category: "dragons",
				dragon_name: "Shenron",
				ball_count: 7,
				diameter_cm: 7.5
			},
			data: SHENRON_CONSOLIDATED.dragon_balls
		},
		{
			url: "https://dragonballfr.com/wiki/races/namek-shenron",
			title: "Race de Shenron (神龍) — Entités et Dragons Divins Créés par les Nameks",
			markdown: `# Race de Shenron (神龍) — ID 11 dans dragonballfr.com

La Race de Shenron regroupe les dragons sacrés nés de la magie du Clan du Dragon (*Ryūzoku*) des Nameks.
- **Caractéristiques** : Êtres divins créés à partir de représentations sculptées (Mr. Popo pour la Terre) dans lesquelles un Namek prodigieux insuffle son ki et son âme.
- **Membres répertoriés** : Shenron (Terre), Porunga (Namek), Toronbo (Céréale).
- **Lien vital** : Leur existence est directement rattachée à la vie de leur créateur namekien.`,
			status: 200,
			metadata: {
				category: "races",
				race_id: 11,
				race_slug: "namek-shenron",
				name_ja: "神龍"
			},
			data: {
				id: 11,
				slug: "namek-shenron",
				name: "Race de Shenron",
				name_ja: "神龍",
				members: ["Shenron", "Porunga", "Toronbo"]
			}
		},
		{
			url: "https://dragonballfr.com/wiki/databooks/daizenshuu-shenron-compilation",
			title: "Daizenshuu 2, 4 & 7 — Anthologie des Textes Officiels et Planches Canoniques",
			markdown: `# Daizenshuu 2, 4 & 7 — Les Preuves Imprimées sur Shenron

## Daizenshuu 4 (World Guide), Planche 31 : Confection de Shenron
> 神が生み出す神龍の作り方
> 神龍は物語中に2度消滅し、神様とデンデによって作り直されている。ではその作り方を見てみよう。まず、神様の付き人であるミスター・ポポが、小さな神龍の模型を作る。その模型に神様が力を注ぎ込む。十分なパワーがたまれば完成だ。
*Traduction :* La méthode de création de Shenron par Dieu. Shenron a disparu deux fois au cours de l'histoire et a été recréé par Kami-sama et Dendé. Voyons comment il est fabriqué : d'abord, Mr. Popo, le serviteur de Dieu, façonne une petite maquette de Shenron. Ensuite, Dieu y insuffle ses pouvoirs. Une fois une puissance suffisante accumulée, le dragon est achevé.

## Daizenshuu 4 (World Guide), Planche 32 : Limites du Pouvoir
> 神龍にも不可能なことがある。自分を生み出した神様の力を超えてしまう願いは、神龍にも叶えられない。
*Traduction :* Il y a des choses impossibles même pour Shenron. Un souhait qui dépasse les pouvoirs du Dieu qui l'a créé ne peut pas être exaucé.

## Daizenshuu 7 (Dragon Ball Daijiten), Planche 67 : Fiche Encyclopoédique de Shenron
> ミスター・ポポが作った龍の模型に神様が魂を吹き込んで作ってある。7つのDBを集め「いでよ神龍！そして願いを叶えたまえ！」と呪文を唱えると、たとえ昼間でも空が突然真っ暗になり、稲妻と共に巨大な東洋の龍の姿が現れ、どんな願いでもひとつだけ叶えてくれる。神様とピッコロが融合し、デンデが神様になってからは、死人の復活を願う場合はふたつまで、それ以外の願いは最高3つまで叶うようになった。`,
			status: 200,
			metadata: {
				category: "databooks",
				daizenshuu: [2, 4, 7],
				verification: "Transcrite du japonais et vérifiée"
			},
			data: SHENRON_CONSOLIDATED.primary_sources
		},
		{
			url: "https://dragonballfr.com/wiki/wishes/manga-canon-shenron",
			title: "Registre des 10 Invocations Canoniques de Shenron dans les 42 Tomes de Toriyama",
			markdown: `# Registre des 10 Invocations Canoniques de Shenron

Consolidation rigoureuse des 10 apparitions de Shenron dans les 42 tomes du manga original d'Akira Toriyama :
1. Chapitre 20 (Tome 2) : Culotte d'Oolong contre Pilaf.
2. Chapitre 110 (Tome 10) : Résurrection de Bora par Upa.
3. Chapitre 148 (Tome 13) : Jeunesse de Piccolo Daimaô (suivi du meurtre de Shenron).
4. Chapitre 165 (Tome 14) : Résurrection des victimes de Piccolo Daimaô (Krillin, Roshi, Chaozu).
5. Chapitre 212 (Tome 18) : Résurrection de Son Goku pour affronter les Saiyans.
6. Chapitre 329 (Tome 28) : Résurrection des victimes de Freezer sur Namek.
7. Chapitre 417 (Tome 35) : Résurrection des victimes de Cell (Trunks, C-17 - consomme 2 vœux).
8. Chapitre 418 (Tome 35) : Dépose des bombes internes de C-17 et C-18.
9. Chapitre 453 (Tome 38) : Résurrection des victimes de Majin Vegeta (1 vœu utilisé, recharge en 4 mois).
10. Chapitre 517 (Tome 42) : Effacement de Majin Buu dans la mémoire humaine.`,
			status: 200,
			metadata: {
				category: "wishes",
				manga_total_wishes: 10,
				total_wishes_consumed: 11
			},
			data: SHENRON_CONSOLIDATED.manga_canon_wishes
		}
	];

	// 2. Persistance via BXC Dataset
	console.log(`[1/4] Ouverture du Dataset "shenron-enriched" dans ./storage...`);
	const dataset = await Dataset.open("shenron-enriched");
	await dataset.pushData(items);
	console.log(`[✓] ${items.length} items poussés dans le Dataset "shenron-enriched".`);

	// 3. Export vers SQLite avec FTS5
	console.log(`[2/4] Exportation vers SQLite avec index FTS5 -> ${sqliteOutPath}...`);
	const sqliteResult = await dataset.exportToSqlite(sqliteOutPath, {
		tableName: "shenron_enriched",
		fts: true
	});
	console.log(`[✓] SQLite généré avec succès : ${sqliteResult.exported} enregistrements exportés.`);

	// 4. Export vers JSON
	console.log(`[3/4] Exportation vers JSON -> ${jsonOutPath}...`);
	await dataset.exportToJson(jsonOutPath);
	console.log(`[✓] JSON généré avec succès : ${jsonOutPath}`);

	await dataset.close();

	// 5. Upsert dans la base centrale BXC (data/bxc.sqlite) via BxcDB
	console.log(`[4/4] Upsert de la fiche principale dans data/bxc.sqlite via BxcDB.upsertScrape...`);
	const mainBxcDbPath = join(outDir, "bxc.sqlite");
	const bxcDb = new BxcDB(mainBxcDbPath);
	bxcDb.upsertScrape(
		"https://dragonballfr.com/wiki/personnages/shenron",
		"canon-consolidated",
		200,
		mainArticleMarkdown,
		items[0].metadata,
		mainArticleMarkdown,
		SHENRON_CONSOLIDATED,
		null,
		null
	);
	console.log(`[✓] Upsert terminé dans ${mainBxcDbPath}`);

	console.log("\n=== ENRICHISSEMENT SHENRON TERMINÉ AVEC SUCCÈS ===");
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("[FATAL ERROR]", err);
		process.exit(1);
	});
}

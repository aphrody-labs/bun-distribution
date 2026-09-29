#!/usr/bin/env bun
/**
 * @file scripts/ops/merge-transformations.ts
 *
 * Fusionne les transformations similaires ou proches en une fiche canonique de référence :
 * 1. Freezer : fusion de "Forme régressive" (#14), "Forme finale/supérieur" (#15) et "Forme 100% / FULL POWER" (#16)
 *    -> conservé sur #15 : "Métamorphoses de Freezer (Formes 1 à 4 & 100%)"
 * 2. Fusions : fusion de "Fusion Potara" (#8) et "Fusion Métamol" (#9)
 *    -> conservé sur #8 : "Fusion (Danse Métamol & Boucles Potara)"
 * 3. Super Saiyan Blue & Rosé : fusion de "Super Saiyan Blue" (#6) et "Super Saiyan Rosé" (#7)
 *    -> conservé sur #6 : "Super Saiyan Blue (et déclinaison Rosé)"
 * 4. Piccolo géant : fusion de "FORME Géante" (#29) dans "Orange Piccolo" (#26)
 *    -> conservé sur #26 avec intégration de la Gigantification (Kyodaika)
 * 5. Forme Mini (#31) : masqué (vœu externe de rajeunissement/régression et non transformation martiale)
 * 6. Standardisation typographique :
 *    - #2 : "Super Saiyan 2" (au lieu de "SUPER SAIYAN 2 (grade 5)")
 *    - #3 : "Super Saiyan 3" (au lieu de "SUPER SAIYAN 3")
 *    - #13 : "Transformation par absorption (Majin Buu & Cell)"
 *
 * Règle impérative #9 : suppression logique uniquement (visible = false), aucun DELETE physique.
 */

import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
loadEnvConfig(resolve(process.cwd(), "apps/site"));

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

console.log("🐉 \x1b[1;36mShenron — Fusion des Transformations Similaires ou Proches\x1b[0m");
if (!APPLY) console.log("🔍 \x1b[33mMode SIMULATION (--dry-run) : aucune modification en base.\x1b[0m\n");

const ARTICLE_FREEZER = `**Les Métamorphoses de Freezer** (変身, *Henshin*) constituent l'un des mécanismes physiologiques les plus emblématiques de l'univers Dragon Ball. Contrairement aux guerriers Saiyans dont les transformations successives servent à amplifier leur force au-delà de leurs limites naturelles, Freezer utilise ses métamorphoses pour **réduire et restreindre sa puissance colossale** afin de pouvoir la contrôler au quotidien sans anéantir son entourage.

## La mécanique inversée de régression

Né mutant au sein de sa race avec un niveau d'énergie démesuré, Freezer a développé trois formes de régression corporelle pour contenir son flux vital :

1. **Première forme (Forme de base apparente)** : Petite silhouette cornue assise dans son pod de sustentation, affichant une puissance officielle de **530 000 unités** (affirmée par lui-même à Nail sur Namek).
2. **Deuxième forme (Le Colosse cornu)** : Silhouette gigantesque rappelant son père le roi Cold, dotée de longues cornes recourbées. Freezer annonce alors dépasser **1 000 000 d'unités**, transperçant Krilin avant de faire face à Piccolo synchronisé avec Nail.
3. **Troisième forme (L'Alien xénomorphe)** : Crâne oblong et allongé, visage écrasé et protubérances dorsales massives. Sa vitesse et ses salves de kikōha en rafale surclassent Piccolo.

## La Quatrième Forme : La véritable apparence originelle

La prétendue « Forme finale » (*Saishū Keitai*) est en réalité le **corps originel et véritable** de Freezer tel qu'il est né. Dépourvu de cornes, d'armure ou d'excroissances superflues, son corps blanc épuré aux zones pourpres brillantes dégage une aura de terreur absolue. C'est sous cette forme que Freezer massacre Vegeta et affronte Son Gokū, déployant d'abord 50% de sa force (**60 000 000 unités**) pour repousser le Kaiōken x20.

## Le 100% Full Power

Face à Son Gokū métamorphosé en Super Saiyan de la légende, Freezer est contraint de puiser dans ses ultimes réserves pour libérer **100% de son potentiel brut** (120 000 000 unités selon le *Daizenshuu 7*). Sa masse musculaire gonfle de manière spectaculaire au détriment de son endurance, son énergie déclinant rapidement au fil d'un combat titanesque sur une planète Namek condamnée à l'explosion.`;

const ARTICLE_FUSION = `**La Fusion** (合体 / フュージョン, *Gattai / Fyūjon*) est le procédé suprême permettant à deux guerriers d'unir leurs corps, leurs esprits et leurs énergies pour donner naissance à une entité unique dotée d'une puissance infiniment supérieure à la somme arithmétique de leurs forces individuelles. Deux méthodes majeures coexistent dans le canon d'Akira Toriyama : la Danse de Fusion Métamol et les Boucles d'oreilles sacrées Potara.

## 1. La Danse Métamol (Gotenks et Gogeta)

Enseignée à Son Gokū par les extraterrestres du peuple Métamol dans l'Autre Monde, cette méthode exige une synchronisation absolue :
- **Conditions** : Deux combattants de gabarit, de morphologie et de puissance ki rigoureusement équivalents doivent exécuter une chorégraphie symétrique terminée par le contact précis de leurs index tendus.
- **Risques** : Le moindre faux pas ou décalage de posture engendre une fusion ratée grotesque (obèse essoufflé ou vieillard squelettique), obligeant les partenaires à patienter 30 minutes avant de se séparer.
- **Guerriers nés de la danse** : **Gotenks** (union de Son Goten et Trunks, capable d'atteindre le Super Saiyan 3) et **Gogeta** (union de Son Gokū et Vegeta, officialisé dans le film canonique *Dragon Ball Super: Broly*). Les fusions Métamol portent invariablement la tenue traditionnelle de ce peuple (gilet sans manches noir et doré, pantalon blanc et ceinture turquoise).

## 2. Les Boucles d'oreilles Potara (Vegetto et Kaïobito)

Trésor sacré des Kaïō Shin introduit au tome 41 du manga canonique par le Doyen Kaïô Shin :
- **Mécanisme** : Deux êtres placent chacun l'une des boucles sur une oreille opposée (l'un à gauche, l'autre à droite) pour être instantanément attirés et fondus l'un dans l'autre.
- **Avantages** : Aucune contrainte de gabarit ou d'équilibre énergétique n'est requise. Selon le Vieux Kaïô Shin, son efficacité surpasse largement la danse de fusion, d'autant plus amplifiée par le « Boost de Rivalité » unissant deux rivaux jurés comme Gokū et Vegeta.
- **Durée et limites** : Si la fusion est éternelle pour des divinités (comme Kaïobito), Gowasu révèle dans *Dragon Ball Super* qu'elle est limitée à **une heure pour les mortels**, une durée qui peut chuter drastiquement en cas de consommation massive d'énergie divine (comme avec Vegetto Blue face à Zamasu fusionné).`;

const ARTICLE_SSJ_BLUE = `**Le Super Saiyan Blue** (超サイヤ人ブルー, *Chō Saiyajin Burū*), initialement baptisé **Super Saiyan God Super Saiyan** (SSGSS), est la transcendance martiale obtenue en combinant la force du Super Saiyan classique avec la quiétude et la pureté du Ki Divin (*Shin-ki*).

## Genèse et Maîtrise auprès de Whis

Introduit dans le film *La Résurrection de « F »* (2015) puis développé dans *Dragon Ball Super*, cet état est forgé par Son Gokū et Vegeta sous la tutelle de l'ange Whis. Le principe fondamental réside dans le scellement hermétique de l'énergie : là où les transformations dorées traditionnelles laissent fuiter le ki sous forme d'une aura ardente volatile, le Super Saiyan Blue concentre et retient 100% de la puissance à l'intérieur du corps du combattant.

## Puissance, Kaiōken et forme Parfaite

La forme se caractérise par une chevelure et des pupilles bleu azur profond enveloppées d'une double aura scintillante. Elle offre une vitesse, une endurance et une force de frappe capables de rivaliser avec les Dieux de la Destruction :
- Dans la série animée, Son Gokū parvient à y superposer le **Kaiōken** jusqu'au facteur x20.
- Dans le manga d'Akira Toriyama et Toyotarō, Gokū et Vegeta développent le **Super Saiyan Blue Parfait** (*Kansei Super Saiyan Blue*), éliminant toute déperdition résiduelle de ki au prix d'une tension musculaire extrême.
- Vegeta repousse encore ces limites lors du Tournoi du Pouvoir pour éveiller le **Super Saiyan Blue Évolué** (*SSB Shinka*).

## La variante divine innée : Le Super Saiyan Rosé

Lorsque cette même transformation est atteinte par un être possédant un **statut naturel de dieu de la création** — en l'occurrence l'apprenti Kaïō Shin Zamasu occupant le corps volé de Son Gokū (**Goku Black**) —, la chevelure prend une teinte rose pastel étincelante (*Super Saiyan Rosé*). Comme l'ont confirmé Akira Toriyama et le manga canonique, le Rosé est l'exact équivalent du Super Saiyan Blue, sa coloration spécifique traduisant la nature divine originelle et la noirceur d'âme de Zamasu.`;

const ARTICLE_ORANGE_PICCOLO = `**Orange Piccolo** (オレンジ・ピッコロ, *Orenji Pikkoro*) est la transcendance physique et spirituelle accordée au guerrier Namek Piccolo par le dragon sacré Shenron dans le film canonique *Dragon Ball Super: Super Hero* (2022).

## Le cadeau bonus du Dragon Sacré

Désireux de protéger la Terre et Pan face à la renaissance de l'armée du Red Ribbon et à leurs cyborgs Gamma, Piccolo demande à Shenron de réveiller son potentiel latent, à l'image du rituel accompli jadis par le Grand Chef sur Namek. Après avoir accordé cet éveil (qui lisse sa peau et supprime les stries de ses bras), Shenron précise avec malice lui avoir octroyé **« un petit bonus supplémentaire »**.

## Métamorphose et Puissance Divine

Face à la détresse de Gohan et à la menace des Gamma, Piccolo libère ce don :
- Sa peau prend une teinte orange vif éclatante et ses antennes se dressent fièrement vers le haut.
- Ses yeux s'embrasent d'un iris rougeoyant et le symbole namek de l'arbre sacré Ajissa s'illumine sur son dos.
- Sa carrure et sa musculature deviennent herculéennes, lui permettant de neutraliser Gamma 2 d'un seul coup sans le moindre effort.

## La Gigantification Namek (*Kyodaika*)

Pour affronter le monstrueux Cell Max dont le gigantisme menace d'écraser ses alliés, Piccolo réactive son aptitude ancestrale de **Gigantification** (*Kyodaika*), technique qu'il avait déjà déployée lors du 23e Tenkaichi Budokai face à Son Gokū. Devenu un géant orange aux proportions colossales, Piccolo immobilise le monstre et offre à Son Gohan l'opportunité décisive de décocher son Makankōsappō en mode Beast. Akira Toriyama a affirmé avec fierté avoir conçu cette forme pour que son personnage fétiche puisse enfin égaler la puissance des guerriers Saiyans.`;

const ARTICLE_ABSORPTION = `**La Transformation par absorption** (吸収, *Kyūshū*) est un mode d'évolution biologique et magique propre à certains des antagonistes les plus redoutables de Dragon Ball, au premier rang desquels figurent **Cell** et **Majin Buu**. Au lieu d'élever leur ki par un entraînement martial, ces entités intègrent physiquement d'autres guerriers pour en assimiler la puissance, les techniques et les traits intellectuels.

## L'absorption biotechnologique de Cell

Conçu par le Dr Gero à partir des cellules des plus grands combattants de l'univers, le cyborg organique Cell possède un dard caudal préhensile conçu pour drainer l'énergie vitale :
- **Forme imparfaite** : Cell absorbe la biomasse de centaines de milliers d'humains pour élever son niveau de base.
- **Forme semi-parfaite** : L'ingestion complète du cyborg **C-17** déclenche une première métamorphose radicale, doublant sa carrure et lui conférant une puissance écrasante.
- **Forme parfaite** : L'absorption finale de **C-18** lui permet d'atteindre la perfection biologique absolue (*Kanzentai*), dotée d'une vitesse et d'une force inouïes.

## L'assimilation magique de Majin Buu

Créature magique primordiale aux propriétés élastiques infinies, Majin Buu utilise des fragments détachés de sa propre chair gélatineuse pour envelopper et engloutir ses victimes :
- **Buu originel (Kid Buu)** avait jadis absorbé le Grand Kaïô Shin, ce qui avait adouci son tempérament et engendré le gros Majin Buu jovial.
- **Super Buu** porte cette stratégie à son paroxysme en absorbant successivement **Gotenks SSJ3**, **Piccolo** (pour son intelligence tactique suprême) et enfin **Son Gohan Ultime** (*Buuhan*), chaque prise modifiant ses vêtements, allongeant son tentacule crânien et propulsant sa force à des sommets inégalés jusqu'alors.`;

try {
	// 1. Fusions et enrichissements
	const updates = [
		{
			id: 15,
			name: "Métamorphoses de Freezer (Formes 1 à 4 & 100%)",
			ki: "120 000 000 (100% Full Power — Daizenshuu 7)",
			article: ARTICLE_FREEZER,
		},
		{
			id: 8,
			name: "Fusion (Danse Métamol & Boucles Potara)",
			ki: "Multiplication Exponentielle & Harmonie Parfaite",
			article: ARTICLE_FUSION,
		},
		{
			id: 6,
			name: "Super Saiyan Blue (et déclinaison Rosé)",
			ki: "Ki Divin Purifié (SSGSS)",
			article: ARTICLE_SSJ_BLUE,
		},
		{
			id: 26,
			name: "Orange Piccolo (avec Gigantification)",
			ki: "Bénédiction Divine de Shenron",
			article: ARTICLE_ORANGE_PICCOLO,
		},
		{
			id: 13,
			name: "Transformation par absorption (Majin Buu & Cell)",
			ki: "Assimilation Biologique & Cumul Énergétique",
			article: ARTICLE_ABSORPTION,
		},
		{
			id: 2,
			name: "Super Saiyan 2",
			ki: "x100 (Dépassement du Super Saiyan)",
			article: null, // Conserve l'article existant
		},
		{
			id: 3,
			name: "Super Saiyan 3",
			ki: "x400 (Éveil Ultime du Super Saiyan)",
			article: null, // Conserve l'article existant
		},
	];

	// Identifiants à masquer (fusionnés ou non martiaux)
	const hideIds = [
		14, // Forme régressive (fusionnée dans #15)
		16, // Forme 100% / FULL POWER (fusionnée dans #15)
		9,  // Fusion Métamol (fusionnée dans #8)
		7,  // Super Saiyan Rosé (fusionné dans #6)
		29, // FORME Géante (fusionnée dans #26)
		31, // FORME MINI (vœu externe de régression et non transformation martiale)
	];

	console.log("=== 1. Modifications et enrichissements des fiches de référence ===");
	for (const u of updates) {
		console.log(`  · #${u.id} -> "${u.name}" (${u.ki})`);
		if (APPLY) {
			if (u.article) {
				await sql`
					UPDATE bot.db_transformations 
					SET name = ${u.name}, ki = ${u.ki}, article = ${u.article}, article_updated_at = ${Math.floor(Date.now() / 1000)}
					WHERE id = ${u.id}
				`;
			} else {
				await sql`
					UPDATE bot.db_transformations 
					SET name = ${u.name}, ki = ${u.ki}
					WHERE id = ${u.id}
				`;
			}
		}
	}

	console.log("\n=== 2. Masquage logique des doublons fusionnés (visible = false) ===");
	console.log(`  · Masquage de ${hideIds.length} entrées : ${hideIds.join(", ")}`);
	if (APPLY) {
		await sql`
			UPDATE bot.db_transformations 
			SET visible = false 
			WHERE id IN ${sql(hideIds)}
		`;
		console.log("  ✓ Entrées masquées avec succès.");
	}

	// Synchronisation du réplica SQLite bot
	if (APPLY) {
		console.log("\n=== 3. Synchronisation du réplica SQLite bot ===");
		const syncProc = Bun.spawn(["bun", "apps/bot/scripts/sync-neon-to-sqlite.ts"], {
			stdout: "inherit",
			stderr: "inherit",
		});
		await syncProc.exited;
	}

	console.log("\n🎉 Opération terminée avec succès !");
} finally {
	await sql.end();
}

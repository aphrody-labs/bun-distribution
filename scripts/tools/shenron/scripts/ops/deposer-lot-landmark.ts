// SPDX-License-Identifier: Apache-2.0
import {
	arretSiGel,
	connecte,
	deposerTraduction,
	jugerTraduction,
	texteDePlanche,
	type PlancheBrute,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
arretSiGel("deposer-lot-landmark");

const translations = [
	{
		databookId: 5,
		pageNumber: 14,
		texteFr: `Que sont les Dragon Balls ?
What's The DRAGON

# Que sont les Dragon Balls ?
## Origines
### ◎ Fabriquées par le clan des Dragons de Namek
Seuls les membres du clan des Dragons dotés de grandes aptitudes peuvent concevoir des Dragon Balls. Dans tout l'univers, seuls les nobles Nameks ont le privilège de posséder cette faculté.

## Caractéristiques
### ◎ Émission d'ondes spécifiques
Les sphères émettent de faibles ondes. Si une sphère pénètre à l'intérieur d'un être vivant, le signal d'ondes disparaît.

## Types
### ◎ Les Dragon Balls de la Terre
Créées par le Tout-Puissant, venu de Namek sur Terre.
### ◎ Les Dragon Balls originelles de Namek
Le principe est identique à celles de la Terre : elles sont composées de sept sphères, mais leur taille présente une différence notable. La taille d'une paume de main contre une dimension nécessitant les deux mains pour être soulevée.
## Les sept sphères capables de susciter des miracles`,
	},
	{
		databookId: 5,
		pageNumber: 15,
		texteFr: `# Shenron
Le Tout-Puissant l'a créé « afin d'apporter courage et espoir aux Terriens ».

## Processus de création de Shenron
Une fois que M. Popo a confectionné le modèle de Shenron, le Tout-Puissant lui insuffle la vie, et Shenron vient alors résider au sein des Dragon Balls.

## Porunga
Le Grand Chef l'a créé comme « le symbole de la sagesse et de la force des habitants de Namek ».

## Taille
Environ deux fois la taille de Capsule Corporation. Il peut aisément surplomber l'imposant bâtiment de Capsule Corporation à la Capitale de l'Ouest.

### Un / Trois
Le nombre de souhaits pouvant être exaucés.

### Langue de la Terre / Langue de Namek
Il est possible d'utiliser la langue courante de la Terre. Il ne prête pas attention au ton impératif ou au manque de politesse. Porunga, en revanche, requiert impérativement la langue de Namek.

### Une seule fois
Une personne ayant déjà été ressuscitée par les Dragon Balls ne peut pas être ressuscitée une seconde fois.`,
	},
	{
		databookId: 5,
		pageNumber: 38,
		texteFr: `22e Tournoi — Scènes de combats d'anthologie
Grue VS Tortue ! Le duel du destin entre rivaux jurés !
École Kamé Sennin VS école Tsuru Sennin ! Les combats de très haut niveau entre les disciples respectifs sont acharnés et surpassent tous les autres concurrents !

## 1st MATCH — Quarts de finale (1er au 4e tour)
● Chaozu VS Krilin (クリン)
Chaozu enchaîne les attaques au Dodonpa. Mais Krilin contre-attaque avec un Kaméhaméha et saisit l'occasion de la victoire !
● Yamcha (ヤムチャ) VS Tenshinhan
Les deux combattants semblent d'une force équivalente, mais Tenshinhan renvoie le Kaméhaméha de Yamcha, démontrant toute la puissance de l'école Tsuru Sennin !

## SEMIFINAL — Demi-finales
Un redoutable enchaînement inauguré par la Morsure du soleil !
● Tenshinhan VS Jackie Chun (ジャッキー・チュン)
Jackie Chun démontre la force du précédent champion, mais Tenshinhan fait lui aussi preuve d'un talent exceptionnel. Ayant jaugé la véritable valeur de Tenshinhan, Jackie Chun quitte lui-même l'arène.
● Krilin (クリン) VS Son Goku
Le premier affrontement à pleine puissance entre les deux amis : Goku déploie une force insondable !

## FINAL — Finale
● Tenshinhan VS Son Goku
Les deux adversaires se livrent à un affrontement acharné transcendant la querelle entre leurs écoles ! Tenshinhan tente d'expulser Goku hors du ring avec le Kikôhô. Goku ne s'en laisse pas conter et mène un assaut frontal.
Interdiction du Kikôhô ! « Viens par là ! Enchaînement, Attaque volley-ball ! »
L'assaut final porté à l'aide d'un Kaméhaméha inversé !

HAPPENING
Les relations entre Tsuru Sennin et Kamé Sennin sont détestables. Bien que tous deux aient formé d'excellents disciples, lorsqu'ils se disputent, ils se comportent comme des enfants…
Le Kikôhô déclenché par Tenshinhan en y mettant toute son énergie a démontré une puissance telle qu'il a pulvérisé l'arène en un instant !`,
	},
	{
		databookId: 5,
		pageNumber: 53,
		texteFr: `# Période de jeunesse — À 18 ans
Même pour une bataille décidant du sort du monde, hors de question d'accepter de l'aide dans un combat singulier !

# L'exaltation de la force contre la force !
Il désire affronter son adversaire de toutes ses forces ! Seule la question de savoir « qui est le plus fort » l'intéresse… et il déborde naturellement d'assurance !
La confiance acquise au fil d'un entraînement draconien que nul autre n'aurait pu endurer lui confère la certitude absolue de l'emporter lorsqu'il se bat !
« Si… si on m'aide, je ne pourrai pas être sacré champion… »
« Je vais l'arrêter moi-même !!! »
Même en sentant le danger mortel de l'attaque de Ma Junior (Piccolo), il ne fuit sous aucun prétexte !

Alors que tout le monde croyait la victoire impossible, Goku n'a jamais renoncé jusqu'au tout dernier instant !
« Je… je vais… le… le terrasser, vous… vous allez voir !!! »
L'arène a été entièrement rasée et tous les spectateurs ont fui, mais pour Goku, cela reste avant tout un tournoi. Il réalise son rêve et devient le numéro un sous le ciel !
« C'est… c'est moi… qui ai gagné le match… pas vrai… »
Il donne un Senzu à Ma Junior agonisant, faisant le vœu en son for intérieur que tous deux deviennent encore plus forts pour se mesurer à nouveau l'un à l'autre.
« Et puis, sans rival, je me sentirais un peu seul. »

## Traits de caractère
Un sens aigu de l'équité. Il refuse catégoriquement l'opportunité de devenir le Tout-Puissant.
Goku est furieux de voir le Tout-Puissant intervenir dans le combat pour bloquer une attaque à sa place. Il met un point d'honneur à livrer un affrontement d'une loyauté absolue.`,
	},
];

async function main() {
	const appliquer = process.argv.includes("--appliquer");
	const sql = await connecte();

	const [book] = await sql<{ id: string; title: string; pages: PlancheBrute[] }[]>`
		SELECT id, title, pages FROM bot.db_databooks WHERE id = 5`;
	if (!book) throw new Error("databook 5 introuvable");
	console.log(`Ouvrage : ${book.title} (#${book.id})`);

	let valid = 0;

	for (const t of translations) {
		// Numéro EXACT : l'ancien repli `Number(p.number) || idx + 1` pouvait viser
		// une autre planche.
		const planches = (book.pages ?? []).filter((p) => Number(p.number) === t.pageNumber);
		if (planches.length !== 1) {
			console.error(`Page ${t.pageNumber} : ${planches.length} planche(s) portant ce numéro dans le databook 5`);
			continue;
		}
		const planche = planches[0]!;
		const travail = {
			databookId: 5,
			numero: t.pageNumber,
			image: planche.image ?? null,
			source: texteDePlanche(planche),
			traduction: t.texteFr,
		};
		const verdict = jugerTraduction(travail);
		if (!verdict.ok) {
			console.error(`Page ${t.pageNumber} refusée par le juge: ${verdict.motif}`);
			continue;
		}
		console.log(`✓ Page ${t.pageNumber} validée (${t.texteFr.length} caractères)`);

		if (appliquer) {
			// Écriture atomique : seulement si la planche porte encore ce texte,
			// cette image, et aucune traduction.
			const res = await deposerTraduction(sql, { ...travail, par: "traducteur-officiel-shenron" });
			if (res.statut !== "ecrite") continue;
			console.log(`  -> Page ${t.pageNumber} inscrite en base PostgreSQL.`);
		}
		valid++;
	}

	if (!appliquer) {
		console.log(`\nSimulation réussie pour ${valid} planches. Passe '--appliquer' pour valider en base.`);
	} else {
		console.log(`\n${valid} planches ont été enregistrées avec succès dans la base PostgreSQL !`);
	}

	await sql.end();
}

main().catch(console.error);

/**
 * Point d'entrée du bot — UN programme, DEUX identités Discord.
 *
 * Le profil (`RG_PROFIL_BOT`, `rg` par défaut) décide de tout ce qui distingue
 * les deux bots : le jeton, les guildes, les intents, la marque des embeds, le
 * salon d'annonce des posts X — et surtout LES COMMANDES CHARGÉES. Le registre
 * vit dans `lib/profil.ts`, sa traduction en constantes dans `lib/config.ts`.
 * Ici, on ne fait qu'exécuter la décision.
 *
 * ── POURQUOI LES IMPORTS SONT DYNAMIQUES ───────────────────────────────────
 * `@rpbey/discordx` construit son arbre de commandes à partir des décorateurs
 * exécutés à l'import : importer un module de commande, c'est l'enregistrer.
 * Une liste d'`import` statiques en tête de fichier enregistrerait donc TOUT
 * pour TOUT LE MONDE, et les deux bots — qui vivent sur le même serveur —
 * offriraient deux fois `/azalee`, `/cpk`, `/x`… au même membre, sans qu'il
 * puisse savoir laquelle il déclenche. On importe donc exactement les modules
 * du profil, et rien d'autre. C'est la commande qui disparaît d'un bot quand
 * l'autre la sert : la dé-duplication n'est pas une convention, c'est le
 * mécanisme de chargement lui-même.
 *
 * ── L'ORDRE COMPTE ─────────────────────────────────────────────────────────
 * Les modules sont importés SÉQUENTIELLEMENT et AVANT `login()`. Discord exige
 * que l'arbre soit complet au moment de `initApplicationCommands()` ; un import
 * en retard, c'est une commande absente jusqu'au prochain redémarrage.
 */
import "reflect-metadata";
import { Client } from "@rpbey/discordx";
import { MessageFlags, Partials } from "discord.js";

import { closeCache } from "./lib/cache";
import { DISCORD_TOKEN, GUILD_IDS, PROFIL, PROFIL_ANNONCEUR } from "./lib/config";
import { sql } from "./lib/db";
import { demarrerServeurAdmin, type ServeurAdmin } from "./lib/serveur-admin";
import { demarrerNotifieurTweets } from "./services/tweetsNotifier";

/**
 * Modules chargés en plus des commandes, pour le seul profil Rose Griffon.
 *
 * `events/ready.ts` et `events/memberEvents.ts` parlent de synchronisation de
 * MEMBRES : ils lisent `GUILD_ID` (la guilde dont `discord_members` décrit la
 * communauté) et appellent `syncOneMember`. Le bot Azalée n'a même pas l'intent
 * `GuildMembers` — les brancher chez lui serait au mieux inerte, au pire une
 * écriture de membres sous la mauvaise identité.
 */
const MODULES_EVENEMENTS_RG = [
	"events/ready.ts",
	"events/memberEvents.ts",
	"events/experience.ts",
	"events/accueil.ts",
] as const;

const client = new Client({
	// Les intents viennent du PROFIL, et ce n'est pas cosmétique : `GuildMembers`
	// est un intent privilégié qu'il faut cocher dans le portail développeur de
	// chaque application. Demandé sans être accordé, Discord ferme la connexion
	// (« Used disallowed intents ») et le service ne démarre pas du tout — c'est
	// le cas de l'application Azalée, qui n'en a pas besoin.
	intents: [...PROFIL.intents],
	partials: [Partials.GuildMember, Partials.User],
	silent: false,
	// `botId` de discordx : sans effet tant qu'un processus ne pilote qu'un
	// client (une commande sans `@Bot(...)` est acceptée par tous), mais il rend
	// les journaux lisibles et prépare le jour où l'on voudrait les deux bots
	// dans un seul processus.
	botId: PROFIL.identifiantBot,
	// Portée des commandes — c'est ici que se joue « bot d'un serveur » contre
	// « bot public ».
	//
	// `guildes` : intersection entre les guildes VOULUES et celles où le bot est
	// réellement présent. Lister en dur une guilde qu'il n'a pas encore rejointe
	// ferait échouer l'enregistrement (l'API refuse une guilde inconnue) et
	// priverait AUSSI l'autre serveur des siennes ; ici, une guilde pas encore
	// autorisée est simplement ignorée, et prise en compte au redémarrage suivant.
	//
	// `globale` : aucune liste. discordx publie alors les commandes sur
	// l'application elle-même, donc sur tout serveur qui l'invite — y compris
	// ceux qui n'existent pas encore. C'est la seule portée qui tienne pour un
	// bot public : sans elle, chaque nouvelle invitation demanderait un commit.
	...(PROFIL.porteeCommandes === "guildes"
		? {
				botGuilds: [
					(bot: Client) =>
						bot.guilds.cache.map((g) => g.id).filter((id) => GUILD_IDS.includes(id)),
				],
			}
		: {}),
});

/**
 * Charge les modules du profil pour leurs décorateurs.
 *
 * Un chemin faux ne se voit pas au type-check (ce sont des chaînes) : on le
 * rattrape ici, en nommant le module ET le profil, plutôt que de laisser une
 * trace d'appel qui ne dit ni l'un ni l'autre. `profil.test.ts` vérifie en plus
 * que chaque chemin listé existe réellement sur le disque.
 */
async function chargerModules(chemins: readonly string[]): Promise<void> {
	for (const chemin of chemins) {
		try {
			await import(`./${chemin}`);
		} catch (err) {
			console.error(
				`✗ profil « ${PROFIL.nom} » : échec du chargement de src/${chemin} —`,
				err instanceof Error ? (err.stack ?? err.message) : err
			);
			throw err;
		}
	}
}

await chargerModules(PROFIL.modules);
if (PROFIL.nom === "rg") {
	await chargerModules(MODULES_EVENEMENTS_RG);
}

/** Coupe le notifieur de posts (minuteurs + abonnement au pont cron). */
let arreterNotifieur: (() => void) | null = null;

/**
 * Fenêtre du site sur l'exécution de CE processus (`lib/serveur-admin.ts`).
 *
 * Démarrée après `ready` comme le notifieur : `/etat` et `/commandes` n'ont de
 * sens qu'une fois l'arbre construit et la passerelle ouverte. Répondre « zéro
 * commande » à un tableau de bord parce qu'on a ouvert le port trop tôt, c'est
 * signaler une panne qui n'existe pas.
 */
let serveurAdmin: ServeurAdmin | null = null;

// `clientReady`, pas `ready` : discord.js 14.26 déprécie le second (« The ready
// event has been renamed to clientReady […] and will only emit under that name
// in v15 », WebSocketManager.js). L'écouter émettait un `DeprecationWarning` à
// chaque démarrage et aurait rendu le bot muet en v15. Les deux sont émis à la
// suite dans cette version, la bascule est donc sans effet de bord.
client.once("clientReady", async () => {
	try {
		await client.initApplicationCommands();
	} catch (err) {
		// `Invalid Form Body` seul est indiagnosticable : Discord met le CHEMIN du
		// champ fautif (`3.options.1.description`) dans `rawError.errors`, que
		// `err.message` n'expose pas. Sans lui, on cherche à l'aveugle parmi
		// soixante sous-commandes.
		const brut = (err as { rawError?: unknown }).rawError;
		console.error(
			"✗ initApplicationCommands failed:",
			err instanceof Error ? err.message : err,
			brut ? `\n  détail : ${JSON.stringify(brut)}` : ""
		);
	}

	// Portée globale : effacer les commandes de guilde héritées de l'ancien mode.
	// Discord ADDITIONNE les deux portées — sans ce nettoyage, un membre de Rose
	// Griffon verrait chaque commande deux fois, sans moyen de distinguer laquelle
	// répond. L'ordre compte : les globales sont déjà publiées ci-dessus, donc
	// aucun serveur ne se retrouve sans commande entre les deux appels.
	//
	// Seules les guildes réellement rejointes sont nettoyées : l'API refuse une
	// guilde inconnue, et l'erreur ferait échouer tout le lot.
	if (PROFIL.porteeCommandes === "globale") {
		const àNettoyer = PROFIL.guildes.filter((id) => client.guilds.cache.has(id));
		if (àNettoyer.length > 0) {
			try {
				await client.clearApplicationCommands(...àNettoyer);
				console.log(
					`✓ Commandes de guilde effacées sur ${àNettoyer.length} serveur(s) — les globales prennent le relais.`
				);
			} catch (err) {
				// Un nettoyage raté laisse des doublons visibles, pas un bot muet :
				// on le signale sans empêcher le démarrage.
				console.warn(
					"⚠ Nettoyage des commandes de guilde impossible (doublons possibles) :",
					err instanceof Error ? err.message : err
				);
			}
		}
	}

	// Dire OÙ les commandes ont atterri, et surtout où elles manquent : un bot en
	// ligne mais sans commande sur un serveur est indiscernable d'un bot en panne
	// pour qui le regarde depuis Discord.
	console.log(
		`✓ Profil « ${PROFIL.nom} » (${PROFIL.titre}) — ${PROFIL.modules.length} module(s) de commandes chargé(s).`
	);
	if (PROFIL.porteeCommandes === "globale") {
		const rejointes = client.guilds.cache.map((g) => g.name).join(", ") || "aucun";
		console.log(
			`✓ Commandes publiées GLOBALEMENT — servies sur les ${client.guilds.cache.size} serveur(s) rejoint(s) (${rejointes}) et sur tout serveur qui invitera le bot. Discord propage une modification globale en quelques minutes.`
		);
	} else {
		const servies = client.guilds.cache.filter((g) => GUILD_IDS.includes(g.id));
		const absentes = GUILD_IDS.filter((id) => !client.guilds.cache.has(id));
		console.log(
			`✓ Commandes enregistrées sur ${servies.size} serveur(s) : ${servies.map((g) => g.name).join(", ") || "aucun"}`
		);
		if (absentes.length > 0) {
			console.warn(
				`⚠ Guilde(s) configurée(s) mais non rejointe(s) : ${absentes.join(", ")} — le bot doit y être autorisé via l'URL OAuth2 avant que ses commandes n'y apparaissent.`
			);
		}
	}

	console.log(`✓ Logged in as ${client.user?.tag}`);

	// Notification des nouveaux posts. Démarrée APRÈS `ready` : le drain a besoin
	// d'un client capable de résoudre un salon. Le bot est le SEUL écrivain
	// Discord pour les posts — rg-cron se contente de signaler — et chaque profil
	// draine SON curseur, donc les deux bots peuvent annoncer sans se voler leurs
	// posts ni se doubler.
	// La fonction d'arrêt était jetée par le passé : son minuteur de 5 min et sa
	// connexion d'abonnement survivaient au `client.destroy()` et retenaient la
	// boucle d'événements (arrêt du service en timeout, puis SIGKILL).
	arreterNotifieur = demarrerNotifieurTweets(client, PROFIL_ANNONCEUR);

	// Sans `BOT_ADMIN_TOKEN`, rend `null` et n'ouvre aucun port : un serveur
	// d'administration sans secret est une porte, pas une fenêtre.
	serveurAdmin = demarrerServeurAdmin(client);
});

/**
 * Filet de dernier recours des interactions.
 *
 * Deux situations très différentes arrivaient ici avec le MÊME message :
 *   - la commande n'existe plus côté serveur (client Discord avec une liste
 *     périmée) : `executeInteraction` ne trouve rien et ne répond rien ;
 *   - la commande a levé : le membre lisait « commande inconnue ou expirée »,
 *     un diagnostic faux qui envoyait chercher au mauvais endroit.
 *
 * Et quand la commande avait déjà fait `deferReply()` avant de lever, personne
 * ne reprenait la main : l'interaction restait sur « réfléchit… » pour
 * toujours. `editReply` est le seul chemin possible dans cet état — `reply()`
 * lèverait `InteractionAlreadyReplied`.
 */
client.on("interactionCreate", async (interaction) => {
	let echec: unknown;
	try {
		await client.executeInteraction(interaction);
	} catch (err) {
		echec = err;
		console.error(
			"✗ executeInteraction a levé :",
			err instanceof Error ? (err.stack ?? err.message) : err
		);
	}

	// Une interaction d'autocomplétion n'est pas répondable : elle se sert par
	// `respond()`, et la laisser passer ici lèverait à chaque frappe.
	if (!interaction.isRepliable()) {
		return;
	}

	try {
		if (interaction.replied) {
			// La commande a déjà parlé : ne rien ajouter.
			return;
		}
		if (interaction.deferred) {
			if (echec) {
				await interaction.editReply({
					content: "❌ La commande a échoué. Le détail est dans le journal du service.",
				});
			}
			return;
		}
		await interaction.reply({
			content: echec
				? "❌ La commande a échoué. Le détail est dans le journal du service."
				: "Commande inconnue ou expirée. Recharge Discord (Ctrl+R) pour rafraîchir la liste.",
			flags: MessageFlags.Ephemeral,
		});
	} catch {
		// Jeton d'interaction expiré (3 s pour la première réponse, 15 min ensuite).
	}
});

/**
 * Arrêt propre.
 *
 * `systemctl stop/restart` envoie SIGTERM : sans écouteur, Bun tue le processus
 * en laissant la passerelle Discord se faire couper à chaud (le bot reste
 * affiché « en ligne » plusieurs minutes) et la connexion Postgres ouverte
 * côté serveur jusqu'à son expiration. On coupe donc dans l'ordre : minuteurs,
 * passerelle, cache Redis, pool Postgres.
 */
let arretEnCours = false;

async function arreter(signal: string): Promise<void> {
	if (arretEnCours) {
		return;
	}
	arretEnCours = true;
	console.log(`↔ ${signal} reçu — arrêt propre du profil « ${PROFIL.nom} ».`);

	arreterNotifieur?.();
	arreterNotifieur = null;

	// Avant la passerelle : un port encore ouvert retient la boucle d'événements
	// et fait finir l'arrêt en timeout puis SIGKILL, exactement comme le
	// minuteur du notifieur avant qu'on ne le coupe ici.
	serveurAdmin?.stop();
	serveurAdmin = null;

	try {
		await client.destroy();
	} catch (err) {
		console.error(
			"✗ fermeture de la passerelle Discord :",
			err instanceof Error ? err.message : err
		);
	}

	closeCache();

	try {
		// `timeout` en SECONDES : on laisse les requêtes en vol finir, sans jamais
		// bloquer l'arrêt du service au-delà de ce délai.
		await sql.close({ timeout: 5 });
	} catch (err) {
		console.error(
			"✗ fermeture de la connexion Postgres :",
			err instanceof Error ? err.message : err
		);
	}

	process.exit(0);
}

process.on("SIGTERM", () => void arreter("SIGTERM"));
process.on("SIGINT", () => void arreter("SIGINT"));

await client.login(DISCORD_TOKEN);

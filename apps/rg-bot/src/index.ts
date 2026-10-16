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
 * `@aphrody/discordx` construit son arbre de commandes à partir des décorateurs
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
import { Client } from "discordx";
import { Partials } from "discord.js";
import {
	clearGuildCommandsSafe,
	createProductionCacheOptions,
	initApplicationCommandsSafe,
	resolveGrantedIntents,
	safeExecuteInteraction,
} from "@aphrody/discord-kit";

import { MODULE_LOADERS } from "./modules";
import { closeCache } from "./lib/cache";
import { DISCORD_TOKEN, GUILD_IDS, PROFIL, PROFIL_ANNONCEUR } from "./lib/config";
import { sql } from "./lib/db";
import { demarrerServeurAdmin, type ServeurAdmin } from "./lib/serveur-admin";
import { startApiServer } from "./api/server";
import { demarrerNotifieurTweets } from "./services/tweetsNotifier";

/**
 * Modules chargés en plus des commandes, pour le seul profil Rose Griffon.
 */
const MODULES_EVENEMENTS_RG = [
	"events/ready.ts",
	"events/memberEvents.ts",
	"events/experience.ts",
	"events/accueil.ts",
] as const;

const isApiMode = process.argv.includes("api");
const isBotMode = process.argv.includes("bot");
const isAllMode = process.argv.includes("all") || (!isApiMode && !isBotMode);

let apiServerInstance: ReturnType<typeof startApiServer> | null = null;

if (isApiMode) {
	console.log(`[rg-backend] Démarrage du serveur API unifié Rose Griffon (ElysiaJS + WebSockets)...`);
	apiServerInstance = startApiServer();
} else {
	if (isAllMode && (process.env.START_API === "1" || process.env.API_PORT || !DISCORD_TOKEN)) {
		console.log(`[rg-backend] Démarrage des services d'API unifiés (port ${process.env.API_PORT ?? 8800})...`);
		apiServerInstance = startApiServer();
	}
}

if (!isApiMode && (!DISCORD_TOKEN && !isBotMode)) {
	console.log(`[rg-backend] Aucun DISCORD_TOKEN spécifié, le serveur API tourne de manière autonome.`);
} else if (!isApiMode) {
const intents = await resolveGrantedIntents(DISCORD_TOKEN, {
	desiredIntents: PROFIL.intents,
});

const client = new Client({
	intents: [...intents],
	partials: [Partials.GuildMember, Partials.User],
	silent: false,
	botId: PROFIL.identifiantBot,
	...createProductionCacheOptions(),
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
			const loader = MODULE_LOADERS[chemin];
			if (loader) {
				await loader();
			} else {
				await import(`./${chemin}`);
			}
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
	await initApplicationCommandsSafe(client);

	// Portée globale : effacer les commandes de guilde héritées de l'ancien mode.
	if (PROFIL.porteeCommandes === "globale") {
		await clearGuildCommandsSafe(client, PROFIL.guildes);
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
client.on("interactionCreate", async (interaction) => {
	await safeExecuteInteraction(client, interaction, {
		failureMessage: "❌ La commande a échoué. Le détail est dans le journal du service.",
		unhandledMessage: "Commande inconnue ou expirée. Recharge Discord (Ctrl+R) pour rafraîchir la liste.",
	});
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

	if (apiServerInstance) {
		try {
			apiServerInstance.stop();
		} catch {}
		apiServerInstance = null;
	}

	process.exit(0);
}

process.on("SIGTERM", () => void arreter("SIGTERM"));
process.on("SIGINT", () => void arreter("SIGINT"));

if (DISCORD_TOKEN) {
	await client.login(DISCORD_TOKEN);
}
}

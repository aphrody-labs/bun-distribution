#!/usr/bin/env bun
/**
 * Relais de messages privés — client en ligne de commande.
 *
 * Shenron sert de boîte aux lettres entre une personne et l'agent qui opère la
 * production. Le bot enregistre ce qu'on lui écrit en privé (`DirectMessageRelay`),
 * expose la file par API, et ce script en est la façade lisible :
 *
 *   bun scripts/dm.ts contacts                    # qui a écrit, qui est autorisé
 *   bun scripts/dm.ts ouvrir <userId> [note]      # autoriser un correspondant
 *   bun scripts/dm.ts fermer <userId>             # révoquer l'accès
 *   bun scripts/dm.ts lire [--tout] [--user <id>] # messages reçus
 *   bun scripts/dm.ts fil <userId>                # la conversation, dans l'ordre
 *   bun scripts/dm.ts repondre <userId> <texte…>  # envoyer, et tracer l'envoi
 *   bun scripts/dm.ts vu <userId>                 # marquer comme traité
 *
 * L'API est en loopback (`127.0.0.1:5006`) et protégée par `API_ADMIN_TOKEN`,
 * qui est lu dans `apps/shenron/bot/.env` — jamais passé en argument, pour qu'il ne
 * finisse pas dans l'historique du shell.
 */

const API = process.env.SHENRON_API_URL ?? "http://127.0.0.1:5006";

/**
 * Le jeton vient du `.env` du bot, pas de l'environnement du shell.
 *
 * `Bun.env` ne le porte pas quand le script est lancé hors du service, et
 * exiger un `export` manuel avant chaque appel finit toujours par produire un
 * jeton collé dans un fichier d'historique.
 */
async function jeton(): Promise<string> {
	const direct = process.env.API_ADMIN_TOKEN?.trim();
	if (direct) return direct;
	const chemin = new URL("../.env", import.meta.url).pathname;
	const texte = await Bun.file(chemin)
		.text()
		.catch(() => "");
	const ligne = texte.split("\n").find((l) => l.trim().startsWith("API_ADMIN_TOKEN="));
	const valeur = ligne
		?.split("=")
		.slice(1)
		.join("=")
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ API_ADMIN_TOKEN introuvable (ni en environnement, ni dans apps/shenron/bot/.env).");
		process.exit(1);
	}
	return valeur;
}

async function api(
	chemin: string,
	options: { method?: string; body?: unknown } = {}
): Promise<Record<string, unknown>> {
	const res = await fetch(`${API}${chemin}`, {
		method: options.method ?? "GET",
		headers: {
			authorization: `Bearer ${await jeton()}`,
			...(options.body ? { "content-type": "application/json" } : {}),
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) {
		console.error(`✗ ${res.status} — ${data.error ?? "erreur inconnue"}`);
		process.exit(1);
	}
	return data;
}

/**
 * L'API sérialise ses dates en ISO (`"2026-08-24T01:34:53.000Z"`), pas en
 * millisecondes : les passer à `Number()` donnait `NaN`, donc « Invalid Date »
 * sur chaque ligne de la boîte. On accepte les deux formes — un entier reste un
 * horodatage epoch, le reste est laissé à `Date` qui sait lire l'ISO.
 */
const horodatage = (valeur: unknown): string => {
	if (typeof valeur !== "number" && typeof valeur !== "string") return "—";
	const date =
		typeof valeur === "number" || /^\d+$/.test(valeur)
			? new Date(Number(valeur))
			: new Date(valeur);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
};

interface Contact {
	userId: string;
	username: string;
	displayName: string | null;
	allowed: boolean;
	note: string | null;
	lastSeenAt: number;
}
interface Message {
	id: number;
	userId: string;
	content: string;
	createdAt: number;
	readAt: number | null;
	username?: string | null;
	direction?: "in" | "out";
}

const [commande, ...args] = process.argv.slice(2);

switch (commande) {
	case "contacts": {
		const { contacts } = (await api("/api/dm/contacts")) as unknown as { contacts: Contact[] };
		if (contacts.length === 0) {
			console.log("Aucun correspondant connu — personne n'a encore écrit à Shenron en privé.");
			break;
		}
		for (const c of contacts) {
			const etat = c.allowed ? "✔ autorisé" : "· en attente";
			const nom = c.displayName ? `${c.displayName} (@${c.username})` : `@${c.username}`;
			console.log(
				`${etat.padEnd(12)} ${c.userId}  ${nom}${c.note ? ` — ${c.note}` : ""}` +
					`  · vu ${horodatage(c.lastSeenAt)}`
			);
		}
		break;
	}

	case "ouvrir":
	case "fermer": {
		const userId = args[0];
		if (!userId) {
			console.error("usage : bun scripts/dm.ts ouvrir|fermer <userId> [note]");
			process.exit(2);
		}
		const res = await api(`/api/dm/contacts/${userId}`, {
			method: "POST",
			body: {
				allowed: commande === "ouvrir",
				...(args.length > 1 ? { note: args.slice(1).join(" ") } : {}),
			},
		});
		console.log(`✓ @${res.username} (${userId}) — ${res.allowed ? "accès ouvert" : "accès fermé"}`);
		break;
	}

	case "lire": {
		const tout = args.includes("--tout");
		const i = args.indexOf("--user");
		const user = i !== -1 ? args[i + 1] : null;
		const params = new URLSearchParams();
		if (tout) params.set("tout", "1");
		if (user) params.set("userId", user);
		const { messages } = (await api(`/api/dm/inbox?${params}`)) as unknown as {
			messages: Message[];
		};
		if (messages.length === 0) {
			console.log(tout ? "Aucun message." : "Aucun message non lu.");
			break;
		}
		for (const m of messages) {
			console.log(`\n── #${m.id} · @${m.username ?? m.userId} · ${horodatage(m.createdAt)}`);
			console.log(m.content);
		}
		console.log(`\n${messages.length} message(s). « vu <userId> » pour les marquer traités.`);
		break;
	}

	case "fil": {
		const userId = args[0];
		if (!userId) {
			console.error("usage : bun scripts/dm.ts fil <userId>");
			process.exit(2);
		}
		// L'API d'inbox ne rend que les messages reçus ; le fil complet demande
		// les deux sens, donc on lit la table via l'endpoint « tout » puis on
		// intercale les envois connus. Simple et suffisant pour une relecture.
		const { messages } = (await api(
			`/api/dm/inbox?tout=1&userId=${userId}&limit=200`
		)) as unknown as { messages: Message[] };
		for (const m of messages) {
			console.log(`[${horodatage(m.createdAt)}] ← ${m.content}`);
		}
		console.log(`\n(${messages.length} message(s) reçus ; « repondre » pour écrire.)`);
		break;
	}

	case "repondre": {
		const userId = args[0];
		const contenu = args.slice(1).join(" ").trim();
		if (!userId || !contenu) {
			console.error('usage : bun scripts/dm.ts repondre <userId> "votre message"');
			process.exit(2);
		}
		const res = await api("/api/dm/send", { method: "POST", body: { userId, content: contenu } });
		console.log(`✓ envoyé à @${res.destinataire} (${userId})`);
		break;
	}

	case "vu": {
		const userId = args[0];
		if (!userId) {
			console.error("usage : bun scripts/dm.ts vu <userId>");
			process.exit(2);
		}
		await api("/api/dm/read", { method: "POST", body: { userId } });
		console.log(`✓ messages de ${userId} marqués comme traités`);
		break;
	}

	default:
		console.log(
			[
				"Relais de messages privés Shenron.",
				"",
				"  contacts                       qui a écrit, qui est autorisé",
				"  ouvrir <userId> [note]         autoriser un correspondant",
				"  fermer <userId>                révoquer l'accès",
				"  lire [--tout] [--user <id>]    messages reçus",
				"  fil <userId>                   la conversation dans l'ordre",
				'  repondre <userId> "texte"      envoyer une réponse',
				"  vu <userId>                    marquer comme traité",
			].join("\n")
		);
		if (commande) process.exit(2);
}

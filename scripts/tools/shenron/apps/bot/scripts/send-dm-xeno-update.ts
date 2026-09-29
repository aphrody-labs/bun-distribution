import { Database } from "bun:sqlite";

const recipient = "1527405876695142620";
const content = `🧭 **Mise à jour Xeno**

J’ai conservé les personnages officiels des continuités Xeno plutôt que de les traiter comme du contenu à supprimer : Demigra, Mira, Towa, Aeos, Ahms, Beat, Bardock (Xeno) et Broly (Xeno) sont de nouveau visibles dans le wiki, avec leurs sources de jeux/spin-off et leur distinction explicite d’avec le canon manga/anime principal.

Les fiches courtes ou génériques restent masquées jusqu’à enrichissement vérifié. L’objectif est de regrouper ensuite ce corpus Xeno dans une page dédiée avec onglets (personnages, cosmologie, histoire), sans mélanger les continuités.`;

async function token() {
	const env = await Bun.file(new URL("../.env", import.meta.url)).text();
	for (const line of env.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("DISCORD_TOKEN_SHENRON=")) return trimmed.slice("DISCORD_TOKEN_SHENRON=".length).replace(/^['"]|['"]$/g, "").trim();
		if (trimmed.startsWith("DISCORD_TOKEN=")) return trimmed.slice("DISCORD_TOKEN=".length).replace(/^['"]|['"]$/g, "").trim();
	}
	throw new Error("DISCORD_TOKEN introuvable");
}

const auth = `Bot ${await token()}`;
const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ recipient_id: recipient }) });
if (!channelResponse.ok) throw new Error(`DM channel: ${channelResponse.status}`);
const channel = (await channelResponse.json()) as { id: string };
const response = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
if (!response.ok) throw new Error(`DM send: ${response.status}`);
const message = (await response.json()) as { id: string };
try {
	const db = new Database(new URL("../data/bot.db", import.meta.url).pathname);
	db.run("insert into dm_messages (user_id,direction,content,persona,message_id,created_at) values (?, 'out', ?, 'shenron', ?, datetime('now'))", [recipient, content, message.id]);
	db.close();
} catch { /* Discord delivery remains authoritative. */ }
console.log(JSON.stringify({ ok: true, recipient, messageId: message.id }));

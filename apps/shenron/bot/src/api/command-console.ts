/**
 * command-console.ts — « Console bot » : exécution d'opérations RÉELLES du bot à
 * distance (depuis le site admin), hors Discord. Chaque commande appelle les
 * VRAIS services (LevelService, EconomyService, rôles Discord…) et renvoie un
 * résultat structuré — pas de replay d'interaction synthétique fragile.
 *
 * Catalogue extensible : ajouter une entrée dans COMMAND_CATALOG + un `case` dans
 * runConsoleCommand. Exposé par l'API sous /api/admin/console/* (admin-gated).
 */
import { eq } from "drizzle-orm";
import type { GuildMember } from "discord.js";
import { container } from "tsyringe";
import { Client } from "discordx";
import { DatabaseService } from "~/db/index";
import { users } from "~/db/schema";
import { env } from "~/lib/env";
import { PERSONA_IDS, type PersonaId } from "~/lib/personas";
import { isRaceId, RACE_IDS, RACE_ROLE_IDS, RACES, type RaceId } from "~/lib/races";
import { levelForXP } from "~/lib/xp";
import { EconomyService } from "~/services/EconomyService";
import { LevelService } from "~/services/LevelService";
import { formatZeni } from "~/lib/zeni";

type ConsoleFieldType =
	| "user"
	| "text"
	| "number"
	| "select"
	| "role"
	| "channel"
	| "persona";

interface ConsoleField {
	name: string;
	label: string;
	type: ConsoleFieldType;
	required?: boolean;
	placeholder?: string;
	options?: { value: string; label: string }[];
}

export interface ConsoleCommandSpec {
	name: string;
	label: string;
	description: string;
	/** Modifie l'état (XP/rôles/messages) → confirmation avant exécution côté UI. */
	danger?: boolean;
	fields: ConsoleField[];
}

const RACE_OPTIONS = RACE_IDS.map((r) => ({ value: r, label: RACES[r].name }));
const PERSONA_OPTIONS = PERSONA_IDS.map((p) => ({ value: p, label: p }));

/** Catalogue des commandes exécutables à distance (rendu par l'UI). */
export const COMMAND_CATALOG: ConsoleCommandSpec[] = [
	{
		name: "userinfo",
		label: "Infos joueur",
		description: "Affiche XP, niveau, zénis, race et rang d'un membre.",
		fields: [{ name: "userId", label: "Membre", type: "user", required: true }],
	},
	{
		name: "addxp",
		label: "Ajouter de l'XP",
		description: "Ajoute de l'XP (recalcule le niveau + réaligne les rôles de palier).",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "amount", label: "Montant d'XP", type: "number", required: true },
		],
	},
	{
		name: "setxp",
		label: "Définir l'XP",
		description: "Fixe l'XP à une valeur exacte (recalcule niveau + rôles).",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "amount", label: "XP total", type: "number", required: true },
		],
	},
	{
		name: "addzeni",
		label: "Ajouter des zénis",
		description: "Crédite (ou débite si négatif) des zénis.",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "amount", label: "Zénis (négatif = retrait)", type: "number", required: true },
		],
	},
	{
		name: "setzeni",
		label: "Définir les zénis",
		description: "Fixe le solde de zénis à une valeur exacte.",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "amount", label: "Zénis", type: "number", required: true },
		],
	},
	{
		name: "setrace",
		label: "Assigner une race",
		description: "Change la race d'un membre + rôle exclusif + réalignement des paliers.",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "race", label: "Race", type: "select", required: true, options: RACE_OPTIONS },
		],
	},
	{
		name: "resynclevel",
		label: "Resync niveau & rôles",
		description: "Recalcule le niveau depuis l'XP et réaligne les rôles de palier de la race.",
		danger: true,
		fields: [{ name: "userId", label: "Membre", type: "user", required: true }],
	},
	{
		name: "grantrole",
		label: "Donner un rôle",
		description: "Ajoute un rôle Discord à un membre.",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "roleId", label: "ID du rôle", type: "role", required: true },
		],
	},
	{
		name: "removerole",
		label: "Retirer un rôle",
		description: "Retire un rôle Discord d'un membre.",
		danger: true,
		fields: [
			{ name: "userId", label: "Membre", type: "user", required: true },
			{ name: "roleId", label: "ID du rôle", type: "role", required: true },
		],
	},
	{
		name: "say",
		label: "Faire parler un bot",
		description: "Envoie un message dans un salon via l'un des 6 personas.",
		danger: true,
		fields: [
			{ name: "persona", label: "Bot", type: "persona", required: true, options: PERSONA_OPTIONS },
			{ name: "channelId", label: "ID du salon", type: "channel", required: true },
			{ name: "content", label: "Message", type: "text", required: true },
		],
	},
];

export interface ConsoleResult {
	ok: boolean;
	message: string;
	data?: Record<string, unknown>;
}

function str(args: Record<string, unknown>, k: string): string {
	const v = args[k];
	return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}
function num(args: Record<string, unknown>, k: string): number {
	const v = args[k];
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : NaN;
}

/** Résout un GuildMember depuis n'importe quel client persona ayant la guilde. */
export async function resolveMember(userId: string): Promise<GuildMember | null> {
	const clients = container.resolve<Map<string, Client>>("ClientMap");
	for (const client of clients.values()) {
		const guild = client.guilds.cache.get(env.GUILD_ID);
		if (!guild) continue;
		const member = await guild.members.fetch(userId).catch(() => null);
		if (member) return member;
	}
	return null;
}

/** Exécute une commande console. Ne throw jamais → renvoie {ok:false} en cas d'erreur. */
export async function runConsoleCommand(
	command: string,
	args: Record<string, unknown>
): Promise<ConsoleResult> {
	try {
		const db = container.resolve(DatabaseService).db;
		const levels = container.resolve(LevelService);
		const economy = container.resolve(EconomyService);

		switch (command) {
			case "userinfo": {
				const userId = str(args, "userId");
				const u = await levels.getUser(userId);
				if (!u) return { ok: false, message: `Aucun membre \`${userId}\` en base.` };
				const rank = await levels.rankOf(userId);
				return {
					ok: true,
					message: `Niveau ${u.lastLevelReached} · ${u.xp} XP · ${formatZeni(u.zeni)} · race ${u.race ?? "—"}${rank ? ` · rang #${rank}` : ""}`,
					data: { xp: u.xp, level: u.lastLevelReached, zeni: u.zeni, race: u.race, rank },
				};
			}
			case "addxp": {
				const userId = str(args, "userId");
				const amount = num(args, "amount");
				if (Number.isNaN(amount)) return { ok: false, message: "Montant d'XP invalide." };
				const res = await levels.addXP(userId, amount, { propagateFusion: false, source: "admin" });
				const member = await resolveMember(userId);
				if (member) await levels.syncRaceLevelRoles(member).catch(() => {});
				return {
					ok: true,
					message: `XP ${res.before} → ${res.after} (niveau ${res.newLevel}${res.levelUp ? " · LEVEL UP" : ""})${member ? " · rôles réalignés" : " · membre hors serveur (rôles non synchro)"}`,
					data: res,
				};
			}
			case "setxp": {
				const userId = str(args, "userId");
				const xp = num(args, "amount");
				if (Number.isNaN(xp) || xp < 0) return { ok: false, message: "XP invalide." };
				const res = await levels.setXP(userId, xp);
				const member = await resolveMember(userId);
				if (member) await levels.syncRaceLevelRoles(member).catch(() => {});
				return {
					ok: true,
					message: `XP fixé à ${xp} (niveau ${res.newLevel})${member ? " · rôles réalignés" : ""}`,
					data: res,
				};
			}
			case "addzeni": {
				const userId = str(args, "userId");
				const amount = num(args, "amount");
				if (Number.isNaN(amount)) return { ok: false, message: "Montant invalide." };
				await levels.ensureUser(userId);
				if (amount >= 0) await economy.addZeni(userId, amount, { propagateFusion: false, source: "admin" });
				else await economy.removeZeni(userId, -amount);
				const bal = await economy.getBalance(userId);
				return {
					ok: true,
					message: `Zénis ajustés de ${amount} → solde ${bal}.`,
					data: { balance: bal },
				};
			}
			case "setzeni": {
				const userId = str(args, "userId");
				const amount = num(args, "amount");
				if (Number.isNaN(amount) || amount < 0) return { ok: false, message: "Solde invalide." };
				await levels.ensureUser(userId);
				await economy.setZeni(userId, amount);
				return { ok: true, message: `Solde de zénis fixé à ${amount}.`, data: { balance: amount } };
			}
			case "setrace": {
				const userId = str(args, "userId");
				const race = str(args, "race");
				if (!isRaceId(race)) return { ok: false, message: `Race inconnue : ${race}` };
				await levels.ensureUser(userId);
				await db.update(users).set({ race, raceChosenAt: new Date() }).where(eq(users.id, userId));
				const member = await resolveMember(userId);
				let roleNote = "membre hors serveur (rôles non synchro)";
				if (member) {
					const def = RACES[race as RaceId];
					const toRemove = RACE_ROLE_IDS.filter(
						(r) => r !== def.roleId && member.roles.cache.has(r)
					);
					if (toRemove.length)
						await member.roles.remove(toRemove, "Race (console)").catch(() => {});
					if (!member.roles.cache.has(def.roleId))
						await member.roles.add(def.roleId, `Race : ${def.name} (console)`).catch(() => {});
					await levels.syncRaceLevelRoles(member).catch(() => {});
					roleNote = "rôle de race + paliers réalignés";
				}
				return { ok: true, message: `Race → ${RACES[race as RaceId].name} · ${roleNote}.` };
			}
			case "resynclevel": {
				const userId = str(args, "userId");
				const u = await levels.getUser(userId);
				if (!u) return { ok: false, message: `Aucun membre \`${userId}\` en base.` };
				const level = levelForXP(u.xp);
				await db.update(users).set({ lastLevelReached: level }).where(eq(users.id, userId));
				const member = await resolveMember(userId);
				if (member) await levels.syncRaceLevelRoles(member).catch(() => {});
				return {
					ok: true,
					message: `Niveau recalculé : ${level} (${u.xp} XP)${member ? " · rôles réalignés" : " · membre hors serveur"}.`,
					data: { level, xp: u.xp },
				};
			}
			case "grantrole":
			case "removerole": {
				const userId = str(args, "userId");
				const roleId = str(args, "roleId");
				if (!/^\d{17,20}$/.test(roleId)) return { ok: false, message: "ID de rôle invalide." };
				const member = await resolveMember(userId);
				if (!member) return { ok: false, message: "Membre introuvable sur le serveur." };
				if (command === "grantrole") await member.roles.add(roleId, "Console admin");
				else await member.roles.remove(roleId, "Console admin");
				return { ok: true, message: `Rôle ${command === "grantrole" ? "ajouté" : "retiré"}.` };
			}
			case "say": {
				const persona = str(args, "persona") as PersonaId;
				const channelId = str(args, "channelId");
				const content = str(args, "content");
				if (!PERSONA_IDS.includes(persona)) return { ok: false, message: "Persona invalide." };
				if (!content) return { ok: false, message: "Message vide." };
				const clients = container.resolve<Map<string, Client>>("ClientMap");
				const client = clients.get(persona);
				if (!client) return { ok: false, message: "Persona hors-ligne." };
				const channel = await client.channels.fetch(channelId).catch(() => null);
				if (!channel || !channel.isTextBased() || !("send" in channel)) {
					return { ok: false, message: "Salon textuel introuvable." };
				}
				const sent = await (
					channel as { send: (o: { content: string }) => Promise<{ id: string }> }
				).send({
					content,
				});
				return {
					ok: true,
					message: `Message envoyé (id ${sent.id}).`,
					data: { messageId: sent.id },
				};
			}
			default:
				return { ok: false, message: `Commande inconnue : ${command}` };
		}
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : "Erreur d'exécution." };
	}
}

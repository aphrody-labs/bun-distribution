import "./setup-training";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdminLabListener } from "../src/events/AdminLabListener";
import { DatabaseService } from "../src/db/index";
import { TrainingService } from "../src/services/TrainingService";
import { AdminReportGoalService } from "../src/services/AdminReportGoalService";
import { CanonService } from "../src/services/CanonService";
import { ADMIN_LAB_CHANNEL_ID } from "../src/lib/admin-lab";

// Base, docs/ et notifier isolés : les commandes !goal / !report du test
// créaient de vrais objectifs et signalements en production.
const workDir = mkdtempSync(join(tmpdir(), "admin-lab-listener-test-"));
describe("AdminLabListener — Écoute et Automatisation du Salon Lab IA", () => {
	const dbs = DatabaseService.forPath(join(workDir, "bot.db"));
	const canon = new CanonService(null as any);
	const training = new TrainingService(dbs, canon);
	const reportGoal = AdminReportGoalService.create(dbs, {
		docsDir: join(workDir, "docs"),
		notify: async () => {},
	});
	const listener = new AdminLabListener(dbs, training, reportGoal);
	afterAll(() => {
		dbs.sqlite.close();
	});

	function createMockMessage(opts: {
		id?: string;
		content: string;
		channelId?: string;
		isBot?: boolean;
		authorId?: string;
		authorTag?: string;
	}) {
		let replyData: any = null;
		let editData: any = null;

		const mockMsg = {
			id: opts.id ?? `msg-${Date.now()}-${Math.random()}`,
			channelId: opts.channelId ?? ADMIN_LAB_CHANNEL_ID,
			content: opts.content,
			author: {
				id: opts.authorId ?? "1527405876695142620",
				tag: opts.authorTag ?? "Admin#0001",
				bot: opts.isBot ?? false,
			},
			attachments: new Map(),
			mentions: {
				has: () => false,
			},
			client: {
				user: { id: "bot-shenron" },
			},
			reply: async (payload: any) => {
				replyData = payload;
				return {
					id: `reply-${Date.now()}`,
					edit: async (newPayload: any) => {
						editData = newPayload;
						return true;
					},
				};
			},
			getReply: () => replyData,
			getEdit: () => editData,
		};

		return mockMsg;
	}

	test("ignore les messages provenant d'autres salons", async () => {
		const msg = createMockMessage({
			content: "!status",
			channelId: "999999999999999999",
		});

		await listener.onMessage([msg as any]);
		expect(msg.getReply()).toBeNull();
	});

	test("ignore les messages envoyés par des bots", async () => {
		const msg = createMockMessage({
			content: "!status",
			isBot: true,
		});

		await listener.onMessage([msg as any]);
		expect(msg.getReply()).toBeNull();
	});

	test("archive les messages du salon lab dans admin_lab_messages", async () => {
		const msgId = `lab-archive-test-${Date.now()}`;
		const msg = createMockMessage({
			id: msgId,
			content: "Message de test pour archivage automatique",
		});

		await listener.onMessage([msg as any]);

		const row = dbs.sqlite
			.query("SELECT * FROM admin_lab_messages WHERE message_id = ?")
			.get(msgId) as any;

		expect(row).toBeDefined();
		expect(row.content).toBe("Message de test pour archivage automatique");
		expect(row.user_id).toBe("1527405876695142620");
	});

	test("traite la commande rapide !status et retourne un embed de diagnostic", async () => {
		const msg = createMockMessage({
			content: "!status",
		});

		await listener.onMessage([msg as any]);
		const reply = msg.getReply();

		expect(reply).toBeDefined();
		expect(reply.embeds).toBeDefined();
		expect(reply.embeds[0].title).toContain("ÉTAT DU SYSTÈME SHENRON");
	});

	test("traite la commande rapide !goal et crée un objectif synchronisé", async () => {
		const msg = createMockMessage({
			content: "!goal Hardening Pipeline | Renforcer les checks de résilience",
		});

		await listener.onMessage([msg as any]);
		const reply = msg.getReply();

		expect(reply).toBeDefined();
		expect(reply.embeds[0].title).toContain("Objectif");
		expect(reply.embeds[0].description).toContain("Hardening Pipeline");
	});

	test("traite la commande rapide !report et crée un signalement synchronisé", async () => {
		const msg = createMockMessage({
			content: "!report Fiche Daima manquante | Episode 2 synoptique incomplet",
		});

		await listener.onMessage([msg as any]);
		const reply = msg.getReply();

		expect(reply).toBeDefined();
		expect(reply.embeds[0].title).toContain("Signalement");
		expect(reply.embeds[0].description).toContain("Fiche Daima manquante");
	});

	test("traite la commande rapide !help avec le sommaire des commandes", async () => {
		const msg = createMockMessage({
			content: "!help",
		});

		await listener.onMessage([msg as any]);
		const reply = msg.getReply();

		expect(reply).toBeDefined();
		expect(reply.embeds[0].title).toContain("COMMANDES DU SALON LAB IA ADMIN");
	});
});

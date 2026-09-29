// SPDX-License-Identifier: Apache-2.0
/** Injected #bot-admin notifier and `.coord` override of the A2A hub (W2-APH-05). */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISCORD_BO_ADMIN_CHANNEL, ShenronA2AHub, type AdminNotification } from "../../src/aphrody/a2a";

const originalWarn = console.warn;

afterEach(() => {
	console.warn = originalWarn;
	ShenronA2AHub.configure({ notifier: null, coordDir: null });
});

describe("ShenronA2AHub.configure", () => {
	it("sends the same embed payload through the injected notifier", async () => {
		const sent: AdminNotification[] = [];
		ShenronA2AHub.configure({
			notifier: async (message) => {
				sent.push(message);
				return { ok: true };
			},
		});
		const before = Date.now();
		await ShenronA2AHub.notifyDiscordBoAdmin("Titre", "Texte", "error", [{ name: "a", value: "b", inline: true }]);
		expect(sent).toHaveLength(1);
		const message = sent[0]!;
		expect(message.channelId).toBe(DISCORD_BO_ADMIN_CHANNEL);
		expect(message.embeds).toHaveLength(1);
		const embed = message.embeds[0]!;
		expect(Date.parse(String(embed.timestamp))).toBeGreaterThanOrEqual(before - 1000);
		expect({ ...embed, timestamp: "T" } as Record<string, unknown>).toEqual({
			color: 0xef4444,
			title: "[A2A] Titre",
			description: "Texte",
			fields: [{ name: "a", value: "b", inline: true }],
			footer: { text: "Shenron A2A Unified Protocol" },
			timestamp: "T",
		});
	});

	it("uses brand and success colours and empty fields by default", async () => {
		const colours: unknown[] = [];
		ShenronA2AHub.configure({
			notifier: async (m) => {
				colours.push(m.embeds[0]!.color);
				expect(m.embeds[0]!.fields).toEqual([]);
			},
		});
		await ShenronA2AHub.notifyDiscordBoAdmin("x", "y");
		await ShenronA2AHub.notifyDiscordBoAdmin("x", "y", "success");
		expect(colours).toEqual([0xf59e0b, 0x22c55e]);
	});

	it("warns once and skips without a notifier", async () => {
		const warnings: unknown[] = [];
		console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
		ShenronA2AHub.configure({ notifier: null });
		await ShenronA2AHub.notifyDiscordBoAdmin("a", "b");
		await ShenronA2AHub.notifyDiscordBoAdmin("c", "d");
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0])).toContain("notificateur");
	});

	it("swallows notifier failures with a warning", async () => {
		const warnings: unknown[] = [];
		console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
		ShenronA2AHub.configure({
			notifier: async () => {
				throw new Error("discord down");
			},
		});
		await ShenronA2AHub.notifyDiscordBoAdmin("a", "b");
		expect(String(warnings[0])).toContain("discord down");
	});

	it("coordDir override takes precedence over A2A_COORD_DIR", async () => {
		const saved = process.env.A2A_COORD_DIR;
		const envDir = mkdtempSync(join(tmpdir(), "a2a-env-"));
		const override = mkdtempSync(join(tmpdir(), "a2a-override-"));
		try {
			process.env.A2A_COORD_DIR = envDir;
			ShenronA2AHub.configure({ coordDir: override });
			await ShenronA2AHub.handleMsgEnvelope({ from: "codex", to: "shenron-dragonball", kind: "ping", topic: "t", body: "b" });
			const { readdirSync } = await import("node:fs");
			expect(readdirSync(override).some((f) => f.startsWith("inbox-from-"))).toBe(true);
			expect(readdirSync(envDir)).toEqual([]);
		} finally {
			if (saved === undefined) delete process.env.A2A_COORD_DIR;
			else process.env.A2A_COORD_DIR = saved;
			rmSync(envDir, { recursive: true, force: true });
			rmSync(override, { recursive: true, force: true });
		}
	});
});

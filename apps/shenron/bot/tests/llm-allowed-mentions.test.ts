import "./setup";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { ChannelType, type CommandInteraction } from "discord.js";
import { container } from "tsyringe";
import { AskCommands } from "../src/commands/wiki/Ask";
import { DatabaseService } from "../src/db/index";
import { WhisAutonomousChat } from "../src/events/AutonomousChat";
import type { RedisIndexerService } from "../src/lib/redis-indexer";
import { SettingsService } from "../src/services/SettingsService";
import type { TrainingService } from "../src/services/TrainingService";

const SAFE_MENTIONS = { parse: [], repliedUser: true };
const BOT_ID = "999999999999999999";

type Spy = ReturnType<typeof spyOn>;
let spies: Spy[] = [];

beforeEach(() => {
	const proto = SettingsService.prototype as unknown as Record<string, unknown>;
	spies = [
		spyOn(proto as { getBool: () => Promise<boolean> }, "getBool").mockResolvedValue(true),
		spyOn(proto as { getSnowflake: () => Promise<string | null> }, "getSnowflake").mockResolvedValue(
			null
		),
		spyOn(proto as { getString: () => Promise<string> }, "getString").mockResolvedValue(""),
	];
});
afterEach(() => {
	for (const s of spies) s.mockRestore();
});

class FakeWhis extends WhisAutonomousChat {
	protected override async generateAnswer(): Promise<string> {
		return "@everyone <@&123456789012345678> Goku est un Saiyan.";
	}
}

describe("S6 — AutonomousChat LLM reply", () => {
	it("passes allowedMentions { parse: [], repliedUser: true } with the generated content", async () => {
		const replies: unknown[] = [];
		const message = {
			inGuild: () => true,
			author: { bot: false, id: "111", username: "u" },
			client: { user: { id: BOT_ID } },
			channel: { type: ChannelType.GuildText, sendTyping: async () => {} },
			channelId: "555555555555555555",
			content: `<@${BOT_ID}> qui est Goku ?`,
			mentions: { has: (id: string) => id === BOT_ID },
			reply: async (options: unknown) => {
				replies.push(options);
			},
		};
		const chat = new FakeWhis(
			container.resolve(DatabaseService),
			{} as unknown as RedisIndexerService
		);
		await chat.handleMessage(message as never);
		expect(replies).toEqual([
			{
				content: "@everyone <@&123456789012345678> Goku est un Saiyan.",
				allowedMentions: SAFE_MENTIONS,
			},
		]);
	});
});

describe("S6 — /ask replies", () => {
	function fakeInteraction() {
		const edits: Record<string, unknown>[] = [];
		const interaction = {
			deferReply: async () => {},
			editReply: async (options: Record<string, unknown>) => {
				edits.push(options);
			},
		};
		return { interaction: interaction as unknown as CommandInteraction, edits };
	}

	const ask = new AskCommands(
		container.resolve(DatabaseService),
		{} as unknown as TrainingService
	);

	it("short question editReply carries safe allowedMentions", async () => {
		const { interaction, edits } = fakeInteraction();
		await ask.ask("@e", undefined, undefined, undefined, interaction);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.allowedMentions).toEqual(SAFE_MENTIONS);
	});

	it("question echoed back (no result / archive error) never pings", async () => {
		const { interaction, edits } = fakeInteraction();
		await ask.ask("@everyone zzqxw inconnu", undefined, undefined, undefined, interaction);
		expect(edits.length).toBeGreaterThan(0);
		for (const edit of edits) expect(edit.allowedMentions).toEqual(SAFE_MENTIONS);
	});
});

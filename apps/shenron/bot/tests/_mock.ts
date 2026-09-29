/**
 * Mocks minimaux pour tester les handlers de commande sans vraie Gateway Discord.
 * Pas pour couvrir 100 % : smoke test — "le handler répond sans throw".
 */
import { mock } from "bun:test";

interface MockCall {
	method: string;
	args: unknown[];
}

export interface MockInteraction {
	user: { id: string; username: string; bot: boolean };
	guild: {
		id: string;
		name: string;
		members: { fetch: ReturnType<typeof mock> };
		ownerId: string;
	} | null;
	guildId: string | null;
	channelId: string;
	channel: {
		id: string;
		send: ReturnType<typeof mock>;
		messages: {
			fetch: ReturnType<typeof mock>;
			delete: ReturnType<typeof mock>;
		};
		bulkDelete: ReturnType<typeof mock>;
	};
	member: {
		id: string;
		permissions: { has: () => boolean };
		roles: { cache: Map<string, unknown>; add: ReturnType<typeof mock> };
	} | null;
	inCachedGuild: () => boolean;
	send: ReturnType<typeof mock>;
	reply: ReturnType<typeof mock>;
	editReply: ReturnType<typeof mock>;
	deferReply: ReturnType<typeof mock>;
	followUp: ReturnType<typeof mock>;
	deleteReply: ReturnType<typeof mock>;
	showModal: ReturnType<typeof mock>;
	fields: { getTextInputValue: (k: string) => string };
	options: { getUser: () => null; getMember: () => null };
	calls: MockCall[];
	commandName: string;
	customId?: string;
	client: unknown;
}

export function makeInteraction(opts: Partial<MockInteraction> = {}): MockInteraction {
	const calls: MockCall[] = [];
	const fakeMessage: Record<string, unknown> = {
		id: "msg-id",
		delete: () => Promise.resolve(),
		createMessageComponentCollector: () => ({
			on: () => {},
			stop: () => {},
		}),
	};
	fakeMessage.edit = () => Promise.resolve(fakeMessage);
	const spy = (name: string) =>
		mock((...args: unknown[]) => {
			calls.push({ method: name, args });
			return Promise.resolve(fakeMessage);
		});

	const interaction: MockInteraction = {
		user: { id: "11111111111111111", username: "tester", bot: false },
		guild: {
			id: "1497167233280118896",
			name: "Test Guild",
			ownerId: "11111111111111111",
			members: { fetch: mock(() => Promise.resolve(new Map())) },
		},
		guildId: "1497167233280118896",
		channelId: "22222222222222222",
		channel: {
			id: "22222222222222222",
			send: spy("channel.send"),
			messages: {
				fetch: mock(() => Promise.resolve(new Map())),
				delete: mock(() => Promise.resolve()),
			},
			bulkDelete: mock(() => Promise.resolve(new Map())),
		},
		member: {
			id: "11111111111111111",
			permissions: { has: () => true },
			roles: { cache: new Map(), add: mock(() => Promise.resolve()) },
		},
		inCachedGuild: () => true,
		send: spy("send"), // fallback pour @discordx/pagination quand sendTo ne matche aucun instanceof
		reply: spy("reply"),
		editReply: spy("editReply"),
		deferReply: spy("deferReply"),
		followUp: spy("followUp"),
		deleteReply: spy("deleteReply"),
		showModal: spy("showModal"),
		fields: { getTextInputValue: () => "" },
		options: { getUser: () => null, getMember: () => null },
		calls,
		commandName: "test",
		client: { user: { id: "bot-id" } },
		...opts,
	};
	return interaction;
}

export function makeUser(id = "33333333333333333", username = "target") {
	return {
		id,
		username,
		bot: false,
		tag: `${username}#0001`,
		toString: () => `<@${id}>`,
	};
}

export function assertResponded(int: MockInteraction): void {
	const responded = int.calls.some((c) =>
		["reply", "editReply", "deferReply", "followUp", "showModal", "send"].includes(c.method)
	);
	if (!responded) {
		throw new Error(
			`No response emitted. Recorded calls: ${int.calls.map((c) => c.method).join(", ") || "(none)"}`
		);
	}
}

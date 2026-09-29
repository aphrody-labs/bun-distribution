import type { Message } from "discord.js";

import { Discord, On } from "@/decorators";

@Discord()
export default class messagePinnedEvent {
	@On("messagePinned")
	async messagePinnedHandler([_message]: [Message]) {}
}

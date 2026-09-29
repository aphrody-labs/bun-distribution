import { Store as RxStore } from "rxeta";

import { apiConfig } from "@/configs";
import { Service } from "@/decorators";

type State = {
	botHasBeenReloaded: boolean;
	ready: {
		bot: boolean | null;
		api: boolean | null;
	};
	twitchAppTokens: string;
	twitchAppTokenExpiry: number;
	matchmakingQueues: Record<string, string[]>; // user IDs only
	queueLocks: Record<string, boolean>;
};

const initialState: State = {
	botHasBeenReloaded: false,
	ready: {
		bot: false,
		api: apiConfig.enabled ? false : null,
	},
	twitchAppTokens: "",
	twitchAppTokenExpiry: 0,
	matchmakingQueues: {},
	queueLocks: {},
};

@Service({
	keepInstanceAfterHmr: true,
})
export class Store extends RxStore<State> {
	constructor() {
		super(initialState);
	}
}

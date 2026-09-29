import { Controller, Get, QueryParams } from "@tsed/common";

import { Suggestions } from "@/services";
import { BaseController } from "@/utils/classes";
import { resolveDependenciesSync } from "@/utils/functions";

@Controller("/misc")
export class MiscController extends BaseController {
	private suggestions: Suggestions;

	constructor() {
		super();

		[this.suggestions] = resolveDependenciesSync([Suggestions]);
	}

	@Get("/suggest/users")
	async getUsers(@QueryParams("query") q: string) {
		return await this.suggestions.searchPlayers(q);
	}

	@Get("/suggest/clans")
	async getClans(@QueryParams("query") q: string) {
		return await this.suggestions.searchClans(q);
	}

	@Get("/suggest/all")
	async get(@QueryParams("query") q: string) {
		return await this.suggestions.searchAll(q);
	}
}

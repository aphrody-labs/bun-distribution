import { Context, Middleware } from "@tsed/common";
import { Unauthorized } from "@tsed/exceptions";

import { UserService } from "@/services";
import { resolveDependency } from "@/utils/functions";

@Middleware()
export class NotInClan {
	private userService: UserService;

	constructor() {
		resolveDependency(UserService).then((userService) => {
			this.userService = userService;
		});
	}

	async use(@Context() ctx: Context) {
		const user = ctx.get("user"); // ✅ Retrieve it from context
		if (!user) throw new Unauthorized("User not found in context");

		const isInClan = await this.userService.isClanMember(user.id);
		if (isInClan) throw new Unauthorized("You already have a Clan");
	}
}

import { Context, Middleware } from "@tsed/common";
import { Unauthorized } from "@tsed/exceptions";

import type { UserDTO } from "@/services";

@Middleware()
export class BlacklistedAuthorize {
	async use(@Context("user") user: UserDTO & { blacklisted?: boolean }) {
		if (user?.blacklisted) throw new Unauthorized(`User ${user.username} is Blacklisted`);
	}
}

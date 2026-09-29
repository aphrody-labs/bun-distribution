import { verifyAdminBearerToken } from "@rosegriffon/achillea-core";
import type { PlatformContext } from "@tsed/common";
import { Context, Middleware } from "@tsed/common";
import { BadRequest, Unauthorized } from "@tsed/exceptions";

import { env } from "@/env";

@Middleware()
export class DevAuthenticated {
	async use(@Context() { request }: PlatformContext) {
		const authHeader = request.headers.authorization;
		if (!authHeader || !authHeader.startsWith("Bearer ")) throw new BadRequest("Missing token");

		const token = authHeader.split(" ")[1];
		if (!token) throw new BadRequest("Invalid token");

		// Les sondes d'administration sont internes : elles utilisent uniquement le
		// secret API du service, jamais un bearer Discord ou un second OAuth.
		if (verifyAdminBearerToken(token, env.API_ADMIN_TOKEN)) {
			return;
		}

		throw new Unauthorized("Unauthorized");
	}
}

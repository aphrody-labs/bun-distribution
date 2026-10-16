import { auth } from "@/lib/auth";

/** OAuth 2.0 authorization-server metadata for clients using the root issuer path. */
export async function GET(request: Request) {
	return auth.api.getOAuthServerConfig({ request });
}

export async function HEAD(request: Request) {
	return auth.api.getOAuthServerConfig({ request });
}

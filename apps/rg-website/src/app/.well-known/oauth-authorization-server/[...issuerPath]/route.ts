import { auth } from "@/lib/auth";

/**
 * OAuth discovery with a pathful issuer (the Better Auth default is /api/auth).
 * The provider advertises this exact RFC 8414 location when the auth base path
 * is not the domain root.
 */
export async function GET(request: Request) {
	return auth.api.getOAuthServerConfig({ request });
}

export async function HEAD(request: Request) {
	return auth.api.getOAuthServerConfig({ request });
}

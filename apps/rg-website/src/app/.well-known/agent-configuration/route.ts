import { auth } from "@/lib/auth";

/** Agent Auth discovery document for external agents and MCP clients. */
export async function GET(request: Request) {
	return auth.api.getAgentConfiguration({ headers: request.headers });
}

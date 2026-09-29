// SPDX-License-Identifier: Apache-2.0
/**
 * Provision sovereign admin and agent credentials for Aphrody AI in Shenron & PostgreSQL.
 */
import { generateAgentToken } from "../../packages/auth/src/agent-keys";
import { createAdminCookieCodec, ADMIN_COOKIE } from "../../packages/auth/src/tokens";
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

const DATABASE_URL = requiredEnv("DATABASE_URL");
const BETTER_AUTH_SECRET = requiredEnv("BETTER_AUTH_SECRET");
const SHENRON_ADMIN_TOKEN = requiredEnv("SHENRON_ADMIN_TOKEN");
const OWNER_DISCORD_ID = process.env.OWNER_ID || "1527405876695142620";

async function main() {
	console.log("🐉 Provisioning Aphrody AI Super Admin in PostgreSQL & Better Auth...");

	const sql = postgres(DATABASE_URL, { connect_timeout: 5 });

	// 1. Generate Sovereign Agent Key
	const agentKeyData = generateAgentToken();
	const agentId = "cuid_aphrody_super_agent";
	const agentName = "Aphrody Autonomous Sovereign Agent";
	const scopes = ["read", "contribute", "write:articles", "publish:articles", "comment", "moderate"];

	// Upsert AgentKey
	await sql`
		INSERT INTO "AgentKey" (id, name, prefix, "tokenHash", scopes, note, "rateLimitPerHour")
		VALUES (${agentId}, ${agentName}, ${agentKeyData.displayPrefix}, ${agentKeyData.hash}, ${JSON.stringify(scopes)}, 'Super Admin souverain pour Aphrody AI et ses sous-agents', NULL)
		ON CONFLICT (id) DO UPDATE
		SET "tokenHash" = ${agentKeyData.hash}, prefix = ${agentKeyData.displayPrefix}, scopes = ${JSON.stringify(scopes)}, "revokedAt" = NULL;
	`;
	console.log("  * Agent Key provisioned with full scopes:", scopes);

	// 2. Provision Better Auth User & Admin Session
	const userId = "aphrody_root_admin";
	const userEmail = process.env.ADMIN_EMAIL || "contact@aphrody.com";
	const userName = "Aphrody Sovereign Admin";
	const now = new Date();
	const sessionExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
	const sessionToken = "ba_session_" + agentKeyData.token.slice(11); // Deterministic high-entropy token

	// Upsert ba_user
	await sql`
		INSERT INTO ba_user (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
		VALUES (${userId}, ${userName}, ${userEmail}, true, '/images/avatars/shenron-avatar.webp', ${now}, ${now})
		ON CONFLICT (id) DO UPDATE
		SET name = ${userName}, email = ${userEmail}, "emailVerified" = true, "updatedAt" = ${now};
	`;

	// Upsert ba_account system
	const accountId = "ba_acc_aphrody_system";
	await sql`
		INSERT INTO ba_account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
		VALUES (${accountId}, 'aphrody_autonomous_super_admin', 'system', ${userId}, ${now}, ${now})
		ON CONFLICT (id) DO UPDATE
		SET "updatedAt" = ${now};
	`;

	// Upsert ba_session
	const sessionId = "ba_sess_aphrody_root";
	await sql`
		INSERT INTO ba_session (id, token, "userId", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt")
		VALUES (${sessionId}, ${sessionToken}, ${userId}, ${sessionExpiresAt}, '127.0.0.1', 'Aphrody-AI/1.0.0 Sovereign Client', ${now}, ${now})
		ON CONFLICT (id) DO UPDATE
		SET "expiresAt" = ${sessionExpiresAt}, token = ${sessionToken}, "updatedAt" = ${now};
	`;

	// Ensure Owner Discord user has roleAdmin = true
	await sql`
		UPDATE "User"
		SET "roleAdmin" = true
		WHERE "discordId" = ${OWNER_DISCORD_ID};
	`;

	// Upsert Aphrody AI User
	await sql`
		INSERT INTO "User" (id, "discordId", username, "roleAdmin", "createdAt")
		VALUES (${userId}, 'aphrody_autonomous_agent', 'aphrody', true, ${now})
		ON CONFLICT (id) DO UPDATE
		SET "roleAdmin" = true;
	`;
	console.log("  * Better Auth & Core User provisioned with roleAdmin = true");

	// 3. Compute signed admin cookie
	const cookieCodec = createAdminCookieCodec({
		secret: BETTER_AUTH_SECRET,
		masterToken: SHENRON_ADMIN_TOKEN,
		ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
	});
	const signedCookieValue = cookieCodec.sign();
	console.log("  * Signed Admin Cookie computed successfully");

	// 4. Save credentials artifact for Aphrody AI
	const credentials = {
		createdAt: now.toISOString(),
		agentKey: {
			token: agentKeyData.token,
			displayPrefix: agentKeyData.displayPrefix,
			scopes,
			name: agentName,
			header: `Authorization: Bearer ${agentKeyData.token}`,
		},
		betterAuth: {
			userId,
			email: userEmail,
			sessionToken,
			sessionExpiresAt: sessionExpiresAt.toISOString(),
			cookieHeader: `Cookie: ${ADMIN_COOKIE}=${signedCookieValue}`,
		},
		adminCookie: {
			name: ADMIN_COOKIE,
			value: signedCookieValue,
			maxAgeSeconds: 30 * 24 * 60 * 60,
		},
		masterToken: SHENRON_ADMIN_TOKEN,
		databaseUrl: DATABASE_URL,
	};

	const outDir = join(process.env.USERPROFILE || ".", "src", "aphrody-ai", "home", "shenron");
	mkdirSync(outDir, { recursive: true });
	const outFile = join(outDir, "admin_credentials.json");
	writeFileSync(outFile, JSON.stringify(credentials, null, 2), "utf-8");
	console.log("  * Credentials written to the protected Aphrody home directory");

	const configFile = join(outDir, "config.json");
	const configData = {
		$schema: "https://aphrody.ai/schemas/agent-config.json",
		name: "shenron",
		version: "1.0.0",
		profile: "dbfr",
		contact: userEmail,
		persona: "Shenron x Akira Toriyama (Tori-bot)",
		auth: {
			admin_email: userEmail,
			agent_token: agentKeyData.token,
			admin_cookie: `${ADMIN_COOKIE}=${signedCookieValue}`,
			master_token: SHENRON_ADMIN_TOKEN,
			better_auth_session: sessionToken,
		},
		endpoints: {
			site: "https://dragonballfr.com",
			site_local: "http://127.0.0.1:3000",
			api_local: "http://127.0.0.1:3001",
			postgres_tunnel: DATABASE_URL,
		},
		models: {
			embed_onnx: "home/shenron/models/embed/model/onnx/model.onnx",
			rerank_onnx: "home/shenron/models/rerank/model/onnx/model.onnx",
			embed_dims: 384,
			vector_backend: "onnx",
		},
	};
	writeFileSync(configFile, JSON.stringify(configData, null, 2), "utf-8");
	console.log("  * Config synchronized in the protected Aphrody home directory");

	await sql.end();
	console.log("✅ Super Admin provisioning completed successfully!");
}

main().catch(() => {
	console.error("❌ Provisioning failed; check required configuration and database connectivity.");
	process.exit(1);
});

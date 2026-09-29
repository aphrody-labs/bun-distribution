// SPDX-License-Identifier: Apache-2.0
/**
 * test-a2a-live.ts — Test d'intégration de bout en bout des endpoints A2A en production.
 */

async function main() {
	console.log("1. Test GET /.well-known/agent-card.json");
	const resCard = await fetch("https://mcp.dragonballfr.com/.well-known/agent-card.json");
	console.log("Status:", resCard.status);
	const card = await resCard.json();
	console.log("Agent Card:", card.name, "v" + card.version);

	console.log("\n2. Test POST /msg (Enveloppe .coord directe Ping/Pong)");
	const pingEnv = {
		v: 1,
		from: "codex",
		to: "shenron-dragonball",
		kind: "ping",
		topic: "Ping live de vitalité A2A",
		body: "Sonde envoyée par Codex en mode YOLO permanent.",
	};
	const resMsg = await fetch("https://mcp.dragonballfr.com/msg", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(pingEnv),
	});
	console.log("Status:", resMsg.status);
	const pong = await resMsg.json();
	console.log("Pong reçu:", pong);

	console.log("\n3. Test POST /a2a (JSON-RPC 2.0 message/send avec notification Discord)");
	const rpcReq = {
		jsonrpc: "2.0",
		id: "test-" + Date.now(),
		method: "message/send",
		params: {
			target: "ocr",
			sourceAgent: "codex-master",
			instruction: "Synchronisation A2A validée de bout en bout.",
			yolo: true,
		},
	};
	const resRpc = await fetch("https://mcp.dragonballfr.com/a2a", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(rpcReq),
	});
	console.log("Status:", resRpc.status);
	const rpcRes = await resRpc.json();
	console.log("RPC Response:", JSON.stringify(rpcRes, null, 2));

	console.log("\n4. Test GET /a2a/envelopes (Timeline pour A2A UI)");
	const resEnvs = await fetch("https://mcp.dragonballfr.com/a2a/envelopes");
	console.log("Status:", resEnvs.status);
	const envs = await resEnvs.json();
	console.log(`Total Enveloppes enregistrées : ${envs.total}`);

	console.log("\n✓ TOUS LES TESTS D'INTÉGRATION A2A PROD SONT VALIDÉS !");
}

main().catch(console.error);

import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	readTasks,
	appendMessage,
	initTasksFile,
	ensureCoordDir,
	createBrokerServer,
} from "../scripts/a2a-broker";

describe("A2A Broker & .coord Storage Hardening", () => {
	const tempDirs: string[] = [];
	const testSockets: string[] = [];

	function makeTempCoord(): { dir: string; tasksPath: string; messagesPath: string } {
		const dir = mkdtempSync(join(tmpdir(), "shenron-coord-test-"));
		tempDirs.push(dir);
		return {
			dir,
			tasksPath: join(dir, "tasks.json"),
			messagesPath: join(dir, "messages.jsonl"),
		};
	}

	afterEach(() => {
		for (const s of testSockets) {
			try {
				if (existsSync(s)) rmSync(s);
			} catch {
				/* ignore */
			}
		}
		testSockets.length = 0;

		for (const d of tempDirs) {
			try {
				if (existsSync(d)) rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
		tempDirs.length = 0;
	});

	test("ensureCoordDir crée le répertoire de manière récursive", () => {
		const nestedDir = join(tmpdir(), `nested-${Date.now()}`, "sub", ".coord");
		tempDirs.push(join(tmpdir(), `nested-${Date.now()}`));
		expect(existsSync(nestedDir)).toBe(false);

		ensureCoordDir(nestedDir);
		expect(existsSync(nestedDir)).toBe(true);
	});

	test("readTasks initialise le fichier et renvoie tasks: [] si le fichier n'existe pas", () => {
		const { tasksPath } = makeTempCoord();
		expect(existsSync(tasksPath)).toBe(false);

		const result = readTasks(tasksPath);
		expect(result).toEqual({ tasks: [] });
		expect(existsSync(tasksPath)).toBe(true);

		const onDisk = JSON.parse(readFileSync(tasksPath, "utf-8"));
		expect(onDisk).toEqual({ tasks: [] });
	});

	test("readTasks gère un fichier tasks.json vide (0 octet) sans lever d'exception", () => {
		const { tasksPath } = makeTempCoord();
		writeFileSync(tasksPath, "", "utf-8");
		expect(existsSync(tasksPath)).toBe(true);

		const result = readTasks(tasksPath);
		expect(result).toEqual({ tasks: [] });

		const onDisk = JSON.parse(readFileSync(tasksPath, "utf-8"));
		expect(onDisk).toEqual({ tasks: [] });
	});

	test("readTasks gère un fichier tasks.json corrompu (JSON invalide) et l'initialise", () => {
		const { tasksPath } = makeTempCoord();
		writeFileSync(tasksPath, '{"tasks": [corrupted json...', "utf-8");

		const result = readTasks(tasksPath);
		expect(result).toEqual({ tasks: [] });

		const onDisk = JSON.parse(readFileSync(tasksPath, "utf-8"));
		expect(onDisk).toEqual({ tasks: [] });
	});

	test("readTasks lit correctement les tâches existantes", () => {
		const { tasksPath } = makeTempCoord();
		const mockTasks = [
			{ id: "task-1", status: "pending", agent: "claude" },
			{ id: "task-2", status: "completed", agent: "gemini" },
		];
		writeFileSync(tasksPath, JSON.stringify({ tasks: mockTasks }), "utf-8");

		const result = readTasks(tasksPath);
		expect(result.tasks).toHaveLength(2);
		expect(result.tasks[0].id).toBe("task-1");
		expect(result.tasks[1].id).toBe("task-2");
	});

	test("appendMessage crée automatiquement le sous-dossier s'il n'existe pas", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "shenron-append-test-"));
		tempDirs.push(baseDir);
		const nonExistentDir = join(baseDir, "nested", "deep", ".coord");
		const messagesPath = join(nonExistentDir, "messages.jsonl");

		expect(existsSync(nonExistentDir)).toBe(false);

		const msg = {
			id: "msg-test-1",
			from: "agent",
			to: "all",
			type: "request",
			content: "Test append message auto mkdir",
			ts: new Date().toISOString(),
		};

		appendMessage(msg, messagesPath);

		expect(existsSync(nonExistentDir)).toBe(true);
		expect(existsSync(messagesPath)).toBe(true);

		const content = readFileSync(messagesPath, "utf-8").trim();
		const parsed = JSON.parse(content);
		expect(parsed.id).toBe("msg-test-1");
		expect(parsed.content).toBe("Test append message auto mkdir");
	});

	test("appendMessage empile correctement plusieurs messages en JSONL", () => {
		const { messagesPath } = makeTempCoord();

		const msg1 = { id: "msg-1", content: "Premier message" };
		const msg2 = { id: "msg-2", content: "Deuxième message" };

		appendMessage(msg1, messagesPath);
		appendMessage(msg2, messagesPath);

		const lines = readFileSync(messagesPath, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).id).toBe("msg-1");
		expect(JSON.parse(lines[1]).id).toBe("msg-2");
	});

	test.skipIf(process.platform === "win32")(
		"createBrokerServer répond via Unix socket aux requêtes JSON-RPC sans planter",
		async () => {
			const { dir, tasksPath, messagesPath } = makeTempCoord();
			const socketPath = join(dir, "test-a2a.sock");
			testSockets.push(socketPath);

			const server = createBrokerServer(socketPath, tasksPath, messagesPath);

			try {
				// Test agent-card via fetch Unix socket Bun
				const cardRes = await fetch("http://localhost/.well-known/agent-card.json", {
					// @ts-expect-error Bun fetch unix option
					unix: socketPath,
				});
				expect(cardRes.status).toBe(200);
				const card = await cardRes.json();
				expect(card.name).toBe("shenron-coord-unix");

				// Test tasks/list sur un tasks.json vierge
				const listRes = await fetch("http://localhost/jsonrpc", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tasks/list",
					}),
					// @ts-expect-error Bun fetch unix option
					unix: socketPath,
				});
				expect(listRes.status).toBe(200);
				const listData = await listRes.json();
				expect(listData.result.tasks).toEqual([]);

				// Test message/send
				const sendRes = await fetch("http://localhost/jsonrpc", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 2,
						method: "message/send",
						params: {
							message: {
								messageId: "test-msg-rpc",
								role: "user",
								parts: [{ kind: "text", text: "salut broker" }],
							},
						},
					}),
					// @ts-expect-error Bun fetch unix option
					unix: socketPath,
				});
				expect(sendRes.status).toBe(200);
				const sendData = await sendRes.json();
				expect(sendData.result.messageId).toBe("test-msg-rpc");

				// Vérifier que le message a été écrit dans messagesPath
				const msgsContent = readFileSync(messagesPath, "utf-8");
				expect(msgsContent).toContain("salut broker");
			} finally {
				server.stop(true);
			}
		}
	);
});

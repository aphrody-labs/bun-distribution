// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const sender = join(import.meta.dir, "envoie-ocr-results.ts");
let temporaryDirectory: string;
let commandLog: string;
let fakeSsh: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "shenron-ocr-sender-"));
  commandLog = join(temporaryDirectory, "commands.jsonl");
  fakeSsh = join(temporaryDirectory, "aphrody-ssh");
  writeFileSync(
    fakeSsh,
    `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_COMMAND_LOG!, JSON.stringify(args) + "\\n");
if (args[0] === "exec" && args.includes("--cmd")) {
  const command = args[args.indexOf("--cmd") + 1]!;
  if (command.startsWith("printf")) process.stdout.write(process.env.TEST_REMOTE_HOME! + "\\n");
  else if (command.includes("recoit-ocr-results.ts")) process.stdout.write("{\\"ok\\":true}\\n");
}
`,
  );
  chmodSync(fakeSsh, 0o755);
});

afterEach(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

function validSnapshot(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ocr_pages (status TEXT NOT NULL);
    CREATE TABLE ocr_blocks (id INTEGER PRIMARY KEY);
    INSERT INTO ocr_pages (status) VALUES ('done');
    INSERT INTO ocr_blocks DEFAULT VALUES;
  `);
  db.close();
}

async function invoke(snapshot: string, remoteHome = "/home/ocr user's home") {
  return Bun.spawn([process.execPath, sender, "--snapshot", snapshot], {
    env: {
      ...process.env,
      APHRODY_SSH_BIN: fakeSsh,
      TEST_COMMAND_LOG: commandLog,
      TEST_REMOTE_HOME: remoteHome,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("envoie-ocr-results", () => {
  it("rejects a corrupt snapshot before invoking Aphrody SSH", async () => {
    const snapshot = join(temporaryDirectory, "corrupt.db");
    writeFileSync(snapshot, "not sqlite");

    const corrupt = await invoke(snapshot);
    const [corruptStdout, corruptStderr, corruptCode] = await Promise.all([
      new Response(corrupt.stdout).text(),
      new Response(corrupt.stderr).text(),
      corrupt.exited,
    ]);
    expect(corruptCode).not.toBe(0);
    expect(corruptStdout).toBe("");
    expect(corruptStderr).toContain("snapshot rejected before transfer");

    const wrongSchema = join(temporaryDirectory, "wrong-schema.db");
    const db = new Database(wrongSchema);
    db.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    db.close();
    const schema = await invoke(wrongSchema);
    const [schemaStdout, schemaStderr, schemaCode] = await Promise.all([
      new Response(schema.stdout).text(),
      new Response(schema.stderr).text(),
      schema.exited,
    ]);
    expect(schemaCode).not.toBe(0);
    expect(schemaStdout).toBe("");
    expect(schemaStderr).toContain("missing tables: ocr_pages, ocr_blocks");
    expect(() => readFileSync(commandLog, "utf8")).toThrow();
  });

  it("uploads to a unique path before invoking the atomic receiver", async () => {
    const snapshot = join(temporaryDirectory, "results.snapshot.db");
    validSnapshot(snapshot);

    const send = async () => {
      const child = await invoke(snapshot);
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain('"ok":true');
    };
    await send();
    await send();

    const commands = readFileSync(commandLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(commands).toHaveLength(6);
    const uploadedPaths = [0, 1].map((attempt) => {
      const offset = attempt * 3;
      expect(commands[offset]?.[0]).toBe("exec");
      expect(commands[offset + 1]?.[0]).toBe("sftp");
      expect(commands[offset + 2]?.[0]).toBe("exec");
      const upload = commands[offset + 1]![commands[offset + 1]!.indexOf("--path") + 1]!;
      expect(upload).toMatch(
        /^\/home\/ocr user's home\/\.aphrody\/ocr\/results\.db\.upload\.[0-9a-f-]{36}$/i,
      );
      const receiverCommand = commands[offset + 2]![commands[offset + 2]!.indexOf("--cmd") + 1]!;
      expect(receiverCommand).toContain(`--depuis '${upload.replaceAll("'", "'\\''")}'`);
      expect(receiverCommand).toContain("scripts/ops/recoit-ocr-results.ts");
      return upload;
    });
    expect(uploadedPaths[0]).not.toBe(uploadedPaths[1]);
  });
});

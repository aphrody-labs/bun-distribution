// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APIS,
  type Gcloud,
  envBlock,
  mergeEnvBlock,
  runtimeEnvironment,
  serviceAccount,
  validateLocation,
  validateProject,
} from "./gcp.ts";

const work = mkdtempSync(join(tmpdir(), "aphrody-gcp-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const API_KEY = `AIza${"x".repeat(35)}`;
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** Scripted gcloud: records calls, writes the key file like `keys create`, answers lookups. */
function fakeGcloud(state: { account: boolean; apiKey: boolean }) {
  const calls: { args: string[]; env?: Record<string, string> }[] = [];
  const run: Gcloud = (args, env) => {
    calls.push({ args, env });
    const line = args.join(" ");
    if (line.startsWith("iam service-accounts list"))
      return ok(
        state.account ? "aphrody-bot@aphrody.iam.gserviceaccount.com\n" : "",
      );
    if (line.startsWith("iam service-accounts keys create")) {
      writeFileSync(args[4]!, '{"type":"service_account"}');
      return ok();
    }
    if (line.startsWith("services api-keys list"))
      return ok(state.apiKey ? "projects/1/locations/global/keys/k\n" : "");
    if (line.startsWith("services api-keys get-key-string"))
      return ok(`${API_KEY}\n`);
    if (line.startsWith("services api-keys create")) return ok(`${API_KEY}\n`);
    if (line === "auth print-access-token") return ok("ya29.token\n");
    if (line.startsWith("services list --enabled"))
      return ok("a.googleapis.com\nb.googleapis.com\n");
    return ok();
  };
  return { run, calls };
}

describe("validation and runtime contract", () => {
  test("project and location identifiers are checked before any gcloud call", () => {
    expect(validateProject("aphrody")).toBe("aphrody");
    expect(() => validateProject("Aphrody; rm")).toThrow("projet");
    expect(validateLocation("us-central1")).toBe("us-central1");
    expect(() => validateLocation("us central")).toThrow("région");
  });

  test("the runtime contract matches aphrody google env and the Vertex SDK switches", () => {
    expect(runtimeEnvironment("aphrody", "us-central1")).toEqual({
      GOOGLE_CLOUD_PROJECT: "aphrody",
      GCLOUD_PROJECT: "aphrody",
      CLOUDSDK_CORE_PROJECT: "aphrody",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_CLOUD_REGION: "us-central1",
      GOOGLE_GENAI_USE_VERTEXAI: "true",
      APHRODY_GCP_AUTH: "adc-or-secret-manager",
    });
  });
});

describe(".env block", () => {
  const block = envBlock({
    name: "aphrody-bot",
    project: "aphrody",
    email: "aphrody-bot@aphrody.iam.gserviceaccount.com",
    location: "us-central1",
    keyFile: "/r/secrets/aphrody-bot.json",
    apiKey: "K",
  });

  test("replaces only the owned keys and stays stable on rerun", () => {
    const original =
      "DISCORD_BOT_TOKEN=keep\r\nGOOGLE_API_KEY=old\n# --- GCP service account (x) ---\nOTHER=1\n\n";
    const once = mergeEnvBlock(original, block);
    expect(once).toStartWith(
      "DISCORD_BOT_TOKEN=keep\nOTHER=1\n\n# --- GCP service account (aphrody-bot)",
    );
    expect(once.match(/^GOOGLE_API_KEY=/gm)).toHaveLength(1);
    expect(mergeEnvBlock(once, block)).toBe(once);
    expect(mergeEnvBlock("", block)).toBe(block);
  });
});

describe("service account provisioning", () => {
  test("first run creates the account, key and API key, then verifies in a throwaway config", async () => {
    const root = mkdtempSync(join(work, "first-"));
    writeFileSync(join(root, ".env"), "KEEP=1\n");
    const { run, calls } = fakeGcloud({ account: false, apiKey: false });
    const lines: string[] = [];
    const report = await serviceAccount(
      {
        project: "aphrody",
        name: "aphrody-bot",
        location: "us-central1",
        root,
        rotate: false,
      },
      run,
      (line) => lines.push(line),
    );
    const commands = calls.map((call) => call.args.slice(0, 3).join(" "));
    expect(commands).toContain("iam service-accounts create");
    expect(commands).toContain("services api-keys create");
    expect(
      calls.filter((call) => call.args[1] === "enable" && call.args.length > 5),
    ).toHaveLength(Math.ceil(APIS.length / 20));
    const isolated = calls.filter((call) => call.env?.CLOUDSDK_CONFIG);
    expect(isolated.map((call) => call.args[0])).toEqual([
      "auth",
      "auth",
      "services",
    ]);
    expect(existsSync(isolated[0]!.env!.CLOUDSDK_CONFIG!)).toBe(false);
    expect(report).toEqual({
      email: "aphrody-bot@aphrody.iam.gserviceaccount.com",
      keyFile: join(root, "secrets", "aphrody-bot.json"),
      apis: 2,
      token: 10,
    });
    expect(
      readFileSync(join(root, "secrets", "aphrody-api-key.txt"), "utf8"),
    ).toBe(API_KEY);
    const env = readFileSync(join(root, ".env"), "utf8");
    expect(env).toStartWith(
      "KEEP=1\n\n# --- GCP service account (aphrody-bot)",
    );
    expect(env).toContain(`GEMINI_API_KEY=${API_KEY}`);
    expect(lines.join("\n")).not.toContain(API_KEY);
    expect(lines.join("\n")).not.toContain("ya29");
    const { daclSddl } = await import("./win32-user.ts");
    for (const secret of ["aphrody-bot.json", "aphrody-api-key.txt"]) {
      const path = join(root, "secrets", secret);
      if (process.platform === "win32")
        expect(daclSddl(path)).toMatch(/^D:PAI\(A;;FA;;;S-1-5-21-[\d-]+\)$/);
      else expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  test("a rerun keeps the key and the API key unless rotation is asked", async () => {
    const root = mkdtempSync(join(work, "again-"));
    const state = { account: true, apiKey: true };
    const first = fakeGcloud(state);
    await serviceAccount(
      {
        project: "aphrody",
        name: "aphrody-bot",
        location: "us-central1",
        root,
        rotate: false,
      },
      first.run,
      () => {},
    );
    const again = fakeGcloud(state);
    await serviceAccount(
      {
        project: "aphrody",
        name: "aphrody-bot",
        location: "us-central1",
        root,
        rotate: false,
      },
      again.run,
      () => {},
    );
    const commands = again.calls.map((call) => call.args.slice(0, 4).join(" "));
    expect(commands).not.toContain("iam service-accounts create aphrody-bot");
    expect(commands).not.toContain("iam service-accounts keys create");
    expect(commands).toContain(
      "services api-keys get-key-string projects/1/locations/global/keys/k",
    );
    const rotated = fakeGcloud(state);
    await serviceAccount(
      {
        project: "aphrody",
        name: "aphrody-bot",
        location: "us-central1",
        root,
        rotate: true,
      },
      rotated.run,
      () => {},
    );
    expect(
      rotated.calls.some(
        (call) =>
          call.args.slice(0, 4).join(" ") ===
          "iam service-accounts keys create",
      ),
    ).toBe(true);
  });

  test("a missing root or a failing gcloud stops before writing secrets", async () => {
    const { run } = fakeGcloud({ account: true, apiKey: true });
    await expect(
      serviceAccount(
        {
          project: "aphrody",
          name: "aphrody-bot",
          location: "us-central1",
          root: join(work, "nope"),
          rotate: false,
        },
        run,
        () => {},
      ),
    ).rejects.toThrow("racine absente");
    const root = mkdtempSync(join(work, "fail-"));
    const failing: Gcloud = (args) =>
      args[0] === "projects"
        ? { code: 1, stdout: "", stderr: "PERMISSION_DENIED" }
        : run(args);
    await expect(
      serviceAccount(
        {
          project: "aphrody",
          name: "aphrody-bot",
          location: "us-central1",
          root,
          rotate: false,
        },
        failing,
        () => {},
      ),
    ).rejects.toThrow("PERMISSION_DENIED");
    expect(existsSync(join(root, "secrets"))).toBe(false);
  });
});

#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Google Cloud host operations (Infra owner), Bun only, non-interactive:
 *
 *   bun --no-env-file scripts/tools/infra/gcp.ts runtime [--project aphrody] [--location us-central1]
 *   bun --no-env-file scripts/tools/infra/gcp.ts service-account [--project aphrody]
 *       [--name aphrody-bot] [--location us-central1] [--root <dir>] [--rotate]
 *
 * `runtime` selects the gcloud project and persists the non-secret runtime contract read by
 * gcloud, ADC, the Google SDKs and `aphrody google` (user environment on Windows, `export`
 * lines elsewhere). `service-account` creates or reuses the service account, binds
 * roles/owner, enables the Aphrody API set, keeps or rotates its JSON key under
 * `<root>/secrets`, prepares the unrestricted `aphrody-full` API key, rewrites the owned
 * `.env` block and proves access by minting a token in a throwaway gcloud configuration.
 * Keys and tokens are written to owner-only files, never printed.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type GcloudResult = { code: number; stdout: string; stderr: string };
export type Gcloud = (args: string[], env?: Record<string, string>) => GcloudResult;
export type Log = (line: string) => void;

export const API_KEY_DISPLAY = "aphrody-full";
export const ENV_KEYS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
  "GCP_SERVICE_ACCOUNT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_REGION",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
] as const;
const BLOCK_HEADER = "# --- GCP service account";

/** Core API set of the Aphrody project, enabled in batches of 20 (SU_MAX_BATCH_SIZE). */
export const APIS = [
  "aiplatform.googleapis.com",
  "generativelanguage.googleapis.com",
  "cloudaicompanion.googleapis.com",
  "storage.googleapis.com",
  "storage-component.googleapis.com",
  "secretmanager.googleapis.com",
  "bigquery.googleapis.com",
  "bigquerystorage.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "serviceusage.googleapis.com",
  "compute.googleapis.com",
  "run.googleapis.com",
  "cloudfunctions.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "pubsub.googleapis.com",
  "firestore.googleapis.com",
  "cloudkms.googleapis.com",
  "datastore.googleapis.com",
  "translate.googleapis.com",
  "texttospeech.googleapis.com",
  "speech.googleapis.com",
  "vision.googleapis.com",
  "documentai.googleapis.com",
  "language.googleapis.com",
  "videointelligence.googleapis.com",
  "logging.googleapis.com",
  "monitoring.googleapis.com",
  "drive.googleapis.com",
  "sheets.googleapis.com",
  "docs.googleapis.com",
  "gmail.googleapis.com",
  "people.googleapis.com",
  "calendar-json.googleapis.com",
  "customsearch.googleapis.com",
];

/** gcloud without a console window; its output (possibly secret) is captured, never echoed. */
export const gcloud: Gcloud = (args, env) => {
  const run = Bun.spawnSync(["gcloud", ...args], {
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "ignore",
    windowsHide: true,
  });
  return {
    code: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
};

function must(run: Gcloud, args: string[], env?: Record<string, string>): string {
  const result = run(args, env);
  if (result.code !== 0)
    throw new Error(`gcloud ${args.slice(0, 4).join(" ")} : ${result.stderr.trim() || result.code}`);
  return result.stdout.trim();
}

export function validateProject(project: string): string {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error(`projet invalide : ${project}`);
  return project;
}

export function validateLocation(location: string): string {
  if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(location)) throw new Error(`région invalide : ${location}`);
  return location;
}

/** Non-secret runtime contract (gcloud, ADC, google-genai on Vertex, `aphrody google`). */
export function runtimeEnvironment(project: string, location: string): Record<string, string> {
  return {
    GOOGLE_CLOUD_PROJECT: project,
    GCLOUD_PROJECT: project,
    CLOUDSDK_CORE_PROJECT: project,
    GOOGLE_CLOUD_LOCATION: location,
    GOOGLE_CLOUD_REGION: location,
    GOOGLE_GENAI_USE_VERTEXAI: "true",
    APHRODY_GCP_AUTH: "adc-or-secret-manager",
  };
}

/** Application Default Credentials written by `gcloud auth application-default login`. */
export function adcPath(env: NodeJS.ProcessEnv = process.env): string {
  const config =
    env.CLOUDSDK_CONFIG ??
    (process.platform === "win32"
      ? join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "gcloud")
      : join(homedir(), ".config", "gcloud"));
  return join(config, "application_default_credentials.json");
}

export async function runtime(
  project: string,
  location: string,
  run: Gcloud = gcloud,
  log: Log = console.log,
): Promise<void> {
  must(run, ["config", "set", "project", validateProject(project), "--quiet"]);
  const env = runtimeEnvironment(project, validateLocation(location));
  if (process.platform === "win32") {
    const { setUserEnvironment } = await import("./win32-user.ts");
    setUserEnvironment(env);
    log(`GOOGLE_CLOUD_PROJECT=${project}`);
    log(`GOOGLE_CLOUD_LOCATION=${location}`);
  } else {
    for (const [name, value] of Object.entries(env)) log(`export ${name}=${value}`);
  }
  log(`ADC_PRESENT=${existsSync(adcPath())}`);
  log("No token, API key or credential content was read or printed.");
}

/** Owner-only file: protected current-user DACL on Windows, mode 0600 elsewhere. */
export async function ownerOnly(path: string): Promise<void> {
  if (process.platform === "win32") {
    const { restrictToCurrentUser } = await import("./win32-user.ts");
    restrictToCurrentUser(path, false);
  } else {
    chmodSync(path, 0o600);
  }
}

/** Drops the owned keys and block header from `.env`, then appends the fresh block. */
export function mergeEnvBlock(current: string, block: string): string {
  const owned = new RegExp(`^(?:${ENV_KEYS.join("|")})=`);
  const kept = current
    .split(/\r?\n/)
    .filter(line => !owned.test(line) && !line.startsWith(BLOCK_HEADER))
    .join("\n")
    .trimEnd();
  return kept ? `${kept}\n\n${block}` : block;
}

export function envBlock(values: {
  name: string;
  project: string;
  email: string;
  location: string;
  keyFile: string;
  apiKey: string;
}): string {
  const { name, project, email, location, keyFile, apiKey } = values;
  return [
    `${BLOCK_HEADER} (${name}) — géré par scripts/tools/infra/gcp.ts service-account ---`,
    `GOOGLE_APPLICATION_CREDENTIALS=${keyFile}`,
    `GOOGLE_CLOUD_PROJECT=${project}`,
    `GCLOUD_PROJECT=${project}`,
    `CLOUDSDK_CORE_PROJECT=${project}`,
    `GCP_SERVICE_ACCOUNT=${email}`,
    `GOOGLE_CLOUD_LOCATION=${location}`,
    `GOOGLE_CLOUD_REGION=${location}`,
    `GOOGLE_API_KEY=${apiKey}`,
    `GEMINI_API_KEY=${apiKey}`,
    "",
  ].join("\n");
}

export type ServiceAccountOptions = {
  project: string;
  name: string;
  location: string;
  root: string;
  rotate: boolean;
};

export type ServiceAccountReport = {
  email: string;
  keyFile: string;
  apis: number;
  token: number;
};

export async function serviceAccount(
  options: ServiceAccountOptions,
  run: Gcloud = gcloud,
  log: Log = console.log,
): Promise<ServiceAccountReport> {
  const project = validateProject(options.project);
  const location = validateLocation(options.location);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.name))
    throw new Error(`service account invalide : ${options.name}`);
  const root = resolve(options.root);
  if (!existsSync(root)) throw new Error(`racine absente : ${root}`);
  const secrets = join(root, "secrets");
  const keyFile = join(secrets, `${options.name}.json`);
  const apiKeyFile = join(secrets, "aphrody-api-key.txt");
  const envFile = join(root, ".env");
  const email = `${options.name}@${project}.iam.gserviceaccount.com`;
  const step = (line: string) => log(`==> ${line}`);

  step(`Service account ${email}`);
  const listed = must(run, [
    "iam",
    "service-accounts",
    "list",
    "--project",
    project,
    `--filter=email:${email}`,
    "--format=value(email)",
  ]);
  if (!listed) {
    must(run, [
      "iam",
      "service-accounts",
      "create",
      options.name,
      "--project",
      project,
      "--display-name",
      options.name,
    ]);
    log("    créé.");
  } else log("    déjà présent.");

  step("Liaison IAM roles/owner");
  must(run, [
    "projects",
    "add-iam-policy-binding",
    project,
    `--member=serviceAccount:${email}`,
    "--role=roles/owner",
    "--condition=None",
    "--quiet",
  ]);

  step(`Activation de ${APIS.length} APIs (idempotent)`);
  for (let i = 0; i < APIS.length; i += 20)
    must(run, ["services", "enable", ...APIS.slice(i, i + 20), "--project", project]);

  mkdirSync(secrets, { recursive: true });
  if (options.rotate || !existsSync(keyFile)) {
    step(`Génération clé JSON -> ${keyFile}`);
    must(run, ["iam", "service-accounts", "keys", "create", keyFile, "--iam-account", email]);
  } else step("Clé existante conservée (--rotate pour régénérer)");
  if (!existsSync(keyFile)) throw new Error(`clé absente après création : ${keyFile}`);
  await ownerOnly(keyFile);

  step(`Clé API (${API_KEY_DISPLAY})`);
  must(run, ["services", "enable", "apikeys.googleapis.com", "--project", project]);
  const keyName = must(run, [
    "services",
    "api-keys",
    "list",
    "--project",
    project,
    `--filter=displayName:${API_KEY_DISPLAY}`,
    "--format=value(name)",
  ]).split(/\r?\n/)[0];
  const apiKey = keyName
    ? must(run, ["services", "api-keys", "get-key-string", keyName, "--format=value(keyString)"])
    : must(run, [
        "services",
        "api-keys",
        "create",
        `--display-name=${API_KEY_DISPLAY}`,
        "--project",
        project,
        "--format=value(response.keyString)",
      ]);
  if (!/^[\w-]{20,}$/.test(apiKey)) throw new Error("clé API absente ou illisible");
  writeFileSync(apiKeyFile, apiKey);
  await ownerOnly(apiKeyFile);
  log(`    clé API prête (${apiKey.length} caractères).`);

  step("Mise à jour .env");
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const block = envBlock({
    name: options.name,
    project,
    email,
    location,
    keyFile,
    apiKey,
  });
  writeFileSync(envFile, mergeEnvBlock(current, block));

  step("Vérification de l'accès (configuration gcloud jetable)");
  const config = mkdtempSync(join(tmpdir(), "aphrody-gcp-"));
  try {
    const isolated = { CLOUDSDK_CONFIG: config };
    must(run, ["auth", "activate-service-account", `--key-file=${keyFile}`], isolated);
    const token = must(run, ["auth", "print-access-token"], isolated);
    if (!token) throw new Error("impossible de minter un token");
    const apis = must(
      run,
      ["services", "list", "--enabled", "--project", project, "--format=value(config.name)"],
      isolated,
    )
      .split(/\r?\n/)
      .filter(Boolean).length;
    log(`    OK : token minté (${token.length} caractères), ${apis} APIs actives.`);
    return { email, keyFile, apis, token: token.length };
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
}

const USAGE =
  "usage : bun --no-env-file scripts/tools/infra/gcp.ts runtime|service-account [--project p] [--location l] [--name sa] [--root dir] [--rotate]";

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string", default: "aphrody" },
      location: { type: "string", default: "us-central1" },
      name: { type: "string", default: "aphrody-bot" },
      root: { type: "string" },
      rotate: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  try {
    if (values.help) console.log(USAGE);
    else if (positionals[0] === "runtime") await runtime(values.project, values.location);
    else if (positionals[0] === "service-account") {
      const report = await serviceAccount({
        project: values.project,
        location: values.location,
        name: values.name,
        root: values.root ?? process.env.APHRODY_ROOT ?? resolve(import.meta.dir, "../../../../"),
        rotate: values.rotate,
      });
      console.log(`Terminé. SA=${report.email}  clé=${report.keyFile}  APIs=${report.apis}`);
    } else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`gcp : ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

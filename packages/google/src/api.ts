// SPDX-License-Identifier: Apache-2.0
import { chmodSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { docs } from "@googleapis/docs";
import { auth as googleAuth, drive } from "@googleapis/drive";
import type { Credentials } from "google-auth-library";

// Use the client constructor exported by googleapis-common to avoid private-type
// collisions when its auth-library differs from the workspace version.
type OAuth2Client = InstanceType<typeof googleAuth.OAuth2>;

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
] as const;

type ClientFile = {
  installed?: { client_id: string; client_secret: string; redirect_uris?: string[] };
};
type TokenFile = Credentials;

export function googlePaths(env: NodeJS.ProcessEnv = process.env) {
  const home = env.HOME;
  if (!home) throw new Error("HOME is required for the private Google credential store");
  const privateDir = `${home}/.aphrody/private/google`;
  return {
    client: env.APHRODY_GOOGLE_OAUTH_CLIENT_JSON ?? `${privateDir}/aphrody-oauth-client.json`,
    token: env.APHRODY_GOOGLE_OAUTH_TOKEN_JSON ?? `${privateDir}/aphrody-oauth-token.json`,
    serviceAccount: env.APHRODY_GOOGLE_SERVICE_ACCOUNT_JSON ?? `${privateDir}/aphrody-bot.json`,
  };
}

async function jsonFile<T>(path: string): Promise<T> {
  if (!(await Bun.file(path).exists())) throw new Error(`Missing private Google credential file: ${path}`);
  return (await Bun.file(path).json()) as T;
}

export async function saveOAuthToken(token: TokenFile, path = googlePaths().token): Promise<void> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export async function oauthClient(requireToken = true): Promise<OAuth2Client> {
  const paths = googlePaths();
  const config = await jsonFile<ClientFile>(paths.client);
  const installed = config.installed;
  if (!installed?.client_id || !installed.client_secret)
    throw new Error("Expected an installed Google OAuth client JSON");
  const redirect = installed.redirect_uris?.find(uri => uri.startsWith("http://localhost")) ?? "http://localhost";
  const client = new googleAuth.OAuth2(installed.client_id, installed.client_secret, redirect);
  if (await Bun.file(paths.token).exists()) {
    const saved = await jsonFile<TokenFile>(paths.token);
    client.setCredentials(saved);
    client.on("tokens", tokens => {
      const merged = {
        ...client.credentials,
        ...tokens,
        refresh_token: tokens.refresh_token ?? saved.refresh_token,
      };
      void saveOAuthToken(merged, paths.token);
    });
  } else if (requireToken) {
    throw new Error(`Google OAuth is not connected. Run: yolo google drive auth-login`);
  }
  return client;
}

export async function gcloudUserClient(): Promise<OAuth2Client> {
  const account = process.env.APHRODY_GOOGLE_GCLOUD_ACCOUNT;
  if (!account) throw new Error("APHRODY_GOOGLE_GCLOUD_ACCOUNT is required for gcloud-user auth");
  const processResult = Bun.spawn(
    ["gcloud", "auth", "print-access-token", `--account=${account}`, "--scopes=https://www.googleapis.com/auth/drive"],
    { windowsHide: true, stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
    processResult.exited,
  ]);
  if (exitCode !== 0 || !output.trim()) throw new Error(`gcloud user access token unavailable: ${errors.trim()}`);
  const client = new googleAuth.OAuth2();
  client.setCredentials({ access_token: output.trim(), expiry_date: Date.now() + 3_000_000 });
  return client;
}

export type GoogleIdentity = "oauth-user" | "gcloud-user" | "service-account";

export async function googleApi(
  identity: GoogleIdentity = (process.env.APHRODY_GOOGLE_DRIVE_AUTH as GoogleIdentity | undefined) ?? "oauth-user",
) {
  const auth =
    identity === "oauth-user"
      ? await oauthClient()
      : identity === "gcloud-user"
        ? await gcloudUserClient()
        : new googleAuth.GoogleAuth({
            keyFile: googlePaths().serviceAccount,
            scopes: [...GOOGLE_SCOPES],
          });
  return {
    auth,
    drive: drive({ version: "v3", auth }),
    docs: docs({ version: "v1", auth }),
  };
}

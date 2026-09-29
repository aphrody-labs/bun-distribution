// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { GOOGLE_SCOPES, googleApi, googlePaths, oauthClient, saveOAuthToken } from "./api.ts";
import { syncAgentHome } from "./drive-sync.ts";

async function login(): Promise<void> {
  const client = await oauthClient(false);
  const state = randomBytes(24).toString("hex");
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/") return new Response("Not found", { status: 404 });
      if (url.searchParams.get("state") !== state) {
        rejectCode(new Error("OAuth state mismatch"));
        return new Response("Invalid OAuth state", { status: 400 });
      }
      const error = url.searchParams.get("error");
      if (error) {
        rejectCode(new Error(`Google OAuth: ${error}`));
        return new Response("Google authorization was declined", { status: 400 });
      }
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing authorization code", { status: 400 });
      resolveCode(code);
      return new Response("Aphrody Google Drive authorization complete. You may close this page.");
    },
  });
  try {
    const redirectUri = `http://localhost:${server.port}`;
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [...GOOGLE_SCOPES],
      state,
      redirect_uri: redirectUri,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
    });
    console.log(`Open this Google authorization URL:\n${url}`);
    const opener = Bun.which("xdg-open");
    if (opener) {
      const process = Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
      void process.exited;
    }
    const timeout = setTimeout(() => rejectCode(new Error("OAuth callback timed out after five minutes")), 300_000);
    try {
      const code = await codePromise;
      const response = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
      if (!response.tokens.refresh_token) throw new Error("Google did not grant an offline refresh token");
      await saveOAuthToken(response.tokens, googlePaths().token);
      console.log("Google OAuth token saved in the private Aphrody credential store.");
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    server.stop(true);
  }
}

async function status(): Promise<void> {
  const paths = googlePaths();
  const privateFiles = {
    oauthClient: await Bun.file(paths.client).exists(),
    oauthToken: await Bun.file(paths.token).exists(),
    serviceAccount: await Bun.file(paths.serviceAccount).exists(),
  };
  let folder: { id?: string | null; name?: string | null; canAddChildren?: boolean } | null = null;
  const authMode = process.env.APHRODY_GOOGLE_DRIVE_AUTH ?? "oauth-user";
  if (authMode === "gcloud-user" || privateFiles.oauthToken) {
    const { drive } = await googleApi();
    const id = process.env.APHRODY_GOOGLE_DRIVE_FOLDER_ID;
    if (id) {
      const response = await drive.files.get({ fileId: id, fields: "id,name,capabilities(canAddChildren)", supportsAllDrives: true });
      folder = { id: response.data.id, name: response.data.name, canAddChildren: response.data.capabilities?.canAddChildren };
    }
  }
  console.log(JSON.stringify({ authMode, privateFiles, folder }, null, 2));
}

export async function runDriveCli(args: string[]): Promise<void> {
  const command = args[0];
  if (command === "auth-login") await login();
  else if (command === "status") await status();
  else if (command === "sync") await syncAgentHome({ dryRun: args.includes("--dry-run") });
  else throw new Error("Usage: aphrody-google drive <auth-login|status|sync [--dry-run]>");
}

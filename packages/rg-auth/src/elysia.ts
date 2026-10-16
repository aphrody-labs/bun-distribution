import { agentAuth } from "@better-auth/agent-auth";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { admin, jwt, openAPI } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { getPgPool } from "@rosegriffon/db/pg";
import { commonAuthOptions } from "./core";
import { resolveAuthSecret, resolveTrustedOrigins } from "./runtime-config";

const secret = resolveAuthSecret();

const baseURL =
  process.env.BETTER_AUTH_API_URL ||
  process.env.BETTER_AUTH_URL ||
  `http://localhost:${process.env.API_PORT ?? "8800"}`;

const transporter = nodemailer.createTransport({
  auth: {
    pass: process.env.SMTP_PASSWORD,
    user: process.env.SMTP_USER,
  },
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 5_000,
});

async function sendAuthEmail(to: string, subject: string, url: string): Promise<void> {
  const html = `<!doctype html><html lang="fr"><body style="font-family:sans-serif;max-width:560px;margin:2rem auto">
	<h1>${subject}</h1><p>Utilise le bouton ci-dessous pour continuer.</p>
	<p><a href="${url}" style="display:inline-block;padding:.75rem 1.25rem;background:#a14b3f;color:#fff;border-radius:999px;text-decoration:none">Continuer</a></p>
	<p>Si tu n'es pas à l'origine de cette demande, ignore ce message.</p></body></html>`;

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD || process.env.MOCK_EMAIL === "true") {
    console.info(`[auth] email mocké pour ${to}: ${url}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Rose Griffon" <contact@rosegriffon.fr>',
    to,
    subject,
    text: `${subject}: ${url}`,
    html,
  });
}

/** Better Auth instance mounted directly by the Elysia API. */
export const elysiaAuth = betterAuth({
  ...commonAuthOptions,
  database: getPgPool({ applicationName: "rosegriffon-better-auth" }),
  baseURL,
  basePath: "/v1/auth",
  secret,
  trustedOrigins: resolveTrustedOrigins(baseURL),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) =>
      sendAuthEmail(user.email, "Réinitialiser ton mot de passe — Rose Griffon", url),
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) =>
      sendAuthEmail(user.email, "Confirme ton adresse — Rose Griffon", url),
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    // The workspace can retain two compatible @better-auth/core peer instances
    // under Bun; the runtime package versions are pinned together in the lockfile.
    apiKey({
      defaultPrefix: "rg_",
      requireName: true,
      enableMetadata: true,
      rateLimit: { enabled: true, maxRequests: 1_000, timeWindow: 60 * 60 * 1_000 },
    }) as unknown as ReturnType<typeof admin>,
    jwt(),
    agentAuth({
      providerName: "Rose Griffon",
      providerDescription: "Rose Griffon authentication and community capabilities.",
      deviceAuthorizationPage: "/device/capabilities",
      capabilities: [
        {
          name: "auth.health",
          description: "Check that the authenticated Rose Griffon auth service is available.",
          input: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
      onExecute: async ({ capability, agentSession }) => {
        if (capability !== "auth.health") throw new Error("Unsupported capability");
        return { ok: true, userId: agentSession.user.id };
      },
    }),
    openAPI(),
  ],
});

export type ElysiaAuth = typeof elysiaAuth;

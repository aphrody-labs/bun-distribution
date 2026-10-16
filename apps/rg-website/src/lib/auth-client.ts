import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { resolveAuthBaseURL } from "./auth-base-url";

const getBaseURL = () => {
  return resolveAuthBaseURL({
    origin: typeof window !== "undefined" ? window.location.origin : null,
    configured: process.env.BETTER_AUTH_URL,
    production: process.env.NODE_ENV === "production",
  });
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        if (typeof window !== "undefined") {
          window.location.href = "/2fa";
        }
      },
    }),
  ],
});

export type ClientSession = typeof authClient.$Infer.Session;

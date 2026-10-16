export {
  ACHILLEA_AUTH_ISSUER,
  ACHILLEA_REALTIME_AUDIENCE,
  ACHILLEA_REALTIME_TTL_SECONDS,
  ACHILLEA_SESSION_AUDIENCE,
  ACHILLEA_SESSION_COOKIE_NAME,
  ACHILLEA_SESSION_TTL_SECONDS,
  signAchilleaSessionToken,
  signAchilleaRealtimeToken,
  type AchilleaSessionIdentity,
} from "./achillea-session";

export {
  commonAuthOptions,
  ensureUserProfile,
  githubProvider,
  googleProvider,
  isAdmin,
  isStaff,
  resolveProfile,
} from "./core";

export { deuxFacteurs } from "./two-factor";

export {
  type AccountEmailMessage,
  type AccountEmailSender,
  type AccountOptionsInput,
  createAccountOptions,
} from "./account-options";

export {
  createRoseGriffonAuth,
  type PatreonAuthIntegration,
  type RoseGriffonAuth,
  type RoseGriffonAuthOptions,
} from "./factory";

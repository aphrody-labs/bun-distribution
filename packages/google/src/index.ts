/** Canonical Google/Gemini facade backed by this workspace's own modules. */
export * from "./runtime.ts";
export * from "./vertex.ts";
export * from "./api.ts";
export * from "./drive-sync.ts";
export * from "./drive-model-sync.ts";

/** Google account authentication and data operations backed by the native
 * credential-store SDK. Explicit target reads return tokens to the Bun process;
 * no implicit credential-store writes or migrations occur. */
export {
  googleAuthStatus,
  googleLogin,
  googleWhoami,
  googleModels,
  googleGenerate,
  googleGenerateStream,
  type GoogleModel,
  type GoogleProfile,
} from "./auth.ts";

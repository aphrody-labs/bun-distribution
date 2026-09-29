/** Canonical Google/Gemini facade. Implementations remain in BXC. */
export * from "@aphrody/bxc/google";
export * from "@aphrody/bxc/google/gemini-web";
export * from "@aphrody/bxc/google/gemini-session";
export * from "./runtime.ts";
export * from "./vertex.ts";

/** Google account authentication and data operations backed by the native
 * credential-store SDK. OAuth tokens never enter the Bun process. */
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

import { createVertex } from "@ai-sdk/google-vertex";
import { generateText } from "ai";
import { googleAuthStatus, googleGenerate, googleGenerateStream } from "./auth.ts";
import { googleRuntime, type GoogleRuntime } from "./runtime.ts";

export interface GoogleGeminiRequest {
  prompt: string;
  signal?: AbortSignal;
  model?: string;
}

export interface GoogleGeminiClient {
  complete(request: GoogleGeminiRequest): Promise<string>;
  stream(request: GoogleGeminiRequest): ReadableStream<string>;
}

/** Create an ADC-backed Vertex Gemini client from the shared runtime contract. */
export function createGoogleGeminiClient(runtime: GoogleRuntime = googleRuntime()): GoogleGeminiClient {
  const vertex = createVertex({ project: runtime.project, location: runtime.location });

  return {
    async complete({ prompt, signal, model = "gemini-2.5-flash" }) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const nativeAuth =
        Bun.env.APHRODY_GOOGLE_AUTH === "antigravity" ||
        (!Bun.env.APHRODY_GOOGLE_AUTH &&
          (await googleAuthStatus().then(
            () => true,
            () => false,
          )));
      if (nativeAuth) {
        const result = await googleGenerate(prompt, model);
        const content = (
          result as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
        ).candidates?.[0]?.content?.parts
          ?.map(part => part.text ?? "")
          .join("");
        return content ?? "";
      }
      const result = await generateText({
        // Vertex 5 exposes the runtime-compatible model as V4 while the
        // workspace AI SDK type currently resolves to V3/V2.
        model: vertex(model) as unknown as Parameters<typeof generateText>[0]["model"],
        prompt,
        abortSignal: signal,
      });
      return result.text;
    },
    stream({ prompt, signal, model = "gemini-2.5-flash" }) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      return googleGenerateStream(prompt, model, signal);
    },
  };
}

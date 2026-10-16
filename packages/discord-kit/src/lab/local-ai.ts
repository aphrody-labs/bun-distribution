// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from "node:path";
import type {
  NativeChatInput,
  NativeChatResult,
  NativeInferenceOptions,
} from "@aphrody/bun/src/inference.js";

export type LocalAISelection = NativeInferenceOptions;
export type LocalAIInput = NativeChatInput;
export type LocalAIResult = NativeChatResult;

export interface LocalAISession {
  chat(input: LocalAIInput): Promise<LocalAIResult>;
  close(): Promise<void>;
}
export type OpenLocalAI = (
  selection: LocalAISelection,
  controls: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<LocalAISession>;

async function openNative(
  selection: LocalAISelection,
  controls: Parameters<OpenLocalAI>[1],
) {
  // This subpath loads only the existing inference ABI; unrelated tooling/UI symbols are not required.
  const { NativeInference } = await import("@aphrody/bun/src/inference.js");
  return NativeInference.open(selection, controls);
}

function validate(selection: LocalAISelection) {
  if (
    typeof selection.model !== "string" ||
    !selection.model.trim() ||
    isAbsolute(selection.model) ||
    typeof selection.profile !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(selection.profile)
  )
    throw new Error(
      "A catalog model reference and explicit named Agent Home profile are required",
    );
  if (
    selection.context !== undefined &&
    (!Number.isSafeInteger(selection.context) ||
      selection.context < 512 ||
      selection.context > 8192)
  )
    throw new RangeError("Local AI context must be between 512 and 8192");
  if (
    selection.gpuLayers !== undefined &&
    (!Number.isSafeInteger(selection.gpuLayers) || selection.gpuLayers < 0)
  )
    throw new RangeError("Local AI GPU layers must be a nonnegative integer");
  if (selection.lora !== undefined && !isAbsolute(selection.lora))
    throw new Error(
      "The installed LoRA adapter must have an absolute protected-store path",
    );
}

/** Native inference with one active turn and no idle model residency in this process. */
export class NativeLocalAI implements AsyncDisposable {
  #tail: Promise<unknown> = Promise.resolve();
  #queued = 0;
  #closing = false;

  constructor(private readonly open: OpenLocalAI = openNative) {}

  async chat(
    selection: LocalAISelection,
    input: LocalAIInput,
  ): Promise<LocalAIResult> {
    validate(selection);
    input.signal?.throwIfAborted();
    if (this.#closing) throw new Error("Local AI is closing");
    if (this.#queued >= 32) throw new Error("Local AI queue is full");
    const timeout = input.timeoutMs ?? 120_000;
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new RangeError("Local AI timeout must be positive and finite");
    const deadline = performance.now() + timeout;
    const remaining = () => {
      input.signal?.throwIfAborted();
      const timeoutMs = deadline - performance.now();
      if (timeoutMs <= 0)
        throw new DOMException("Local AI deadline exceeded", "TimeoutError");
      return { signal: input.signal, timeoutMs };
    };
    this.#queued++;
    const turn = this.#tail.then(async () => {
      const session = await this.open(
        {
          ...selection,
          context: selection.context ?? 4096,
          gpuLayers: selection.gpuLayers ?? 0,
        },
        remaining(),
      );
      try {
        const result = await session.chat({ ...input, ...remaining() });
        if (
          !result.text.trim() ||
          result.model !== selection.model ||
          result.profile !== selection.profile
        )
          throw new Error(
            "Local AI returned an invalid model/profile identity",
          );
        return result;
      } finally {
        // Complete native generations/destructors before another model or profile opens.
        await session.close();
      }
    });
    this.#tail = turn.catch(() => undefined);
    try {
      return await turn;
    } finally {
      this.#queued--;
    }
  }

  async close(): Promise<void> {
    this.#closing = true;
    await this.#tail;
  }
  [Symbol.asyncDispose]() {
    return this.close();
  }
}

export const localAI = new NativeLocalAI();

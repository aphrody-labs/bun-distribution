// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
/**
 * Repository text formatting conventions, without a pinned model vocabulary or tokenizer.
 * Media tags are placeholders, not encoded image/audio payloads. These conventions
 * have not been qualified against an upstream Gemma 4 tokenizer configuration.
 */

export const GEMMA4_SPECIAL_TOKENS = {
  BOS: "<bos>",
  EOS: "<eos>",
  START_OF_TURN: "<start_of_turn>",
  END_OF_TURN: "<end_of_turn>",
  THOUGHT_START: "<thought>",
  THOUGHT_END: "</thought>",
  IMAGE_PLACEHOLDER: "<image>",
  AUDIO_PLACEHOLDER: "<audio>",
  PAD: "<pad>",
  UNK: "<unk>",
} as const;

export interface Gemma4Message {
  role: "system" | "user" | "model" | "assistant";
  content: string;
  thought?: string | undefined;
  imageCount?: number | undefined;
  audioCount?: number | undefined;
}

const MAX_TEXT_LENGTH = 1_048_576;

/** Formats bounded text and placeholder tags; native providers own actual tokenization. */
export function formatGemma4ChatPrompt(
  messages: readonly Gemma4Message[],
  options: { addGenerationPrompt?: boolean; includeBos?: boolean } = {},
): string {
  if (!Array.isArray(messages) || messages.length > 10_000)
    throw new Error("messages must be an array of at most 10000 turns");
  let total = 0;
  for (const msg of messages) {
    if (!msg || !["system", "user", "model", "assistant"].includes(msg.role)) throw new Error("Invalid message role");
    if (typeof msg.content !== "string" || (msg.thought !== undefined && typeof msg.thought !== "string"))
      throw new Error("Message content and thought must be text");
    for (const count of [msg.imageCount, msg.audioCount]) {
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count > 1024))
        throw new Error("Media placeholder counts must be integers between 0 and 1024");
    }
    total +=
      msg.content.length + (msg.thought?.length ?? 0) + (msg.imageCount ?? 0) * 7 + (msg.audioCount ?? 0) * 7 + 80;
    if (total > MAX_TEXT_LENGTH) throw new Error("Conversation exceeds the text budget");
  }
  const includeBos = options.includeBos ?? true;
  const addGenerationPrompt = options.addGenerationPrompt ?? true;

  let prompt = includeBos ? GEMMA4_SPECIAL_TOKENS.BOS : "";

  let systemPrompt = "";
  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + msg.content.trim();
    }
  }

  let firstUserTurnHandled = false;

  for (const msg of messages) {
    if (msg.role === "system") continue;

    const roleName = msg.role === "assistant" ? "model" : msg.role;
    let turnContent = "";

    // If there is a system prompt, inject it at the top of the first user turn
    if (roleName === "user" && !firstUserTurnHandled && systemPrompt) {
      turnContent += `${systemPrompt}\n\n`;
      firstUserTurnHandled = true;
    }

    // Prepend multimodal tags if specified
    if (msg.imageCount && msg.imageCount > 0) {
      turnContent += `${GEMMA4_SPECIAL_TOKENS.IMAGE_PLACEHOLDER.repeat(msg.imageCount)}\n`;
    }
    if (msg.audioCount && msg.audioCount > 0) {
      turnContent += `${GEMMA4_SPECIAL_TOKENS.AUDIO_PLACEHOLDER.repeat(msg.audioCount)}\n`;
    }

    if (roleName === "model" && msg.thought) {
      turnContent += `${GEMMA4_SPECIAL_TOKENS.THOUGHT_START}\n${msg.thought.trim()}\n${GEMMA4_SPECIAL_TOKENS.THOUGHT_END}\n`;
    }

    turnContent += msg.content;

    prompt += `${GEMMA4_SPECIAL_TOKENS.START_OF_TURN}${roleName}\n${turnContent}${GEMMA4_SPECIAL_TOKENS.END_OF_TURN}\n`;
  }

  if (addGenerationPrompt) {
    prompt += `${GEMMA4_SPECIAL_TOKENS.START_OF_TURN}model\n`;
  }

  return prompt;
}

/** Shared incremental/full-response tag parser. Streaming need not retain reasoning text. */
export class Gemma4ResponseParser {
  #pending = "";
  #thought = "";
  #inThought = false;
  #spaces = "";
  #started = false;
  #finished = false;
  constructor(readonly collectThought: boolean = true) {}

  #consume(value: string): string {
    if (this.#inThought) {
      if (this.collectThought) {
        if (this.#thought.length + value.length > MAX_TEXT_LENGTH) throw new Error("Reasoning exceeds the text budget");
        this.#thought += value;
      }
      return "";
    }
    let visible = this.#spaces + value;
    if (!this.#started) visible = visible.trimStart();
    const trimmed = visible.trimEnd();
    this.#spaces = visible.slice(trimmed.length);
    if (this.#spaces.length > MAX_TEXT_LENGTH) throw new Error("Whitespace exceeds the text budget");
    if (trimmed) this.#started = true;
    return trimmed;
  }

  push(text: string): string {
    if (this.#finished) throw new Error("Response parser is already finished");
    if (typeof text !== "string") throw new Error("Response delta must be text");
    this.#pending += text;
    const markers = [
      GEMMA4_SPECIAL_TOKENS.THOUGHT_START,
      GEMMA4_SPECIAL_TOKENS.THOUGHT_END,
      GEMMA4_SPECIAL_TOKENS.END_OF_TURN,
      GEMMA4_SPECIAL_TOKENS.EOS,
    ];
    let output = "";
    while (this.#pending) {
      let index = -1;
      let marker = "";
      for (const candidate of markers) {
        const found = this.#pending.indexOf(candidate);
        if (found !== -1 && (index === -1 || found < index)) {
          index = found;
          marker = candidate;
        }
      }
      if (index === -1) {
        let keep = 0;
        for (const candidate of markers) {
          for (let size = 1; size < candidate.length; size++) {
            if (this.#pending.endsWith(candidate.slice(0, size))) keep = Math.max(keep, size);
          }
        }
        output += this.#consume(this.#pending.slice(0, this.#pending.length - keep));
        this.#pending = keep ? this.#pending.slice(-keep) : "";
        break;
      }
      output += this.#consume(this.#pending.slice(0, index));
      this.#pending = this.#pending.slice(index + marker.length);
      if (marker === GEMMA4_SPECIAL_TOKENS.THOUGHT_START) {
        if (!this.#inThought && this.collectThought && this.#thought) this.#thought += "\n";
        this.#inThought = true;
      } else if (marker === GEMMA4_SPECIAL_TOKENS.THOUGHT_END) this.#inThought = false;
    }
    return output;
  }

  finish(): { text: string; thought: string | null } {
    if (this.#finished) throw new Error("Response parser is already finished");
    this.#finished = true;
    const text = this.#consume(this.#pending);
    this.#pending = "";
    this.#spaces = "";
    return { text, thought: this.#thought.trim() || null };
  }
}

/** Parse exactly the same tags and trimming rules used by streaming. */
export function parseGemma4Response(rawOutput: string): {
  thought: string | null;
  content: string;
} {
  if (typeof rawOutput !== "string" || rawOutput.length > MAX_TEXT_LENGTH)
    throw new Error("Response exceeds the text budget or is not text");
  const parser = new Gemma4ResponseParser();
  const prefix = parser.push(rawOutput);
  const final = parser.finish();
  return { content: prefix + final.text, thought: final.thought };
}

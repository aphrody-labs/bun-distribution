// SPDX-License-Identifier: Apache-2.0

export { XaiClient, XaiError, Chat, type XaiClientOptions } from "./core/client.ts";
export {
  runGrokXResearch,
  type GrokXResearchInput,
  type GrokXResearchResult,
} from "./agent.ts";
export {
  resolveAuth,
  loadGrokAuthFile,
  XAI_API_BASE,
  type ResolvedAuth,
} from "./core/session.ts";
export type {
  AuthMode,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  MessageContentPart,
  Tool,
  ToolCall,
  ModelInfo,
  ModelsListResponse,
  TtsRequest,
} from "./core/types.ts";

export { system, user, assistant } from "./core/types.ts";

// The X function tools are web-layer code owned by @aphrody/x (aphrody-web); re-exported so
// Grok agent code can take everything from this package.
export {
  XTools,
  xSearchToolDef,
  xProfileToolDef,
  xWhoamiToolDef,
  xTweetsToolDef,
  xNewsToolDef,
  xNativeTools,
  type XSearchToolArgs,
  type XProfileToolArgs,
  type XTweetsToolArgs,
  type XNewsToolArgs,
} from "@aphrody/x";

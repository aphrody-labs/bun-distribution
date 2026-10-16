// SPDX-License-Identifier: Apache-2.0
/**
 * `@aphrody/a2a`: A2A 1.0 client. Types are generated from `a2a.proto`, the same schema the Rust
 * `aphrody-a2a-pb` crate compiles. The pre-1.0 dialect shim lives in `@aphrody/a2a/legacy`.
 */
export * from "./generated/a2a.ts";
export * from "./protocol.ts";
export * from "./errors.ts";
export { readSse, type SseEvent } from "./sse.ts";
export type { CallOptions, HeadersProvider, HttpOptions } from "./http.ts";
export {
  AgentCardCache,
  agentCardUrl,
  fetchAgentCard,
  majorMinor,
  normalizeAgentCard,
  selectInterface,
  type DiscoveryOptions,
  type InterfaceSelection,
  type SelectOptions,
} from "./card.ts";
export {
  JsonRpcTransport,
  RestTransport,
  type MethodRequest,
  type MethodResponse,
  type Transport,
  type TransportOptions,
  type UnaryMethod,
} from "./transport.ts";
export {
  A2AClient,
  type A2AClientOptions,
  type ConnectOptions,
  type Params,
} from "./client.ts";
export * from "./helpers.ts";
export { parsePushNotification, verifyPushAuthorization } from "./push.ts";

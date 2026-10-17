// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/ag-ui
 *
 * Full-stack Bun + TS 7 AG-UI Protocol Suite for Aphrody.
 * Provides typed event-driven agent lifecycle streaming, binary Protobuf transport,
 * A2UI declarative component generation, and Agent-to-User reactive adapters.
 */

// Core Protocol & Schema
export * from "@ag-ui/core";
export { EventEncoder, type EventEncoderParams } from "@ag-ui/encoder";
export { encode as encodeProto, decode as decodeProto, AGUI_MEDIA_TYPE } from "@ag-ui/proto";

// Client runtime & transformers
export * from "@ag-ui/client";

// A2UI Declarative UI Toolkit
export * from "@ag-ui/a2ui-toolkit";

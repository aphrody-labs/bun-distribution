// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/m3-ai - AgUiEventStream
 *
 * Full-duplex Agent-to-User (A2U) streaming and A2A fleet bridge:
 * - Maps AG-UI v1.0 protocol events (text chunks, tool calls, reasoning, state, subagents)
 *   into native Material Design 3 TranscriptSteps and TranscriptItems.
 * - Bridges Aphrody A2A CoordEnvelope fleet messages (ask/fact/ack/ping/error) to and from AG-UI events.
 * - Provides reactive state accumulator and streaming parser.
 */

import {
  EventType,
  type BaseEvent,
  type TextMessageContentEvent,
  type ToolCallStartEvent,
  type ToolCallArgsEvent,
  type ToolCallResultEvent,
  type ReasoningMessageContentEvent,
  type SubagentStartedEvent,
  type SubagentFinishedEvent,
  type SubagentErrorEvent,
  type RunErrorEvent,
} from "./ag-ui";
import {
  type TranscriptStep,
  type TranscriptItem,
  pairTranscriptSteps,
  tryParseJson,
} from "./types";

// ---------------------------------------------------------------------------
// A2A Coordination Fleet Types
// ---------------------------------------------------------------------------

export type EnvelopeKind = "ask" | "fact" | "ack" | "ping" | "error";

export interface CoordEnvelope {
  v?: number;
  ts: string;
  id: string;
  from: string;
  to?: string;
  kind: EnvelopeKind | string;
  topic: string;
  body: string;
  re?: string;
  channel_hint?: string[];
  [key: string]: unknown;
}

export interface SubagentTrace {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  parentRunId?: string;
  error?: string;
}

export interface AgUiStreamState {
  status: "idle" | "streaming" | "completed" | "error";
  items: TranscriptItem[];
  steps: TranscriptStep[];
  reasoning: string;
  currentText: string;
  error?: string;
  subagents: SubagentTrace[];
  a2uiSurfaces: Map<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// AG-UI Events -> Transcript Steps Mapper
// ---------------------------------------------------------------------------

export class AgUiEventAccumulator {
  private steps: TranscriptStep[] = [];
  private activeText: string = "";
  private activeReasoning: string = "";
  private pendingToolCalls = new Map<string, { name: string; args: string }>();
  private toolCallNames = new Map<string, string>();
  private subagents = new Map<string, SubagentTrace>();
  private a2uiSurfaces = new Map<string, Record<string, unknown>>();
  private isFinished = false;
  private hasError = false;
  private errorMessage?: string;

  /**
   * Process a single AG-UI event and update accumulator state.
   */
  public push(event: BaseEvent): void {
    switch (event.type) {
      case EventType.RUN_STARTED: {
        this.isFinished = false;
        this.hasError = false;
        break;
      }

      case EventType.TEXT_MESSAGE_CONTENT: {
        const textEvent = event as TextMessageContentEvent;
        if (textEvent.delta) {
          this.activeText += textEvent.delta;
        }
        break;
      }

      case EventType.TEXT_MESSAGE_END: {
        if (this.activeText.length > 0) {
          this.steps.push({
            type: "action",
            content: [{ type: "text", text: this.activeText }],
          });
          this.activeText = "";
        }
        break;
      }

      case EventType.REASONING_MESSAGE_CONTENT: {
        const reasoningEvent = event as ReasoningMessageContentEvent;
        if (reasoningEvent.delta) {
          this.activeReasoning += reasoningEvent.delta;
        }
        break;
      }

      case EventType.TOOL_CALL_START: {
        const tcStart = event as ToolCallStartEvent;
        this.pendingToolCalls.set(tcStart.toolCallId, {
          name: tcStart.toolCallName,
          args: "",
        });
        this.toolCallNames.set(tcStart.toolCallId, tcStart.toolCallName);
        break;
      }

      case EventType.TOOL_CALL_ARGS: {
        const tcArgs = event as ToolCallArgsEvent;
        const pending = this.pendingToolCalls.get(tcArgs.toolCallId);
        if (pending && tcArgs.delta) {
          pending.args += tcArgs.delta;
        }
        break;
      }

      case EventType.TOOL_CALL_END: {
        const tcEnd = event as ToolCallArgsEvent;
        const pending = this.pendingToolCalls.get(tcEnd.toolCallId);
        if (pending) {
          this.steps.push({
            type: "action",
            content: [
              {
                type: "tool_call",
                id: tcEnd.toolCallId,
                name: pending.name,
                args: pending.args,
              },
            ],
          });
          this.pendingToolCalls.delete(tcEnd.toolCallId);
        }
        break;
      }

      case EventType.TOOL_CALL_RESULT: {
        const tcResult = event as ToolCallResultEvent;
        const resultContent =
          typeof tcResult.content === "string"
            ? tcResult.content
            : JSON.stringify(tcResult.content);

        // Check if tool result contains A2UI operations
        this.inspectA2uiOperations(tcResult.content);

        const toolName =
          this.toolCallNames.get(tcResult.toolCallId) ||
          (tcResult.metadata?.toolName as string) ||
          "tool";
        this.steps.push({
          type: "tool_result",
          call_id: tcResult.toolCallId,
          name: toolName,
          text: resultContent,
        });
        break;
      }

      case EventType.SUBAGENT_STARTED: {
        const subEvent = event as SubagentStartedEvent;
        this.subagents.set(subEvent.subagentRunId, {
          id: subEvent.subagentRunId,
          name: subEvent.name,
          status: "running",
          parentRunId: subEvent.parentSubagentRunId,
        });
        break;
      }

      case EventType.SUBAGENT_FINISHED: {
        const subEvent = event as SubagentFinishedEvent;
        const existing = this.subagents.get(subEvent.subagentRunId);
        if (existing) {
          existing.status = "completed";
        }
        break;
      }

      case EventType.SUBAGENT_ERROR: {
        const subEvent = event as SubagentErrorEvent;
        const existing = this.subagents.get(subEvent.subagentRunId);
        if (existing) {
          existing.status = "error";
          existing.error = subEvent.message;
        }
        break;
      }

      case EventType.RUN_FINISHED: {
        // Flush any remaining text
        if (this.activeText.length > 0) {
          this.steps.push({
            type: "action",
            content: [{ type: "text", text: this.activeText }],
          });
          this.activeText = "";
        }
        this.isFinished = true;
        break;
      }

      case EventType.RUN_ERROR: {
        const errEvent = event as RunErrorEvent;
        this.hasError = true;
        this.errorMessage = errEvent.message;
        this.isFinished = true;
        break;
      }

      default:
        // Other AG-UI events (ACTIVITY, STATE_DELTA, etc.) are kept in state
        break;
    }
  }

  /**
   * Parse A2UI operations if returned by a tool result
   */
  private inspectA2uiOperations(content: unknown): void {
    if (!content) return;
    const parsed =
      typeof content === "string" ? tryParseJson(content) : content;
    if (parsed && typeof parsed === "object" && "a2ui_operations" in parsed) {
      const ops = (
        parsed as { a2ui_operations: Array<Record<string, unknown>> }
      ).a2ui_operations;
      if (Array.isArray(ops)) {
        for (const op of ops) {
          if (op.createSurface && typeof op.createSurface === "object") {
            const surface = op.createSurface as {
              surfaceId: string;
              catalogId?: string;
            };
            this.a2uiSurfaces.set(surface.surfaceId, {
              surfaceId: surface.surfaceId,
              catalogId: surface.catalogId,
              components: [],
              dataModel: {},
            });
          } else if (
            op.updateComponents &&
            typeof op.updateComponents === "object"
          ) {
            const update = op.updateComponents as {
              surfaceId: string;
              components: unknown[];
            };
            const existing = this.a2uiSurfaces.get(update.surfaceId);
            if (existing) {
              existing.components = update.components;
            }
          } else if (
            op.updateDataModel &&
            typeof op.updateDataModel === "object"
          ) {
            const update = op.updateDataModel as {
              surfaceId: string;
              value: unknown;
            };
            const existing = this.a2uiSurfaces.get(update.surfaceId);
            if (existing) {
              existing.dataModel = update.value;
            }
          }
        }
      }
    }
  }

  /**
   * Produces the snapshot of current streaming state.
   */
  public snapshot(): AgUiStreamState {
    // If active text is streaming, include a draft action step
    const currentSteps = [...this.steps];
    if (this.activeText.length > 0) {
      currentSteps.push({
        type: "action",
        content: [{ type: "text", text: this.activeText }],
      });
    }

    const items = pairTranscriptSteps(currentSteps);

    let status: AgUiStreamState["status"] = "idle";
    if (this.hasError) {
      status = "error";
    } else if (this.isFinished) {
      status = "completed";
    } else if (currentSteps.length > 0 || this.activeReasoning.length > 0) {
      status = "streaming";
    }

    return {
      status,
      items,
      steps: currentSteps,
      reasoning: this.activeReasoning,
      currentText: this.activeText,
      error: this.errorMessage,
      subagents: Array.from(this.subagents.values()),
      a2uiSurfaces: new Map(this.a2uiSurfaces),
    };
  }

  /**
   * Alias for snapshot() for ergonomics.
   */
  public getState(): AgUiStreamState {
    return this.snapshot();
  }
}

/**
 * Converts a static list of AG-UI events into TranscriptSteps.
 */
export function agUiEventsToTranscriptSteps(
  events: BaseEvent[],
): TranscriptStep[] {
  const acc = new AgUiEventAccumulator();
  for (const event of events) {
    acc.push(event);
  }
  return acc.snapshot().steps;
}

/**
 * Converts a static list of AG-UI events into paired TranscriptItems.
 */
export function agUiEventsToTranscriptItems(
  events: BaseEvent[],
): TranscriptItem[] {
  const acc = new AgUiEventAccumulator();
  for (const event of events) {
    acc.push(event);
  }
  return acc.snapshot().items;
}

// ---------------------------------------------------------------------------
// A2A CoordEnvelope <-> AG-UI Event Bidirectional Bridge
// ---------------------------------------------------------------------------

/**
 * Translates an Aphrody A2A CoordEnvelope mailbox message into an AG-UI BaseEvent.
 */
export function coordEnvelopeToAgUiEvent(envelope: CoordEnvelope): BaseEvent {
  switch (envelope.kind) {
    case "ask":
      return {
        type: EventType.CUSTOM,
        name: "a2a_ask",
        value: {
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
          topic: envelope.topic,
          body: envelope.body,
          channel_hint: envelope.channel_hint,
          re: envelope.re,
        },
      };

    case "fact":
      return {
        type: EventType.CUSTOM,
        name: "a2a_fact",
        value: {
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
          topic: envelope.topic,
          body: envelope.body,
          re: envelope.re,
        },
      };

    case "ack":
      return {
        type: EventType.CUSTOM,
        name: "a2a_ack",
        value: {
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
          topic: envelope.topic,
          re: envelope.re,
        },
      };

    case "error":
      return {
        type: EventType.RUN_ERROR,
        message: envelope.body || envelope.topic || "Coordination error",
        code: envelope.id,
      };

    case "ping":
      return {
        type: EventType.CUSTOM,
        name: "a2a_ping",
        value: {
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
        },
      };

    default:
      return {
        type: EventType.CUSTOM,
        name: `a2a_${envelope.kind}`,
        value: envelope,
      };
  }
}

/**
 * Translates an AG-UI BaseEvent into an Aphrody A2A CoordEnvelope mailbox message.
 */
export function agUiEventToCoordEnvelope(
  event: BaseEvent,
  from: string,
  to: string = "fleet",
): CoordEnvelope {
  const ts = new Date().toISOString();
  const id = `env-${Date.now().toString(16)}`;

  if (
    event.type === EventType.CUSTOM &&
    (event as any).name?.startsWith("a2a_")
  ) {
    const val = (event as any).value || {};
    const kind = (event as any).name.replace(/^a2a_/, "");
    return {
      v: 1,
      ts: val.ts || ts,
      id: val.id || id,
      from: val.from || from,
      to: val.to || to,
      kind: kind as EnvelopeKind,
      topic: val.topic || "a2a-coordination",
      body: val.body || "",
      re: val.re,
      channel_hint: val.channel_hint,
    };
  }

  if (event.type === EventType.RUN_ERROR) {
    const err = event as RunErrorEvent;
    return {
      v: 1,
      ts,
      id,
      from,
      to,
      kind: "error",
      topic: "run-error",
      body: err.message,
    };
  }

  if (event.type === EventType.TOOL_CALL_RESULT) {
    const res = event as ToolCallResultEvent;
    return {
      v: 1,
      ts,
      id,
      from,
      to,
      kind: "fact",
      topic: (res.metadata?.toolName as string) || `tool:${res.toolCallId}`,
      body:
        typeof res.content === "string"
          ? res.content
          : JSON.stringify(res.content),
      re: res.toolCallId,
    };
  }

  // Default envelope mapping for arbitrary events
  return {
    v: 1,
    ts,
    id,
    from,
    to,
    kind: "fact",
    topic: `event:${event.type}`,
    body: JSON.stringify(event),
  };
}

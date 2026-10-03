// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/index.ts), MIT, rebuilt on Material Design 3.
// @aphrody/m3-ai - AI agent interaction components on Material Design 3

// Types
export type {
  ToolCallStatus,
  ToolCallPair,
  ActionContent,
  TranscriptStep,
  TranscriptItem,
  TaskInfo,
  MemoryInfo,
  CronJobInfo,
  AgentInfo,
  ModelOption,
  TaskStatus,
  TaskPriority,
  Subtask,
  Task,
} from "./types";

export {
  pairTranscriptSteps,
  tryParseJson,
  isErrorResult,
  TASK_STATUS_ORDER,
  TASK_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
} from "./types";

// Components
export { ToolCall } from "./ToolCall";
export type { ToolCallProps } from "./ToolCall";
export { Markdown, CodeBlock, InlineMath, BlockMath } from "./Markdown";
export type {
  MarkdownProps,
  CodeBlockProps,
  InlineMathProps,
  BlockMathProps,
} from "./Markdown";
export { MessageBubble } from "./MessageBubble";
export type { MessageBubbleProps } from "./MessageBubble";
export { InlineWorkerCard } from "./InlineWorkerCard";
export type { InlineWorkerCardProps } from "./InlineWorkerCard";
export { InlineBranchCard } from "./InlineBranchCard";
export type { InlineBranchCardProps } from "./InlineBranchCard";
export { ModelSelector, ModelOptionList, groupModelsByProvider } from "./ModelSelector";
export type { ModelSelectorProps, ModelOptionListProps } from "./ModelSelector";
export { ChatComposer } from "./ChatComposer";
export type { ChatComposerProps } from "./ChatComposer";

// Google & Gemini Desktop / Web benchmark components
export { GoogleSpotlightBar } from "./GoogleSpotlightBar";
export type { GoogleSpotlightBarProps } from "./GoogleSpotlightBar";
export {
  GeminiAccountMenu,
  ComposerMoreUploadsMenu,
} from "./GeminiAccountMenu";
export type {
  GeminiAccountMenuProps,
  ComposerMoreUploadsMenuProps,
  MenuItem,
} from "./GeminiAccountMenu";
export { GeminiPersonalContextEdit } from "./GeminiPersonalContextEdit";
export type { GeminiPersonalContextEditProps } from "./GeminiPersonalContextEdit";


// Task components
export { TaskStatusIcon } from "./TaskStatusIcon";
export type { TaskStatusIconProps } from "./TaskStatusIcon";
export { TaskPriorityIcon } from "./TaskPriorityIcon";
export type { TaskPriorityIconProps } from "./TaskPriorityIcon";
export { TaskRow } from "./TaskRow";
export type { TaskRowProps } from "./TaskRow";
export { TaskList } from "./TaskList";
export type { TaskListProps } from "./TaskList";
export { TaskDetail } from "./TaskDetail";
export type { TaskDetailProps } from "./TaskDetail";
export { TaskCreateForm } from "./TaskCreateForm";
export type { TaskCreateFormProps, TaskCreateFormData } from "./TaskCreateForm";

// AG-UI Protocol & Agent-to-User (A2U) Bridge
export { EventType } from "@aphrody/ag-ui";
export {
  AgUiEventAccumulator,
  agUiEventsToTranscriptSteps,
  agUiEventsToTranscriptItems,
  coordEnvelopeToAgUiEvent,
  agUiEventToCoordEnvelope,
} from "./AgUiEventStream";
export type {
  CoordEnvelope,
  EnvelopeKind,
  SubagentTrace,
  AgUiStreamState,
} from "./AgUiEventStream";

// Aphrody A2A (Agent-to-Agent) Fleet UI
export { A2APeerInspector } from "./A2APeerInspector";
export type { A2APeerInspectorProps, AgentPeer, SendEnvelopePayload } from "./A2APeerInspector";
export { A2ATaskTimeline } from "./A2ATaskTimeline";
export type { A2ATaskTimelineProps, TimelineStep } from "./A2ATaskTimeline";

// MCP-UI Generative Card
export { McpAppCard } from "./McpAppCard";
export type { McpAppCardProps } from "./McpAppCard";

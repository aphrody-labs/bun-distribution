// SPDX-License-Identifier: Apache-2.0
// React hook over `streamChatCompletion`: one conversation streamed from an OpenAI-compatible
// endpoint, with stop, reset and the `unavailable` status of a model that cannot answer.

"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  type ChatMessage,
  type ChatStatus,
  ChatStreamError,
  chatReducer,
  initialChatState,
  newMessageId,
  streamChatCompletion,
} from "./openaiChatStream";

export interface UseOpenAIChatOptions {
  /** API root including `/v1` (e.g. `http://127.0.0.1:8080/v1`). */
  baseUrl: string;
  model?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  initialMessages?: ChatMessage[];
  /** Messages sent before the conversation on every request (system prompt...). */
  preamble?: ChatMessage[];
  /** Extra body fields (`temperature`, `tools`...). */
  body?: Record<string, unknown>;
  /** Called with the finished assistant message. */
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: ChatStreamError) => void;
}

export interface UseOpenAIChatResult {
  messages: ChatMessage[];
  status: ChatStatus;
  error: ChatStreamError | null;
  /** Send a user message and stream the answer. Ignored while streaming. */
  send: (content: string) => Promise<void>;
  /** Abort the running request; the partial answer stays. */
  stop: () => void;
  /** Abort and clear (or replace) the conversation. */
  reset: (messages?: ChatMessage[]) => void;
  setMessages: (messages: ChatMessage[]) => void;
}

export function useOpenAIChat(
  options: UseOpenAIChatOptions,
): UseOpenAIChatResult {
  const [state, dispatch] = useReducer(
    chatReducer,
    options.initialMessages,
    initialChatState,
  );
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ options, state });

  useEffect(() => {
    latest.current = { options, state };
  });
  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(async (content: string) => {
    const { options: o, state: s } = latest.current;
    if (s.status === "streaming" || controller.current || !content.trim())
      return;
    const user: ChatMessage = { id: newMessageId(), role: "user", content };
    const assistantId = newMessageId();
    const abort = new AbortController();
    controller.current = abort;
    dispatch({ type: "start", user, assistantId });
    let assistant: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
    };
    try {
      for await (const event of streamChatCompletion({
        baseUrl: o.baseUrl,
        model: o.model,
        messages: [...(o.preamble ?? []), ...s.messages, user],
        body: o.body,
        headers: o.headers,
        fetch: o.fetch,
        signal: abort.signal,
      })) {
        dispatch({ type: "event", assistantId, event });
        assistant = chatReducer(
          { messages: [assistant], status: "streaming", error: null },
          { type: "event", assistantId, event },
        ).messages[0]!;
      }
      dispatch({ type: "finish" });
      o.onFinish?.(assistant);
    } catch (cause) {
      const error =
        cause instanceof ChatStreamError
          ? cause
          : new ChatStreamError("stream", String(cause), { cause });
      if (error.kind === "aborted" || abort.signal.aborted) {
        dispatch({ type: "stop" });
      } else {
        dispatch({ type: "fail", error });
        o.onError?.(error);
      }
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: "stop" });
  }, []);

  const reset = useCallback((messages?: ChatMessage[]) => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: "reset", messages });
  }, []);

  const setMessages = useCallback((messages: ChatMessage[]) => {
    dispatch({ type: "set", messages });
  }, []);

  return {
    messages: state.messages,
    status: state.status,
    error: state.error,
    send,
    stop,
    reset,
    setMessages,
  };
}

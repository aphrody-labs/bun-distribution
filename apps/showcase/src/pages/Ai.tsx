// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import {
  AgUiEventAccumulator,
  ChatComposer,
  MessageBubble,
  ToolCall,
  type AgUiStreamState,
} from "@aphrody/m3-ai";
import type { BaseEvent } from "@aphrody/ag-ui";
import { Button } from "@aphrody/m3-primitives";
import { Card, Code, Page, Section } from "../components/ui.tsx";
import type { PageProps } from "./index.ts";

const initial = (): AgUiStreamState => new AgUiEventAccumulator().snapshot();
export default function Ai({ adaptive }: PageProps) {
  const [draft, setDraft] = useState("Show the Material 3 package inventory.");
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState(initial);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function send() {
    if (active.current || !draft.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    const accumulator = new AgUiEventAccumulator();
    setPrompt(draft.trim());
    setState(initial());
    setNotice("");
    setRunning(true);
    try {
      const response = await fetch("/api/ai/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: draft.trim() }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("The local fixture stream is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const consume = () => {
        const packets = pending.split(/\r?\n\r?\n/);
        pending = packets.pop() ?? "";
        for (const packet of packets) {
          const data = packet
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) accumulator.push(JSON.parse(data) as BaseEvent);
        }
        if (!controller.signal.aborted) setState(accumulator.snapshot());
      };
      try {
        // eslint-disable-next-line no-await-in-loop -- Each SSE read extends the pending event frame from the previous chunk.
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          pending += decoder.decode(chunk.value, { stream: true });
          consume();
        }
        pending += decoder.decode();
        consume();
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : "The fixture stream failed.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }
  const stop = () => {
    active.current?.abort();
    active.current = null;
    setRunning(false);
    setNotice("Stream stopped.");
  };
  return (
    <Page
      title="AI"
      summary="Inspect a real AG-UI event stream through the Material 3 transcript, tool-call and composer components."
      packages={["@aphrody/m3-ai", "@aphrody/ag-ui"]}
      panes={adaptive.panes}
      aside={
        <Card>
          <h3 className="text-title-medium">Stream state</h3>
          <Code>
            {JSON.stringify(
              {
                status: state.status,
                items: state.items.length,
                subagents: state.subagents,
                fixture: true,
              },
              null,
              2,
            )}
          </Code>
        </Card>
      }
    >
      <Section
        title="Local protocol fixture"
        description="This app streams its package inventory as labelled AG-UI events."
      >
        <Card className="flex flex-col gap-4">
          <div aria-live="polite" aria-busy={running} className="flex flex-col gap-3">
            {prompt ? (
              <MessageBubble content={prompt} isUser />
            ) : (
              <p className="text-body-large text-on-surface-variant">
                Send a draft to inspect the local event fixture.
              </p>
            )}
            {state.items.map((item, index) =>
              item.kind === "tool" ? (
                <ToolCall key={item.pair.id} pair={item.pair} defaultExpanded />
              ) : (
                <MessageBubble
                  key={index}
                  content={item.text}
                  isUser={false}
                  isStreaming={running}
                  onCopy={(content) => {
                    if (!navigator.clipboard) {
                      setNotice("Clipboard access is unavailable.");
                      return;
                    }
                    void navigator.clipboard.writeText(content).then(
                      () => setNotice("Message copied."),
                      () => setNotice("Clipboard access is unavailable."),
                    );
                  }}
                />
              ),
            )}
          </div>
          <ChatComposer
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => {
              void send();
            }}
            isSending={running}
            onStop={stop}
            placeholder="Draft for the local protocol fixture"
          />
          <p role="status" className="text-body-medium text-on-surface-variant">
            {notice || (running ? "Receiving AG-UI events…" : "Ready")}
          </p>
          <Button
            variant="outlined"
            onClick={() => {
              stop();
              setPrompt("");
              setState(initial());
              setNotice("");
            }}
          >
            Reset transcript
          </Button>
        </Card>
      </Section>
    </Page>
  );
}

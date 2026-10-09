// SPDX-License-Identifier: Apache-2.0
/** Bun REPL: JS on the page's engine with Bun APIs backed by bun_wasm; not a terminal. */
import React, { useEffect, useRef, useState } from "react";
import { filesPort, processes } from "../wasm/client";
import type { ReplRequest, ReplResponse } from "../wasm/protocol";

interface Line {
  kind: "in" | "out" | "err" | "log";
  text: string;
}

const COLOR: Record<Line["kind"], string> = {
  in: "text-sky-300",
  out: "text-gray-100",
  err: "text-red-400",
  log: "text-gray-400",
};

export const BunReplApp: React.FC = () => {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState("");
  const worker = useRef<{ pid: number; worker: Worker } | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const spawned = processes.spawn("bun-repl", "bun_wasm", "repl-worker.js");
    worker.current = spawned;
    spawned.worker.onmessage = (event: MessageEvent<ReplResponse>) => {
      const m = event.data;
      if (m.type === "ready") setReady(m.bunVersion);
      else if (m.type === "log") setLines(l => [...l, { kind: m.level === "log" ? "log" : "err", text: m.text }]);
      else setLines(l => [...l, { kind: m.ok ? "out" : "err", text: m.text }]);
    };
    const port = filesPort();
    const init: ReplRequest = { type: "init", fsPort: port };
    spawned.worker.postMessage(init, [port]);
    return () => {
      processes.kill(spawned.pid);
    };
  }, []);

  const submit = () => {
    const code = input.trim();
    if (!code || !worker.current) return;
    setLines(l => [...l, { kind: "in", text: code }]);
    const req: ReplRequest = { type: "eval", id: nextId.current++, code };
    worker.current.worker.postMessage(req);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col bg-[#0f1117] font-mono text-xs text-gray-100">
      <div className="border-b border-gray-800 bg-[#161922] px-3 py-1 text-[11px] text-gray-400">
        {ready
          ? `Bun ${ready} (wasm) · Bun.semver, Bun.markdown, Bun.file, Bun.write, Bun.shellParse`
          : "Chargement de bun_wasm…"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {lines.map((l, i) => (
          <pre key={i} className={`whitespace-pre-wrap ${COLOR[l.kind]}`}>
            {l.kind === "in" ? `› ${l.text}` : l.text}
          </pre>
        ))}
      </div>
      <textarea
        className="h-20 resize-none border-t border-gray-800 bg-transparent p-2 outline-none"
        placeholder={'Bun.semver.satisfies("1.4.0", "^1.2")  (Ctrl+Entrée)'}
        value={input}
        disabled={!ready}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
    </div>
  );
};

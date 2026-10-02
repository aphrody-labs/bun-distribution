// SPDX-License-Identifier: Apache-2.0
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
// oxlint-disable-next-line import/no-unassigned-import -- xterm requires its stylesheet.
import "@xterm/xterm/css/xterm.css";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  sandboxTransport,
  tauriTransport,
  workerTransport,
  type TauriOutput,
  type Transport,
} from "@aphrody/shell-web";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "./tauri-bridge";

interface HostedShellConfig {
  websocketUrl: string;
  token: string;
  sessionId?: string;
}

function hostedShellConfig(): HostedShellConfig | undefined {
  return (window as Window & { __APHRODY_SHELL_HOST__?: HostedShellConfig }).__APHRODY_SHELL_HOST__;
}

/** The renderer owns VT parsing; transports carry raw bytes and never attach a second VT. */
function openTransport(cols: number, rows: number): Transport {
  if (isTauri()) {
    return tauriTransport(
      {
        invoke,
        listen: (event, callback) =>
          listen<TauriOutput>(event, ({ payload }) => callback({ payload })),
        createChannel: () => new Channel<TauriOutput>(),
      },
      crypto.randomUUID(),
      cols,
      rows,
    );
  }
  const hosted = hostedShellConfig();
  if (hosted) {
    if (!hosted.websocketUrl || !hosted.token) {
      throw new Error("Hosted shell needs a WebSocket URL and token");
    }
    return sandboxTransport(
      {
        resize_frame: (nextCols, nextRows) =>
          JSON.stringify({
            cols: Math.max(1, nextCols),
            rows: Math.max(1, nextRows),
            type: "resize",
          }),
      },
      hosted.websocketUrl,
      hosted.token,
      { sessionId: hosted.sessionId ?? crypto.randomUUID() },
    );
  }
  const worker = new Worker(new URL("./shell/worker.js", document.baseURI), { type: "module" });
  return workerTransport(cols, rows, worker);
}

export function ShellTerminalPanel({ onClose }: { onClose: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: 18,
      lineHeight: 1.25,
      theme: { background: "#181b20", foreground: "#e5e7eb" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    let transport: Transport;
    try {
      transport = openTransport(terminal.cols, terminal.rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      terminal.dispose();
      return;
    }
    const encoder = new TextEncoder();
    transport.onOutput((bytes) => terminal.write(bytes));
    const input = terminal.onData((data) => transport.send(encoder.encode(data)));
    const binary = terminal.onBinary((data) =>
      transport.send(Uint8Array.from(data, (character) => character.charCodeAt(0))),
    );
    const resize = terminal.onResize(({ cols, rows }) => transport.resize(cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    terminal.focus();
    return () => {
      observer.disconnect();
      resize.dispose();
      binary.dispose();
      input.dispose();
      transport.close();
      terminal.dispose();
    };
  }, []);

  return (
    <section
      aria-label="Terminal"
      className="flex h-[35vh] min-h-60 flex-col border-t border-outline-variant bg-[#181b20]"
    >
      <header className="flex h-9 shrink-0 items-center justify-between px-3 text-sm text-white">
        <span>Terminal</span>
        <button
          type="button"
          aria-label="Close terminal"
          onClick={onClose}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          Close
        </button>
      </header>
      {error ? (
        <p role="alert" className="px-3 text-sm text-error">
          {error}
        </p>
      ) : null}
      <div ref={mount} className="min-h-0 flex-1 overflow-hidden px-2 pb-2" />
    </section>
  );
}

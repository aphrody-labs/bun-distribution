// SPDX-License-Identifier: Apache-2.0
// The public terminal stays inside the browser: Rust/WASM owns the shell and VT grid,
// while its OPFS VFS is shared with the WebOS file manager.
import type { Snapshot, Terminal } from "@aphrody/webos-wasm";
import { Button, Icon } from "@aphrody/m3-primitives";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";
import { getWebOs } from "../../webos-backend";
import { keyToInput } from "./keys";

const MIN_COLS = 40;
const MAX_COLS = 180;
const MIN_ROWS = 12;
const MAX_ROWS = 60;
const CELL_WIDTH = 8.5;
const CELL_HEIGHT = 19;

function Line({ text, cursorColumn }: { text: string; cursorColumn: number | null }) {
  if (cursorColumn === null) return <div>{text || " "}</div>;
  const padded = text.padEnd(cursorColumn + 1, " ");
  return (
    <div>
      {padded.slice(0, cursorColumn)}
      <span className="bg-primary text-on-primary">{padded[cursorColumn]}</span>
      {padded.slice(cursorColumn + 1)}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function TerminalRoute() {
  const terminal = useRef<Terminal | null>(null);
  const terminalPanel = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const terminalReady = screen !== null;

  useEffect(() => {
    let cancelled = false;
    getWebOs()
      .then((os) => {
        if (cancelled) return;
        const instance = os.terminal(96, 28);
        terminal.current = instance;
        setPersistent(os.persistent);
        setScreen(instance.snapshot());
        return undefined;
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      terminal.current = null;
    };
  }, []);

  useEffect(() => {
    const panel = terminalPanel.current;
    const instance = terminal.current;
    if (!panel || !instance || typeof ResizeObserver === "undefined") return;
    const resize = () => {
      const columns = clamp(panel.clientWidth / CELL_WIDTH, MIN_COLS, MAX_COLS);
      const rows = clamp(panel.clientHeight / CELL_HEIGHT, MIN_ROWS, MAX_ROWS);
      instance.resize(columns, rows);
      setScreen(instance.snapshot());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(panel);
    resize();
    return () => observer.disconnect();
  }, [terminalReady]);

  const send = useCallback((data: string) => {
    const instance = terminal.current;
    if (!instance || instance.exited) return;
    setScreen(instance.type(data));
    setNotice("");
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyScreen();
      return;
    }
    if (event.metaKey) return;
    const input = keyToInput(event);
    if (input === null) return;
    event.preventDefault();
    send(input);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    send(event.clipboardData.getData("text").replaceAll("\r\n", "\n").replaceAll("\n", "\r"));
  };
  const onCompositionEnd = (event: CompositionEvent<HTMLDivElement>) => {
    if (event.data) send(event.data);
  };
  async function copyScreen() {
    try {
      if (!navigator.clipboard?.writeText || !screen) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(screen.lines.join("\n").trimEnd());
      setNotice("Écran copié");
    } catch {
      setNotice("Copie indisponible dans ce navigateur");
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col gap-5 overflow-hidden p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-label-large text-primary">APHRODY OS · OUTILS</p>
          <h1 className="mt-1 text-headline-medium">Terminal</h1>
          <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
            Shell Rust dans WebAssembly, avec accès au système de fichiers du navigateur.
          </p>
        </div>
        <div className="flex items-center gap-2" aria-label="Actions du terminal">
          <Button variant="text" size="md" onClick={() => send("help\r")}>
            <Icon name="help" size={18} />
            Aide
          </Button>
          <Button variant="text" size="md" onClick={() => send("clear\r")}>
            <Icon name="backspace" size={18} />
            Effacer
          </Button>
          <Button variant="outline" size="md" onClick={() => void copyScreen()} disabled={!screen}>
            <Icon name="content_copy" size={18} />
            Copier
          </Button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-extra-large border border-outline-variant bg-surface-container-low">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
            <span className="text-label-large">Session locale</span>
            <span className="text-label-medium text-on-surface-variant">·</span>
            <span className="text-label-medium text-on-surface-variant">WebAssembly</span>
          </div>
          <div className="flex items-center gap-3 text-label-medium text-on-surface-variant">
            <span>{screen ? `${screen.columns} × ${screen.rows}` : "Démarrage…"}</span>
            {persistent !== null && (
              <span className="rounded-full bg-surface-container-high px-3 py-1">
                {persistent ? "Fichiers persistants" : "Stockage temporaire"}
              </span>
            )}
          </div>
        </div>

        {error ? (
          <div className="m-4 rounded-large bg-error-container p-4 text-on-error-container">
            <p role="alert" className="text-title-medium">
              Le terminal n’a pas démarré.
            </p>
            <p className="mt-1 text-body-medium">{error}</p>
          </div>
        ) : (
          <div ref={terminalPanel} className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
            <div
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- VT grid requires custom key handling and cell rendering
              role="textbox"
              aria-label="Terminal Aphrody. Cliquez puis saisissez une commande."
              aria-multiline="true"
              aria-describedby="terminal-help"
              tabIndex={0}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionEnd={onCompositionEnd}
              className="min-h-full w-max min-w-full rounded-large bg-surface-container-lowest p-4 font-mono text-[13px] leading-[19px] whitespace-pre text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm"
            >
              {screen?.lines.map((text, row) => (
                <Line
                  // oxlint-disable-next-line react/no-array-index-key -- terminal rows are positional
                  key={row}
                  text={text}
                  cursorColumn={
                    screen.cursor.visible && screen.cursor.row === row ? screen.cursor.col : null
                  }
                />
              ))}
              {!screen && <span className="text-on-surface-variant">Chargement du shell…</span>}
            </div>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-outline-variant px-4 py-3">
          <p id="terminal-help" className="text-label-medium text-on-surface-variant">
            Entrée pour exécuter · ↑/↓ pour l’historique · Ctrl+L pour effacer · Ctrl+Maj+C pour
            copier
          </p>
          <output className="text-label-medium text-on-surface-variant" aria-live="polite">
            {notice ||
              (persistent === false
                ? "Les fichiers de cette session ne seront pas conservés après fermeture."
                : "")}
          </output>
        </footer>
      </section>
    </main>
  );
}

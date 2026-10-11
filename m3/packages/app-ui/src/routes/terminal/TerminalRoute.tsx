// SPDX-License-Identifier: Apache-2.0
// Terminal of the browser OS: the shell, the VT screen and the file system are the Rust WebAssembly
// module (crates/web/webos-wasm); this component only forwards keys and paints the screen it returns.
import type { Snapshot, Terminal } from "@aphrody/webos-wasm";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { getWebOs } from "../../webos-backend";
import { keyToInput } from "./keys";

const COLS = 96;
const ROWS = 28;

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

export function TerminalRoute() {
  const terminal = useRef<Terminal | null>(null);
  const [screen, setScreen] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getWebOs()
      .then((os) => {
        if (cancelled) return;
        terminal.current = os.terminal(COLS, ROWS);
        setPersistent(os.persistent);
        setScreen(terminal.current.snapshot());
        return undefined;
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = (data: string) => {
    if (terminal.current && !terminal.current.exited) setScreen(terminal.current.type(data));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const input = keyToInput(event);
    if (input === null) return;
    event.preventDefault();
    send(input);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    send(event.clipboardData.getData("text").replaceAll("\r\n", "\n").replaceAll("\n", "\r"));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-headline-medium">Terminal</h1>
        <p className="text-body-medium text-on-surface-variant">
          Shell Rust WebAssembly sur le même système de fichiers que Fichiers.
          {persistent
            ? ""
            : " Stockage volatil : un autre onglet détient l’écriture ou OPFS est indisponible."}
        </p>
      </header>
      {error ? (
        <p role="alert" className="text-body-large text-error">
          Le module WebAssembly n’a pas pu démarrer : {error}
        </p>
      ) : (
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a screen of styled rows with its own key handling; a native <textarea> cannot paint the VT grid
          role="textbox"
          aria-label="Terminal"
          aria-multiline="true"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="w-fit max-w-full overflow-auto rounded-large bg-surface-container-lowest p-4 font-mono text-body-medium leading-tight whitespace-pre text-on-surface outline-none focus:ring-2 focus:ring-primary"
        >
          {screen?.lines.map((text, row) => (
            <Line
              // oxlint-disable-next-line react/no-array-index-key -- rows are positional
              key={row}
              text={text}
              cursorColumn={
                screen.cursor.visible && screen.cursor.row === row ? screen.cursor.col : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

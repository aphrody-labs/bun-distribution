// SPDX-License-Identifier: Apache-2.0
/** Outils Aphrody: `aphrody pure ...` from aphrody-command-wasm, same code as the native CLI. */
import React, { useEffect, useRef, useState } from "react";
import { CLI_GLUE } from "../wasm/protocol";

interface CliGlue {
  default(): Promise<unknown>;
  run(args: string[], stdin: string, filesJson: string): string;
  version(): string;
}

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

const splitArgs = (line: string) =>
  [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? "");

export const AphrodyToolsApp: React.FC = () => {
  const glue = useRef<CliGlue | null>(null);
  const [version, setVersion] = useState("");
  const [args, setArgs] = useState("--help");
  const [stdin, setStdin] = useState("");
  const [out, setOut] = useState<Outcome | null>(null);

  useEffect(() => {
    void (async () => {
      const mod = (await import(new URL(CLI_GLUE, window.location.origin).href)) as CliGlue;
      await mod.default();
      glue.current = mod;
      setVersion(mod.version());
    })().catch((e: Error) => setOut({ code: -1, stdout: "", stderr: e.message }));
  }, []);

  const run = () => {
    if (!glue.current) return;
    setOut(JSON.parse(glue.current.run(splitArgs(args), stdin, "{}")) as Outcome);
  };

  return (
    <div className="flex h-full flex-col gap-2 bg-[#0f1117] p-3 text-xs text-gray-100">
      <div className="text-gray-400">aphrody pure {version && `· ${version}`}</div>
      <input
        className="rounded bg-[#161922] px-2 py-1 font-mono outline-none"
        value={args}
        onChange={e => setArgs(e.target.value)}
        onKeyDown={e => e.key === "Enter" && run()}
      />
      <textarea
        className="h-24 resize-none rounded bg-[#161922] p-2 font-mono outline-none"
        placeholder="stdin"
        value={stdin}
        onChange={e => setStdin(e.target.value)}
      />
      <button
        className="self-start rounded bg-indigo-600 px-3 py-1 hover:bg-indigo-500"
        onClick={run}
        disabled={!version}
      >
        Exécuter
      </button>
      {out && (
        <pre
          className={`min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono ${out.code === 0 ? "" : "text-red-300"}`}
        >
          {out.stdout}
          {out.stderr}
        </pre>
      )}
    </div>
  );
};

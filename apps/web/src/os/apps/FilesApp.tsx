// SPDX-License-Identifier: Apache-2.0
/** Fichiers: the OPFS-backed WebOS filesystem through aphrody-webos-wasm (no shell). */
import React, { useCallback, useEffect, useState } from "react";
import { files } from "../wasm/client";
import type { FsEntry } from "../wasm/protocol";

const join = (dir: string, name: string) => (dir === "/" ? `/${name}` : `${dir}/${name}`);
const parent = (dir: string) => dir.replace(/\/[^/]+$/, "") || "/";
const ask = (label: string, initial = "") => window.prompt(label, initial)?.trim();

export const FilesApp: React.FC = () => {
  const [cwd, setCwd] = useState("/home/aphrody");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (dir: string) => {
    try {
      setEntries(await files().list(dir));
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void refresh(cwd);
  }, [cwd, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError("");
      await refresh(cwd);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openEntry = async (entry: FsEntry) => {
    const path = join(cwd, entry.name);
    if (entry.kind === "dir") return setCwd(path);
    setOpen(path);
    setInfo("");
    setText(await files().readText(path));
  };

  const show = async (fn: () => Promise<unknown>) => {
    try {
      const value = await fn();
      setInfo(Array.isArray(value) ? value.join("\n") : JSON.stringify(value, null, 2));
    } catch (e) {
      setInfo((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0f1117] text-sm text-gray-100">
      <div className="flex items-center gap-2 border-b border-gray-800 bg-[#161922] px-3 py-2">
        <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setCwd(parent(cwd))}>
          ..
        </button>
        <span className="flex-1 truncate font-mono text-xs text-gray-400">{cwd}</span>
        <button
          className="rounded px-2 py-1 hover:bg-white/10"
          onClick={() => {
            const n = ask("Nouveau dossier");
            if (n) void run(() => files().mkdir(join(cwd, n)));
          }}
        >
          + Dossier
        </button>
        <button
          className="rounded px-2 py-1 hover:bg-white/10"
          onClick={() => {
            const n = ask("Nouveau fichier");
            if (n) void run(() => files().write(join(cwd, n), ""));
          }}
        >
          + Fichier
        </button>
      </div>
      {error && <div className="bg-red-900/40 px-3 py-1 text-xs text-red-300">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <ul className="w-1/2 overflow-auto border-r border-gray-800">
          {entries.map(e => (
            <li key={e.name} className="group flex items-center gap-2 px-3 py-1 hover:bg-white/5">
              <button className="flex-1 truncate text-left" onClick={() => void openEntry(e)}>
                {e.kind === "dir" ? "📁" : "📄"} {e.name}
              </button>
              <span className="font-mono text-[10px] text-gray-500">{e.kind === "file" ? e.size : ""}</span>
              <button
                className="hidden text-xs text-gray-400 group-hover:inline"
                onClick={() => {
                  const n = ask("Renommer", e.name);
                  if (n) void run(() => files().rename(join(cwd, e.name), join(cwd, n)));
                }}
              >
                ✎
              </button>
              <button
                className="hidden text-xs text-red-400 group-hover:inline"
                onClick={() => {
                  if (window.confirm(`Supprimer ${e.name} ?`)) void run(() => files().remove(join(cwd, e.name)));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="flex w-1/2 flex-col">
          {open ? (
            <>
              <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-1 text-xs">
                <span className="flex-1 truncate font-mono">{open}</span>
                <button
                  className="rounded px-2 py-0.5 hover:bg-white/10"
                  onClick={() => void run(() => files().write(open, text))}
                >
                  Enregistrer
                </button>
                <button
                  className="rounded px-2 py-0.5 hover:bg-white/10"
                  onClick={() => void show(() => files().triage(open))}
                >
                  Analyser
                </button>
                <button
                  className="rounded px-2 py-0.5 hover:bg-white/10"
                  onClick={() => void show(() => files().strings(open))}
                >
                  Chaînes
                </button>
              </div>
              <textarea
                className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs outline-none"
                value={text}
                onChange={e => setText(e.target.value)}
                spellCheck={false}
              />
              {info && (
                <pre className="max-h-48 overflow-auto border-t border-gray-800 p-2 font-mono text-[11px] text-gray-300">
                  {info}
                </pre>
              )}
            </>
          ) : (
            <div className="m-auto text-xs text-gray-500">Sélectionnez un fichier</div>
          )}
        </div>
      </div>
    </div>
  );
};

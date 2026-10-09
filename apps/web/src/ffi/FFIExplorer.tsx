// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useState } from "react";

interface FfiSources {
  header: string | null;
  rustConsumer: string | null;
  sdkSymbols: string | null;
}

type AbiProbe =
  | { available: true; library: string; version: number; major: number; minor: number }
  | { available: false; library: string; error: string };

const SOURCE_PANES: { key: keyof FfiSources; title: string; path: string }[] = [
  { key: "header", title: "aphrody.h (C ABI)", path: "crates/interop/ffi/include/aphrody.h" },
  { key: "sdkSymbols", title: "bun:ffi symbols (@aphrody/runtime-sdk)", path: "packages/engine/runtime/src/index.ts" },
  { key: "rustConsumer", title: "Rust consumer example", path: "examples/runtime-rust-extension/src/lib.rs" },
];

/**
 * Shows the YOLO runtime C ABI as it is in the repository (files served by GET /api/ffi/sources)
 * and asks the Bun server to call `yolo_abi_version` through bun:ffi (GET /api/ffi/abi).
 */
export const FFIExplorer: React.FC = () => {
  const [sources, setSources] = useState<FfiSources | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [probe, setProbe] = useState<AbiProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ffi/sources")
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return res.json() as Promise<FfiSources>;
      })
      .then(setSources)
      .catch(error => setSourcesError(error instanceof Error ? error.message : String(error)));
  }, []);

  const runProbe = async () => {
    setProbing(true);
    try {
      const res = await fetch("/api/ffi/abi");
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      setProbe(await res.json());
    } catch (error) {
      setProbe({ available: false, library: "", error: error instanceof Error ? error.message : String(error) });
    } finally {
      setProbing(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      <div>
        <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
          Native Interop & FFI
        </span>
        <h2 className="text-3xl font-black text-[var(--md-sys-color-on-surface)]">YOLO Runtime C ABI & bun:ffi</h2>
        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-1 max-w-2xl">
          The yolo_* functions are implemented in crates/engine/yolo-runtime and exported by the aphrody_ffi shared
          library (crates/interop/ffi). @aphrody/runtime-sdk loads them with dlopen. Library-owned YoloBuffer values are
          released with yolo_buffer_free.
        </p>
      </div>

      <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-base font-bold text-[var(--md-sys-color-on-surface)]">ABI probe on the Bun server</h3>
          <button
            onClick={runProbe}
            disabled={probing}
            className="px-4 py-2 rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-bold text-xs disabled:opacity-50"
          >
            {probing ? "Calling..." : "Call yolo_abi_version()"}
          </button>
        </div>
        {probe === null ? (
          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
            The server opens the library resolved by defaultLibraryPath() of @aphrody/runtime-sdk, calls
            yolo_abi_version and closes it. The value is (major &lt;&lt; 16) | minor.
          </p>
        ) : probe.available ? (
          <div className="font-mono text-xs text-emerald-300">
            {probe.library}: yolo_abi_version() = {probe.version} (ABI {probe.major}.{probe.minor})
          </div>
        ) : (
          <div className="font-mono text-xs text-rose-300">
            Library not loaded{probe.library ? ` (${probe.library})` : ""}: {probe.error}
          </div>
        )}
      </div>

      {sourcesError && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-xs text-rose-300 font-mono">
          Sources unavailable (GET /api/ffi/sources): {sourcesError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {SOURCE_PANES.map(pane => {
          const text = sources?.[pane.key] ?? null;
          return (
            <div key={pane.key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[var(--md-sys-color-primary)]" title={pane.path}>
                  {pane.title}
                </span>
                {text && (
                  <button
                    onClick={() => copyToClipboard(text, pane.key)}
                    className="px-3 py-1 rounded-full bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-[11px] font-semibold"
                  >
                    {copied === pane.key ? "Copied!" : "Copy"}
                  </button>
                )}
              </div>
              <div className="rounded-2xl bg-[#1e1e1e] p-4 font-mono text-xs text-gray-300 overflow-auto h-80">
                <pre>
                  <code>{sources === null ? "Loading..." : (text ?? `${pane.path} not found`)}</code>
                </pre>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

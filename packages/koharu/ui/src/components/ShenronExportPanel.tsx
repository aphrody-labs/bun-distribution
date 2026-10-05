// SPDX-License-Identifier: Apache-2.0
// Export native Koharu page results to Shenron as unreviewed manga candidates.
import { useEffect, useState } from "react";
import {
  mapNativeKoharuPageResult,
  toMangaReviewCandidateInput,
  type KoharuMangaPageSource,
  type MangaCandidateBinding,
} from "@shenron/pipeline/koharu";

export interface ShenronExportHost {
  isTauri(): boolean;
  invoke<T>(command: string, args: Record<string, unknown>): Promise<T | null>;
}

interface PageSummary {
  id: string;
  label: string;
  size: { width: number; height: number };
}

interface Binding {
  mangaPageId: string;
  sourceSha256: string;
  image: string;
}

type Status =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; detail: string }
  | { state: "error"; detail: string };

const STORAGE_KEY = "aphrody.koharu.shenron-export";
const fieldClass = "h-7 w-full rounded border border-border bg-transparent px-2 text-[11px]";

function loadSettings(): { apiUrl: string; token: string } {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { apiUrl?: unknown; token?: unknown };
      return {
        apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : "",
        token: typeof parsed.token === "string" ? parsed.token : "",
      };
    }
  } catch {
    // ignore unreadable storage
  }
  return { apiUrl: "", token: "" };
}

function mimeFor(image: string): KoharuMangaPageSource["mime"] {
  if (/\.jpe?g$/i.test(image)) return "image/jpeg";
  if (/\.png$/i.test(image)) return "image/png";
  if (/\.webp$/i.test(image)) return "image/webp";
  throw new Error("image path needs a .jpg, .png or .webp extension");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ShenronExportPanel({ host }: { host: ShenronExportHost }) {
  const [settings, setSettings] = useState(loadSettings);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const rpc = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (!host.isTauri()) throw new Error("L’export Shenron nécessite l’application Aphrody.");
    const result = await host.invoke<T>("koharu_rpc", { method, params });
    if (result === null) throw new Error("Le service natif Koharu est indisponible.");
    return result;
  };

  const refresh = async () => {
    setError(null);
    try {
      setPages(await rpc<PageSummary[]>("project.pages", {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore unwritable storage
    }
  }, [settings]);

  const setBinding = (page: string, patch: Partial<Binding>) =>
    setBindings((current) => ({
      ...current,
      [page]: { ...(current[page] ?? { mangaPageId: "", sourceSha256: "", image: "" }), ...patch },
    }));

  const exportPage = async (page: PageSummary, binding: Binding) => {
    const result = await rpc<Record<string, unknown>>("page.result", { page: page.id });
    const { sha256 } = await rpc<{ sha256: string }>("page.sourceSha256", { page: page.id });
    const manifest: MangaCandidateBinding = {
      id: binding.mangaPageId.trim(),
      sourceSha256: binding.sourceSha256.trim().toLowerCase(),
      imageSha256: sha256,
      image: binding.image.trim(),
    };
    const source: KoharuMangaPageSource = {
      kind: "manga",
      pageId: manifest.id,
      sourceSha256: manifest.sourceSha256,
      imageSha256: manifest.imageSha256,
      mime: mimeFor(manifest.image),
      width: page.size.width,
      height: page.size.height,
    };
    // The shared mapper hashes the cleanup layer with Bun.CryptoHasher, which the
    // webview lacks; hash it here with WebCrypto and map the rest unchanged.
    const cleanup = result.cleanup_layer_png;
    const mapped = mapNativeKoharuPageResult({ result: { ...result, cleanup_layer_png: null }, sourceSha256: sha256 }, source);
    if (Array.isArray(cleanup)) {
      mapped.artifacts = { cleanupOverlaySha256: await sha256Hex(Uint8Array.from(cleanup as number[])) };
    }
    const candidate = toMangaReviewCandidateInput(mapped, manifest);
    const base = settings.apiUrl.trim().replace(/\/+$/, "");
    const response = await fetch(`${base}/api/manga/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}),
      },
      body: JSON.stringify(candidate),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    return `HTTP ${response.status}`;
  };

  const exportAll = async () => {
    if (!settings.apiUrl.trim()) {
      setError("SHENRON_API_URL manquant.");
      return;
    }
    setRunning(true);
    setError(null);
    for (const page of pages) {
      const binding = bindings[page.id];
      if (!binding?.mangaPageId.trim()) continue;
      setStatuses((s) => ({ ...s, [page.id]: { state: "busy" } }));
      try {
        const detail = await exportPage(page, binding);
        setStatuses((s) => ({ ...s, [page.id]: { state: "done", detail } }));
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        setStatuses((s) => ({ ...s, [page.id]: { state: "error", detail } }));
      }
    }
    setRunning(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5 text-[11px]">
      <label className="grid gap-1">
        <span>SHENRON_API_URL</span>
        <input className={fieldClass} type="url" value={settings.apiUrl}
          onChange={(e) => setSettings({ ...settings, apiUrl: e.currentTarget.value })} />
      </label>
      <label className="grid gap-1">
        <span>Jeton</span>
        <input className={fieldClass} type="password" value={settings.token}
          onChange={(e) => setSettings({ ...settings, token: e.currentTarget.value })} />
      </label>
      <div className="flex gap-1">
        <button type="button" className="h-7 flex-1 rounded border border-border" onClick={() => void refresh()} disabled={running}>
          Actualiser
        </button>
        <button type="button" className="h-7 flex-1 rounded bg-primary text-primary-foreground" onClick={() => void exportAll()} disabled={running || pages.length === 0}>
          Exporter
        </button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <ul className="grid gap-2">
        {pages.map((page) => {
          const binding = bindings[page.id];
          const status = statuses[page.id] ?? { state: "idle" };
          return (
            <li key={page.id} className="grid gap-1 rounded border border-border/80 p-2">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">{page.label}</span>
                <span data-state={status.state}>
                  {status.state === "idle" ? "—" : status.state === "busy" ? "…" : status.state === "done" ? `OK ${status.detail}` : "Erreur"}
                </span>
              </div>
              <input className={fieldClass} placeholder="ID page manga" value={binding?.mangaPageId ?? ""}
                onChange={(e) => setBinding(page.id, { mangaPageId: e.currentTarget.value })} />
              <input className={fieldClass} placeholder="sourceSha256 (manifeste)" value={binding?.sourceSha256 ?? ""}
                onChange={(e) => setBinding(page.id, { sourceSha256: e.currentTarget.value })} />
              <input className={fieldClass} placeholder="image (manifeste)" value={binding?.image ?? ""}
                onChange={(e) => setBinding(page.id, { image: e.currentTarget.value })} />
              {status.state === "error" && <p className="break-words text-destructive">{status.detail}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

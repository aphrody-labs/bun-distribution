// SPDX-License-Identifier: Apache-2.0
// Thread history backed by the `aphrody app-server` threads: list, search, date groups,
// share (transcript to the clipboard) and delete (`thread/archive`; the app-server has no
// hard delete, so archived threads leave the list but stay on disk).
import { Button, Icon, Input } from "@aphrody/m3-primitives";
import { useEffect, useMemo, useState } from "react";
import { filterThreads, groupByDate, normalizeThreads, type ThreadSummary, transcript } from "./history";
import { copyToNativeClipboard } from "./tauri-bridge";

export type Rpc = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Load every page of `thread/list` (bounded, so a huge store cannot hang the bar). */
export async function listAllThreads(rpc: Rpc, maxPages = 10, archived = false): Promise<ThreadSummary[]> {
  const all: ThreadSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { threads, nextCursor } = normalizeThreads(
      // oxlint-disable-next-line no-await-in-loop -- each page needs the previous cursor
      await rpc("thread/list", {
        ...(cursor ? { cursor } : {}),
        limit: 100,
        archived,
      }),
    );
    all.push(...threads);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- this fresh local array is owned here; ES2022 consumer targets lack toSorted
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function HistoryPanel({
  rpc,
  onOpen,
  onNewThread,
  onClose,
  activeId,
}: {
  rpc: Rpc;
  onOpen: (thread: ThreadSummary) => void;
  onNewThread: () => void;
  onClose: () => void;
  activeId?: string | null;
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);

  // Loading and error are reset by the handlers that change the list (see "Show archived history").
  useEffect(() => {
    void listAllThreads(rpc, 10, archived)
      .then(setThreads)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [rpc, archived]);

  const groups = useMemo(() => groupByDate(filterThreads(threads, query)), [threads, query]);

  const share = async (thread: ThreadSummary) => {
    try {
      const text = transcript(await rpc("thread/read", { threadId: thread.id, includeTurns: true }));
      setNotice((await copyToNativeClipboard(text)) ? "Transcript copied to the clipboard." : "Clipboard unavailable.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (thread: ThreadSummary) => {
    setConfirming(null);
    try {
      await rpc("thread/archive", { threadId: thread.id });
      setThreads(items => items.filter(item => item.id !== thread.id));
      setNotice("Thread archived. Its saved history is retained.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restore = async (thread: ThreadSummary) => {
    try {
      await rpc("thread/unarchive", { threadId: thread.id });
      setThreads(items => items.filter(item => item.id !== thread.id));
      setNotice("Thread restored to history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section aria-label="History" className="mt-2 flex max-h-96 flex-col gap-2 rounded-2xl bg-surface-container p-3">
      <div className="flex items-center gap-2">
        <Input
          variant="outlined"
          icon="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search threads"
          aria-label="Search threads"
          className="flex-1"
        />
        <Button variant="tonal" onClick={onNewThread}>
          <Icon name="add" size={18} />
          <span>New thread</span>
        </Button>
        <Button variant="text" onClick={onClose} aria-label="Close history">
          <Icon name="close" size={18} />
        </Button>
      </div>

      {error && (
        <p role="alert" className="m-0 text-body-medium text-error">
          {error}
        </p>
      )}
      {notice && (
        <p aria-live="polite" className="m-0 text-body-medium text-on-surface-variant">
          {notice}
        </p>
      )}
      <Button
        variant="tonal"
        aria-pressed={archived}
        onClick={() => {
          setArchived(!archived);
          setConfirming(null);
          setLoading(true);
          setError("");
        }}
      >
        {archived ? "Show active history" : "Show archived history"}
      </Button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="m-0 p-2 text-body-medium text-on-surface-variant">Loading threads...</p>
        ) : groups.length === 0 ? (
          <p className="m-0 p-2 text-body-medium text-on-surface-variant">
            {query ? "No thread matches: edit the search." : "No threads: send a message to start one."}
          </p>
        ) : (
          groups.map(group => (
            <div key={group.key} className="mb-2">
              <h3 className="m-0 px-2 py-1 text-label-large text-primary">{group.label}</h3>
              <ul className="m-0 list-none p-0">
                {group.threads.map(thread => (
                  <li
                    key={thread.id}
                    className={`group flex items-center gap-1 rounded-full pl-2 ${thread.id === activeId ? "bg-secondary-container text-on-secondary-container" : "hover:bg-on-surface/8"}`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(thread)}
                      disabled={archived}
                      className="min-h-12 flex-1 truncate text-left text-body-large focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {thread.title}
                    </button>
                    {archived ? (
                      <Button variant="tonal" onClick={() => void restore(thread)}>
                        Restore
                      </Button>
                    ) : confirming === thread.id ? (
                      <>
                        <Button aria-label="Cancel" title="Cancel" variant="text" onClick={() => setConfirming(null)}>
                          <Icon name="close" size={18} />
                        </Button>
                        <Button variant="tonal" onClick={() => void remove(thread)}>
                          Archive
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`Share ${thread.title}`}
                          onClick={() => void share(thread)}
                          className="inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/8 focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <Icon name="share" size={22} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Archive ${thread.title}`}
                          onClick={() => setConfirming(thread.id)}
                          className="inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/8 focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <Icon name="delete" size={22} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

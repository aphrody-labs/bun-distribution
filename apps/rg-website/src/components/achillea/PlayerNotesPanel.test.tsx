import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { PlayerNote } from "@rosegriffon/achillea-types/domain/player-note";
import { PlayerNoteCategory, PlayerNoteSeverity } from "@rosegriffon/achillea-types/enums/eventEnums";
import { PlayerNotesPanel } from "./PlayerNotesPanel";

afterEach(cleanup);

function note(content: string): PlayerNote {
  return {
    id: content,
    content,
    target: null,
    author: null,
    tournament: null,
    category: PlayerNoteCategory.OTHER,
    severity: PlayerNoteSeverity.INFO,
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    docsUrl: null,
    createdAt: "2026-10-16T00:00:00Z",
    updatedAt: "2026-10-16T00:00:00Z",
  };
}

function response(content: string) {
  return Response.json({
    data: [note(content)],
    total: 1,
    meta: { page: 1, pageSize: 100, pageCount: 1, isStaff: true },
  });
}

test("does not apply a late tournament A response after tournament B", async () => {
  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  const pending = [first, second];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      () => {
        const request = pending.shift();
        if (!request) throw new Error("Unexpected extra API request");
        return request.promise;
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const view = render(<PlayerNotesPanel tournamentId={1} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(<PlayerNotesPanel tournamentId={2} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(response("current B"));
    });
    await waitFor(() => expect(view.queryByText("current B")).not.toBeNull());
    await act(async () => {
      first.resolve(response("stale A"));
    });
    expect(view.queryByText("current B")).not.toBeNull();
    expect(view.queryByText("stale A")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
  }
});

test("settles an outstanding request safely after unmount", async () => {
  const pending = Promise.withResolvers<Response>();
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(() => pending.promise, { preconnect: globalThis.fetch.preconnect }),
  );
  const errors = spyOn(console, "error");
  try {
    const view = render(<PlayerNotesPanel tournamentId={3} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      pending.resolve(response("unmounted"));
    });
    expect(view.container.textContent).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
    errors.mockRestore();
  }
});

test("keeps the newest overlapping refresh for the same tournament", async () => {
  const older = Promise.withResolvers<Response>();
  const newer = Promise.withResolvers<Response>();
  const refreshes = [older, newer];
  let lists = 0;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        if (String(input).endsWith("/resolve")) return Promise.resolve(Response.json(note("seed")));
        if (++lists === 1) return Promise.resolve(response("seed"));
        const request = refreshes.shift();
        if (!request) throw new Error("Unexpected extra API request");
        return request.promise;
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const view = render(<PlayerNotesPanel tournamentId={4} />);
    await waitFor(() => expect(view.queryByText("seed")).not.toBeNull());
    const resolve = view.getByTitle("Marquer comme traité");
    act(() => {
      fireEvent.click(resolve);
      fireEvent.click(resolve);
    });
    await waitFor(() => expect(lists).toBe(3));
    await act(async () => {
      newer.resolve(response("newest"));
    });
    await waitFor(() => expect(view.queryByText("newest")).not.toBeNull());
    await act(async () => {
      older.resolve(response("outdated"));
    });
    expect(view.queryByText("newest")).not.toBeNull();
    expect(view.queryByText("outdated")).toBeNull();
  } finally {
    fetch.mockRestore();
  }
});

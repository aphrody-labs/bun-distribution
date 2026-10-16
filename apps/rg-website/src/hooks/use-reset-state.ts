"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/** Reset local editable state when its owning input changes, before committing stale UI. */
export function useResetState<T>(initialValue: T, owner: unknown): [T, Dispatch<SetStateAction<T>>] {
  const [snapshot, setSnapshot] = useState({ owner, value: initialValue, scope: {} });
  const current = Object.is(snapshot.owner, owner) ? snapshot : { owner, value: initialValue, scope: {} };
  if (current !== snapshot) setSnapshot(current);
  const scope = current.scope;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    action => {
      setSnapshot(previous => {
        if (previous.scope !== scope) return previous;
        return {
          ...previous,
          value: typeof action === "function" ? (action as (value: T) => T)(previous.value) : action,
        };
      });
    },
    [scope],
  );
  return [current.value, setValue];
}

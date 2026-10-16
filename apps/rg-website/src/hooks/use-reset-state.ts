"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/** Reset local editable state when its owning input changes, before committing stale UI. */
export function useResetState<T>(initialValue: T, owner: unknown): [T, Dispatch<SetStateAction<T>>] {
  const [snapshot, setSnapshot] = useState({ owner, value: initialValue });
  if (!Object.is(snapshot.owner, owner)) {
    setSnapshot({ owner, value: initialValue });
  }
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    action => {
      setSnapshot(previous => ({
        owner,
        value:
          typeof action === "function"
            ? (action as (value: T) => T)(Object.is(previous.owner, owner) ? previous.value : initialValue)
            : action,
      }));
    },
    [owner, initialValue],
  );
  return [Object.is(snapshot.owner, owner) ? snapshot.value : initialValue, setValue];
}

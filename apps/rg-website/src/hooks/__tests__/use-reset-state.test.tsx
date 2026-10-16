import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useResetState } from "../use-reset-state";

afterEach(cleanup);

test("invalidates old setters including an A-B-A owner transition", () => {
  const { result, rerender } = renderHook(({ owner }) => useResetState<string[]>([], owner), {
    initialProps: { owner: "A" },
  });
  const oldSetter = result.current[1];
  act(() => oldSetter(["old"]));
  rerender({ owner: "B" });
  act(() => result.current[1](["current"]));
  act(() => oldSetter(["stale"]));
  expect(result.current[0]).toEqual(["current"]);
  rerender({ owner: "A" });
  act(() => oldSetter(["stale A"]));
  expect(result.current[0]).toEqual([]);
});

test("keeps the setter stable for a fresh initial array on each render", () => {
  const { result, rerender } = renderHook(() => useResetState<number[]>([], "same owner"));
  const setter = result.current[1];
  rerender();
  expect(result.current[1]).toBe(setter);
  act(() => setter(previous => [...previous, 1]));
  expect(result.current[0]).toEqual([1]);
  expect(result.current[1]).toBe(setter);
});

// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { nativeMediaCacheRule } from "./shenron-cdn-media-cache";

test("only public media overrides the existing owned host cache rule", () => {
  const rule = nativeMediaCacheRule('(http.host in {"cdn.example" "origin-cdn.example"})');
  expect(rule.expression).toStartWith('(http.host in {"cdn.example" "origin-cdn.example"}) and ');
  expect(rule.expression).toContain('starts_with(http.request.uri.path, "/assets/")');
  expect(rule.expression).toContain('ends_with(http.request.uri.path, ".mp4")');
  expect(rule.expression).not.toContain('".webp"');
  expect(rule.expression).not.toContain('"/api/"');
  expect(rule.expression).not.toContain('"/media/"');
  expect(rule.action_parameters).toEqual({ cache: false });
  expect(rule.enabled).toBe(true);
  expect(() => nativeMediaCacheRule("true")).toThrow("canonical host expression");
});

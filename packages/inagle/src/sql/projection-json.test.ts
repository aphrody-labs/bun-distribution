import { expect, test } from "bun:test";
import { decodeProjectionJson } from "./projection-json.js";

test("valid JSON escapes and Unicode remain unchanged", () => {
  const json = String.raw`{"path":"a\\b","newline":"a\nb","quote":"a\"b","unicode":"\u00E9","slash":"a\/b"}`;
  expect(decodeProjectionJson(json)).toEqual(JSON.parse(json));
});

test("legacy unsupported escapes preserve the literal backslash and nested metadata", () => {
  const json = String.raw`{"nested":{"path":"a\_b\q","value":12},"valid":"a\nb"}`;
  expect(decodeProjectionJson(json)).toEqual({
    nested: { path: String.raw`a\_b\q`, value: 12 },
    valid: "a\nb",
  });
});

test("structurally malformed JSON fails without creating empty metadata", () => {
  for (const json of ["{", '{"missing":}', String.raw`{"path":"a\q"} trailing`, String.raw`{"path":"a\q`])
    expect(() => decodeProjectionJson(json)).toThrow("Invalid imported JSON projection metadata");
});

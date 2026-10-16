// SPDX-License-Identifier: Apache-2.0
import { describe, expect, spyOn, test } from "bun:test";
import {
  EventEncoder,
  _resetWarnedCountKeys,
  decodeProto,
  tokenUsageFromLangChainMetadata,
  type BaseEvent,
} from "../src/index";
import fixtures from "../fixtures/null-omission.json";

// Replay the existing cross-language wire fixtures through the public adapter.
// This checks the registry codecs and the retained client together.
describe("AG-UI registry wire compatibility", () => {
  for (const fixture of fixtures.stream) {
    const event = fixture.input as unknown as BaseEvent;

    test(`${fixture.name}: SSE`, () => {
      const original = structuredClone(event);
      const result = JSON.parse(new EventEncoder().encodeSSE(event).slice(6));
      expect(result).toEqual(fixture.expected);
      expect(event).toEqual(original);
    });

    test(`${fixture.name}: Protobuf`, () => {
      const original = structuredClone(event);
      const frame = new EventEncoder().encodeProtobuf(event);
      expect(new DataView(frame.buffer, frame.byteOffset).getUint32(0)).toBe(
        frame.length - 4,
      );
      // The previous codec also materializes an absent repeated resume field
      // as []; Protobuf cannot distinguish that value from an absent list.
      const expected = structuredClone(
        fixture.expected,
      ) as unknown as BaseEvent & Record<string, unknown>;
      const input = expected.input as Record<string, unknown> | undefined;
      if (input && input.resume === undefined) input.resume = [];
      expect(decodeProto(frame.slice(4))).toEqual(expected);
      expect(event).toEqual(original);
    });
  }
});

test("the retained warning-reset API clears registry warning deduplication", () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const usage = { input_tokens: "invalid", output_tokens: 1 };
  try {
    _resetWarnedCountKeys();
    tokenUsageFromLangChainMetadata(usage, {});
    tokenUsageFromLangChainMetadata(usage, {});
    expect(warning).toHaveBeenCalledTimes(1);
    _resetWarnedCountKeys();
    tokenUsageFromLangChainMetadata(usage, {});
    expect(warning).toHaveBeenCalledTimes(2);
  } finally {
    warning.mockRestore();
    _resetWarnedCountKeys();
  }
});

// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  BunDecisionBridge,
  decideJson,
  type NativeDecisionOptions,
} from "../src/aphrody/decision/bridge";

const options: NativeDecisionOptions = {
  runtime: { directory: "C:/synthetic-sdk", manifestSha256: "a".repeat(64) },
  bun: { executable: "C:/synthetic-bun.exe", sha256: "b".repeat(64), revision: "c".repeat(40) },
};

test("explicit SDK injection preserves pins, raw usage and the borrowed host", async () => {
  const calls: unknown[][] = [];
  const python = {
    async call(...arguments_: [string, string, string?]) {
      calls.push(arguments_);
      return '{"usage":null,"action_id":null,"executed":false}';
    },
    async close() {
      throw Error("borrowed host must remain alive");
    },
  };
  await using bridge = new BunDecisionBridge(python, options);
  expect(await bridge.decideJson('{"synthetic":"😀"}')).toBe(
    '{"usage":null,"action_id":null,"executed":false}',
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].slice(0, 2)).toEqual(["aphrody.decision.native_bridge", "decide_bun_json"]);
  expect(JSON.parse(calls[0][2] as string)).toEqual({
    ...options,
    protocol: "aphrody.yolo.bun-bridge/1",
    argument: '{"synthetic":"😀"}',
  });
});

test("close joins the active SDK call and refuses more work", async () => {
  let finish!: (value: string) => void;
  const work = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const bridge = new BunDecisionBridge({ call: () => work }, options);
  const pending = bridge.decideJson("{}");
  await expect(bridge.decideJson("{}")).rejects.toMatchObject({ code: "ERR_DECISION_BUSY" });
  let closed = false;
  const closing = bridge.close().finally(() => {
    closed = true;
  });
  expect(closed).toBe(false);
  await expect(bridge.decideJson("{}")).rejects.toMatchObject({ code: "ERR_DECISION_CLOSED" });
  finish('{"usage":null}');
  expect(await pending).toBe('{"usage":null}');
  await closing;
  expect(closed).toBe(true);
  await bridge.close();
});

test("host failures propagate and release the busy state", async () => {
  const failure = Error("synthetic host failure");
  let calls = 0;
  await using bridge = new BunDecisionBridge(
    {
      async call() {
        if (!calls++) throw failure;
        return "{}";
      },
    },
    options,
  );
  await expect(bridge.decideJson("{}")).rejects.toBe(failure);
  expect(await bridge.decideJson("{}")).toBe("{}");
});

test("configuration is captured before the caller mutates its pins", async () => {
  const mutable = structuredClone(options);
  let revision: string | undefined;
  await using bridge = new BunDecisionBridge(
    {
      async call(_module, _function, argument) {
        revision = JSON.parse(argument!).bun.revision;
        return "{}";
      },
    },
    mutable,
  );
  Object.assign(mutable.bun, { revision: "d".repeat(40) });
  await bridge.decideJson("{}");
  expect(revision).toBe(options.bun.revision);
});

test("UTF-8 input and output limits fail explicitly", async () => {
  let calls = 0;
  await using bridge = new BunDecisionBridge(
    {
      async call() {
        calls++;
        return "😀".repeat(300_000);
      },
    },
    options,
  );
  await expect(bridge.decideJson("😀".repeat(300_000))).rejects.toMatchObject({
    code: "ERR_DECISION_INPUT_LIMIT",
  });
  expect(calls).toBe(0);
  await expect(bridge.decideJson("{}")).rejects.toMatchObject({
    code: "ERR_DECISION_OUTPUT_LIMIT",
  });
  expect(calls).toBe(1);
});

test("the explicit private HTTP bridge remains available", async () => {
  const calls: unknown[][] = [];
  const python = {
    async call(...arguments_: [string, string, string?]) {
      calls.push(arguments_);
      return "{}";
    },
  };
  expect(await decideJson(python as Parameters<typeof decideJson>[0], "{}")).toBe("{}");
  expect(calls).toEqual([["aphrody.decision.workflow", "decide_json", "{}"]]);
});

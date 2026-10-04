// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { koharu, koharuRpc, nativeAi, shenron, training, type TrainEvent } from "./studio-bridge";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
interface Call {
  command: string;
  args: Record<string, unknown>;
}
function native(reply: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const callbacks = new Map<number, (event: unknown) => void>();
  const removed: unknown[][] = [];
  let nextId = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          const call = { command, args };
          calls.push(call);
          return reply(call);
        },
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++nextId;
          callbacks.set(id, callback);
          return id;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (event: string, id: number) => {
          removed.push([event, id]);
        },
      },
    },
  });
  return { calls, callbacks, removed };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Studio bridge follows actual native IPC contracts", () => {
  test("project.close accepts native JSON null and sends object params", async () => {
    const transport = native(({ args }) => {
      expect(args).toEqual({ method: "project.close", params: {} });
      return null;
    });
    expect(await koharu.closeProject()).toBeNull();
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.command).toBe("koharu_rpc");
  });
  test("no-argument reads use empty params and preserve real values", async () => {
    const projects = [{ name: "native-project" }];
    const transport = native(({ args }) => {
      expect(args.params).toEqual({});
      return args.method === "project.list" ? projects : { running: 42 };
    });
    expect(await koharu.listProjects()).toBe(projects);
    expect(await koharu.pipelineStatus()).toEqual({ running: 42 });
    expect(transport.calls.map((call) => call.args.method)).toEqual([
      "project.list",
      "pipeline.status",
    ]);
  });
  test("pipeline.cancel supplies the active job identifier and preserves its native acknowledgement", async () => {
    const transport = native(() => ({ cancelled: true }));
    expect(await koharu.cancelPipeline(73)).toEqual({ cancelled: true });
    expect(transport.calls).toEqual([
      {
        command: "koharu_rpc",
        args: { method: "pipeline.cancel", params: { job: 73 } },
      },
    ]);
  });
  test("native service failures propagate without synthetic null/success results", async () => {
    const failure = new Error("cancel the active pipeline job before closing the project");
    native(() => {
      throw failure;
    });
    await expect(koharu.closeProject()).rejects.toBe(failure);
    await expect(koharuRpc("pipeline.run", { operation: { operation: "full" } })).rejects.toBe(
      failure,
    );
    await expect(nativeAi.openAdmin()).rejects.toBe(failure);
    await expect(shenron.training()).rejects.toBe(failure);
  });
  test("unit admin and training acknowledgements resolve only after native IPC succeeds", async () => {
    const admin = deferred<null>();
    const started = deferred<null>();
    const transport = native(({ command }) =>
      command === "studio_open_shenron_admin" ? admin.promise : started.promise,
    );
    let adminResolved = false;
    const opened = nativeAi.openAdmin().then((result) => {
      adminResolved = true;
      return result;
    });
    await Promise.resolve();
    expect(adminResolved).toBe(false);
    admin.resolve(null);
    expect(await opened).toBeNull();
    expect(
      await (async () => {
        const promise = training.start("embed", 10, false);
        started.resolve(null);
        return promise;
      })(),
    ).toBeNull();
    expect(transport.calls[1]).toEqual({
      command: "studio_shenron_train_start",
      args: { kind: "embed", steps: 10, allowCpu: false, baseModel: null },
    });
  });
  test("training events use real event IPC with no fabricated completion and real cleanup", async () => {
    const events: TrainEvent[] = [];
    const transport = native(({ command }) => (command === "plugin:event|listen" ? 29 : null));
    const stop = await training.onEvent((event) => {
      events.push(event);
    });
    expect(transport.calls[0]).toEqual({
      command: "plugin:event|listen",
      args: { event: "studio://train", target: { kind: "Any" }, handler: 1 },
    });
    expect(events).toEqual([]);
    const started: TrainEvent = {
      state: "started",
      kind: "embed",
      steps: 10,
      baseModel: "native-model",
    };
    transport.callbacks.get(1)!({ event: "studio://train", id: 29, payload: started });
    expect(events).toEqual([started]);
    const finished: TrainEvent = { state: "finished", kind: "embed", output: "/fixture/candidate" };
    transport.callbacks.get(1)!({ event: "studio://train", id: 29, payload: finished });
    expect(events).toEqual([started, finished]);
    await stop();
    expect(transport.removed).toEqual([["studio://train", 29]]);
    expect(transport.calls.at(-1)).toEqual({
      command: "plugin:event|unlisten",
      args: { event: "studio://train", eventId: 29 },
    });
  });
  test("failed native event subscriptions reject rather than providing a fake unsubscribe", async () => {
    const failure = new Error("event permission denied");
    native(() => {
      throw failure;
    });
    await expect(training.onEvent(() => {})).rejects.toBe(failure);
  });
  test("browser callers cannot report native success or silently subscribe", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    await expect(koharu.closeProject()).rejects.toThrow("Koharu nécessite");
    await expect(nativeAi.openAdmin()).rejects.toThrow("Cette vue nécessite");
    await expect(training.start("embed", 10, false)).rejects.toThrow("Cette vue nécessite");
    await expect(training.onEvent(() => {})).rejects.toThrow(
      "événements d’entraînement nécessitent",
    );
  });
});

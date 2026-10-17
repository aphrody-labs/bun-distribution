// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { clearKitCatalogsForTesting, type KitCatalog, type KitEvent } from "./kit-bridge";
import { KitSurface } from "./routes/kit/KitSurface";

let root: Root | undefined;
const host = document.createElement("div");
document.body.append(host);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalInternals = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");

afterEach(async () => {
  clearKitCatalogsForTesting();
  await act(async () => root?.unmount());
  root = undefined;
  host.replaceChildren();
  if (originalInternals) Object.defineProperty(window, "__TAURI_INTERNALS__", originalInternals);
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

const catalog: KitCatalog = {
  protocol: "aphrody.kit/1",
  kit: "omar",
  title: "Kit administrateur",
  version: "0.1.0",
  platform: "win32",
  groups: [{ id: "pc", title: "Mon PC", icon: "computer" }],
  actions: [{ id: "pc.3", group: "pc", title: "Libérer de la mémoire" }],
  admin: true,
};

const flush = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));

test("a kit run asks its typed OUI in an M3 dialog and shows the log", async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let send: ((event: KitEvent) => void) | undefined;
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      transformCallback: () => 1,
      invoke: async (command: string, args: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "aphrody_kit_start") {
          const channel = args.channel as {
            onmessage: (event: KitEvent) => void;
          };
          const kitArgs = args.args as string[];
          if (kitArgs[0] === "catalog") queueMicrotask(() => channel.onmessage({ type: "catalog", catalog }));
          else {
            send = channel.onmessage;
            queueMicrotask(() =>
              send!({
                type: "ask",
                id: 1,
                kind: "typed",
                question: "Tape OUI (en majuscules) pour continuer",
                expect: "OUI",
              }),
            );
          }
          return calls.length;
        }
        if (command === "aphrody_kit_answer") {
          queueMicrotask(() => {
            send!({ type: "say", text: "Terminé." });
            send!({ type: "done", code: 0 });
          });
        }
        return null;
      },
    },
  });
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(
        MemoryRouter,
        null,
        createElement(KitSurface, {
          kit: "omar",
          title: "Administration",
          intro: "x",
        }),
      ),
    ),
  );
  await flush();
  expect(host.textContent).toContain("Libérer de la mémoire");
  const launch = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Lancer"))!;
  await act(async () => launch.click());
  await flush();
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Tape OUI");
  const confirm = [...dialog.querySelectorAll("button")].find(button => button.type === "submit")!;
  expect(confirm.disabled).toBe(true);
  const field = dialog.querySelector("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, "OUI");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  await flush();
  expect(calls.find(call => call.command === "aphrody_kit_answer")?.args).toMatchObject({
    answer: "OUI",
  });
  expect(
    calls.find(call => call.command === "aphrody_kit_start" && (call.args.args as string[])[0] === "run")?.args,
  ).toMatchObject({
    kit: "omar",
    args: ["run", "pc.3", "{}"],
  });
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.textContent).toContain("Terminé.");
});

import { test, expect } from "bun:test";
import { runInNewContext } from "node:vm";

const bundle = await Bun.file(new URL("../dist/main.js", import.meta.url)).text();

test("browser bundle boots without native Tauri bridge", () => {
  const status = { textContent: "" };
  runInNewContext(bundle, {
    document: { querySelector: () => status },
    window: {},
  });
  expect(status.textContent).toBe("Interface Bun chargée.");
});

test("Tauri bridge forwards app metadata commands", async () => {
  const status = { textContent: "" };
  const commands: string[] = [];
  const completed = runInNewContext(bundle, {
    isTauri: true,
    document: { querySelector: () => status },
    window: {
      __TAURI_INTERNALS__: {
        async invoke(command: string) {
          commands.push(command);
          return command === "plugin:app|name" ? "Aphrody" : "0.1.0";
        },
      },
    },
  });
  await completed;
  expect(commands).toEqual(["plugin:app|name", "plugin:app|version"]);
  expect(status.textContent).toContain("Aphrody 0.1.0");
});

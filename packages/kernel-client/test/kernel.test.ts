// SPDX-License-Identifier: Apache-2.0
// End-to-end against a real `aphrody kernel serve` on a private endpoint.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { KernelClient, registerSubsystem } from "../src/index.ts";

const exe = process.platform === "win32" ? "aphrody.exe" : "aphrody";
// The kernel ships as `aphrody kernel`; cargo builds into CARGO_TARGET_DIR (else the workspace target/), APHRODY_BIN points at an installed build.
const targetDir =
  process.env.CARGO_TARGET_DIR || join(import.meta.dir, "../../../target");
const binary = process.env.APHRODY_BIN ?? join(targetDir, "debug", exe);
const endpoint =
  process.platform === "win32"
    ? `\\\\.\\pipe\\aphrody-os-bun-test-${process.pid}`
    : `/tmp/aphrody-os-bun-test-${process.pid}.sock`;
let server: ReturnType<typeof Bun.spawn> | undefined;

beforeAll(async () => {
  if (!existsSync(binary))
    throw new Error(
      `Set APHRODY_BIN to a qualified kernel binary or build through the root Cargo owner: ${binary}`,
    );
  server = Bun.spawn(
    [binary, "kernel", "--socket", endpoint, "serve", "--no-browser"],
    {
      windowsHide: true,
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  for (let i = 0; i < 200; i++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sondage de démarrage : chaque tentative doit attendre l'échec précédent et le délai
      (await KernelClient.connect(endpoint)).close();
      return;
    } catch {
      // oxlint-disable-next-line no-await-in-loop -- délai entre deux tentatives de connexion séquentielles
      await Bun.sleep(50);
    }
  }
  throw new Error("kernel did not start");
}, 60_000);

afterAll(() => server?.kill());

test("a Bun subsystem is served to other clients and leaves on close", async () => {
  const bun = await registerSubsystem(
    {
      name: "bun_text",
      tools: [
        {
          name: "bun_reverse",
          description: "Reverse a string.",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          handler: ({ text }) => ({
            reversed: String(text).split("").toReversed().join(""),
            runtime: `bun ${Bun.version}`,
          }),
        },
      ],
    },
    endpoint,
  );
  const agent = await KernelClient.connect(endpoint, "agent");
  const tools = (await agent.request("tools/list")) as {
    tools: { name: string }[];
  };
  expect(tools.tools.map((t) => t.name)).toContain("bun_reverse");
  const out = (await agent.call("bun_reverse", { text: "aphrody" })) as {
    reversed: string;
  };
  expect(out.reversed).toBe("ydorhpa");

  // The Bun process can drive native subsystems too: Nushell through the kernel.
  const nu = (await bun.call("nu_eval", { code: "[1 2 3] | math sum" })) as {
    value: number;
  };
  expect(nu.value).toBe(6);

  bun.close();
  await bun.closed;
  for (let i = 0; i < 100; i++) {
    // oxlint-disable-next-line no-await-in-loop -- sondage séquentiel : on attend la désinscription côté kernel avant de relire
    const after = (await agent.request("tools/list")) as {
      tools: { name: string }[];
    };
    if (!after.tools.some((t) => t.name === "bun_reverse")) break;
    // oxlint-disable-next-line no-await-in-loop -- délai entre deux relectures du sondage
    await Bun.sleep(20);
  }
  const after = (await agent.request("tools/list")) as {
    tools: { name: string }[];
  };
  expect(after.tools.map((t) => t.name)).not.toContain("bun_reverse");
  agent.close();
}, 60_000);

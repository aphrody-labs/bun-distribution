// SPDX-License-Identifier: MIT OR Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startNativeClient, type NativeClient } from "../src/native.ts";

const binary = process.env.APHRODY_KOHARU_SDK_BIN ?? Bun.which("koharu-sdk");
const native = test.skipIf(binary == null);
const roots: string[] = [];
const clients: NativeClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "koharu-native-qualification-"));
  roots.push(root);
  const client = startNativeClient({ binary: binary!, root });
  clients.push(client);
  return { root, client };
}

native(
  "installed native SDK handles invalid requests and recovers without loading model state",
  async () => {
    const { root, client } = await fixture();
    expect(await client.call("project.list", {})).toEqual([]);
    await expect(client.call("project.open", { name: "fixture-missing" })).rejects.toThrow();
    expect(await client.call("project.list", {})).toEqual([]);
    expect(await client.call("pipeline.status", {})).toEqual({ running: null });
    expect(await readdir(root)).toEqual([]);
    await client.close();
    await expect(client.call("project.list", {})).rejects.toThrow(/closed/);
    await client.close();
  },
  10_000,
);

native(
  "installed native SDK keeps project roots isolated and refuses path traversal",
  async () => {
    const left = await fixture();
    const right = await fixture();
    await expect(
      left.client.call("project.create", { name: "../outside-fixture" }),
    ).rejects.toThrow();
    expect(await left.client.call("project.list", {})).toEqual([]);
    expect(await right.client.call("project.list", {})).toEqual([]);
    const created = await left.client.call("project.create", { name: "owned-fixture" });
    expect(created.name).toBe("owned-fixture");
    const projects = await left.client.call("project.list", {});
    expect(projects.map((project) => project.name)).toEqual(["owned-fixture"]);
    expect(await right.client.call("project.list", {})).toEqual([]);
    await left.client.call("project.close", {});
    expect(await left.client.call("pipeline.status", {})).toEqual({ running: null });
    expect(await readdir(left.root)).toEqual(["owned-fixture.khrproj"]);
    expect(await readdir(right.root)).toEqual([]);
  },
  10_000,
);

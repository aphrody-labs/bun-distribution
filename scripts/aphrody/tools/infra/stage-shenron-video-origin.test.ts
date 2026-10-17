// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageShenronVideo } from "./stage-shenron-video-origin";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test("publishes qualified files once and rejects a changed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "shenron-video-stage-"));
  roots.push(root);
  const privateRoot = join(root, "private");
  const publicRoot = join(root, "public");
  await mkdir(privateRoot);
  await mkdir(publicRoot);
  await Bun.write(
    join(privateRoot, "poster.webp"),
    new Uint8Array([...new TextEncoder().encode("RIFF0000WEBP"), 1, 2]),
  );
  await Bun.write(
    join(privateRoot, "optimized-720p.mp4"),
    new Uint8Array([0, 0, 0, 14, ...new TextEncoder().encode("ftyp"), 0, 0, 0, 0, 1, 2]),
  );
  await Bun.write(join(publicRoot, ".keep"), "");
  const qualified = await Promise.all(
    (["poster.webp", "optimized-720p.mp4"] as const).map(async name => {
      const source = join(privateRoot, name);
      return {
        name,
        source,
        sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(source).bytes()).digest("hex"),
      };
    }),
  );
  const first = await stageShenronVideo(qualified as Parameters<typeof stageShenronVideo>[0], privateRoot, publicRoot);
  expect(first.map(entry => entry.changed)).toEqual([true, true]);
  const second = await stageShenronVideo(qualified as Parameters<typeof stageShenronVideo>[0], privateRoot, publicRoot);
  expect(second.map(entry => entry.changed)).toEqual([false, false]);
  const outside = join(root, "outside.webp");
  await Bun.write(outside, await Bun.file(qualified[0]!.source).bytes());
  expect(
    stageShenronVideo([{ ...qualified[0]!, source: outside }, qualified[1]!], privateRoot, publicRoot),
  ).rejects.toThrow("outside private handoff");
  await Bun.write(join(privateRoot, "optimized-720p.mp4"), "tampered");
  expect(
    stageShenronVideo(qualified as Parameters<typeof stageShenronVideo>[0], privateRoot, publicRoot),
  ).rejects.toThrow();
  expect((await Bun.file(first[1]!.path).bytes()).length).toBe(14);
});

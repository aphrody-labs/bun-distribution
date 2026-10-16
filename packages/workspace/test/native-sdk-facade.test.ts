// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageNativeConsumer } from "../src/bun-native.ts";

test("isolated Paths package runs its source owner with source and output provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-native-paths-facade-"));
  try {
    const source = join(import.meta.dir, "../../paths");
    const destination = await stageNativeConsumer(source, root);
    const entry = join(destination, "src/index.ts");
    const child = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      const { statePath, portablePath } = await import(${JSON.stringify(entry)});
      if (statePath("lib") !== ${JSON.stringify(join(root, "state", "lib"))})
        throw new Error("wrong isolated state root");
      if (portablePath("C:\\\\fixture\\\\models") !== "C:/fixture/models")
        throw new Error("wrong canonical portable path behavior");
    `,
      ],
      {
        windowsHide: true,
        cwd: root,
        env: { ...process.env, APHRODY_HOME: join(root, "state") },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(child.exitCode).toBe(0);
    expect(child.stderr.toString()).toBe("");
    expect(existsSync(join(root, "node_modules/@aphrody/workspace"))).toBe(
      false,
    );
    const provenance = JSON.parse(
      await readFile(join(destination, "source-provenance.json"), "utf8"),
    );
    expect(provenance.inputs).toEqual(
      await Promise.all(
        ["src/index.ts"].map(async (path) => ({
          path,
          sha256: createHash("sha256")
            .update(await readFile(join(source, path)))
            .digest("hex"),
        })),
      ),
    );
    expect(provenance.output.sha256).toBe(
      createHash("sha256")
        .update(await readFile(entry))
        .digest("hex"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK staging refuses a Paths package with an obsolete checkout import", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-native-paths-missing-"));
  try {
    const source = join(root, "paths");
    await mkdir(join(source, "src"), { recursive: true });
    await cp(
      join(import.meta.dir, "../../paths/package.json"),
      join(source, "package.json"),
    );
    await writeFile(
      join(source, "src/index.ts"),
      'export * from "../../workspace/src/paths.ts";\n',
    );
    await expect(
      stageNativeConsumer(source, join(root, "isolated")),
    ).rejects.toThrow();
    expect(
      existsSync(
        join(
          root,
          "isolated/node_modules/@aphrody/paths/source-provenance.json",
        ),
      ),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

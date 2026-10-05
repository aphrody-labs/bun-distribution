// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { n2bPlugin } from "./src/index.ts";

test.skipIf(process.platform === "win32")(
  "CLI availability and scan both honor N2B_BIN without PATH",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "n2b-plugin-"));
    const savedPath = process.env.PATH;
    const savedBin = process.env.N2B_BIN;
    try {
      await mkdir(join(root, "src"));
      const entry = join(root, "src/index.ts");
      await writeFile(entry, "export const value = 1;");
      const marker = join(root, "scanned");
      const binary = join(root, "n2b-fixture");
      await writeFile(
        binary,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'n2b 1.2.3\\n'
else
  : > '${marker}'
  printf '{"files":[]}\\n'
fi
`,
      );
      await chmod(binary, 0o755);
      process.env.PATH = "";
      process.env.N2B_BIN = binary;
      const result = await Bun.build({
        entrypoints: [entry],
        plugins: [n2bPlugin({ root, native: "off", quiet: true })],
      });
      expect(result.success).toBe(true);
      expect(await Bun.file(marker).exists()).toBe(true);
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
      if (savedBin === undefined) delete process.env.N2B_BIN;
      else process.env.N2B_BIN = savedBin;
      await rm(root, { recursive: true, force: true });
    }
  },
);

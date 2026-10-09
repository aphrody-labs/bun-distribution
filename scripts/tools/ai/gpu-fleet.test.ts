// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { openPlanner } from "./gpu-fleet.ts";

test("a missing Python application owner is rejected before interpreter initialization", async () => {
  await expect(openPlanner(join(import.meta.dir, "missing-owner"))).rejects.toThrow(
    "source missing",
  );
});

test.skipIf(!process.env.BUN_PYTHON_HOST_LIBRARY)(
  "real embedded Python uses this Bun process and preserves queued operations",
  async () => {
    // CPython is process-global: qualification uses the dedicated owner process,
    // not bun:test's process (which owns other tests and their thread lifecycle).
    const code = `import {openPlanner} from ${JSON.stringify(join(import.meta.dir, "gpu-fleet.ts"))};
      await using py = await openPlanner(${JSON.stringify(join(import.meta.dir, "../../../py/packages/aphrody/src"))});
      const pid=Number(await py.eval('os.getpid()'));
      const values=await Promise.all([py.eval('40+2'),py.eval('40+3')]);
      console.log(JSON.stringify({sameProcess:pid===process.pid,values}));`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [out, errors, result] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ result, errors }).toEqual({ result: 0, errors: "" });
      expect(JSON.parse(out)).toEqual({ sameProcess: true, values: ["42", "43"] });
    } finally {
      clearTimeout(deadline);
      child.kill();
    }
  },
  25_000,
);

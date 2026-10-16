/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "bun:test";
import { isInfraPythonScript, targetPath } from "../src/consolidation.ts";

describe("Infra Python consolidation destinations", () => {
  test("maps operational Python scripts into the shared Python tools tree", () => {
    const info = { kind: "script", category: "tools" };

    expect(isInfraPythonScript("scripts/ops/ovh.py", info)).toBe(true);
    expect(targetPath("infra", "scripts/ops/ovh.py", info)).toBe(
      "../aphrody-py/tools/infra/scripts/python-workspace-dispatch.py",
    );
  });

  test("keeps Infra shell control scripts in their owner for now", () => {
    expect(
      isInfraPythonScript("scripts/release/atomic-deploy-aphrody-stack.sh", {
        kind: "script",
      }),
    ).toBe(false);
  });
});

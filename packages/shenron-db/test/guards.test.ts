// Source: packages/shenron/db/test/guards.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  DATABOOKS_FREEZE_EXIT_CODE,
  DatabooksFrozenError,
  createDatabooksFreezeGate,
  freezeReason,
  type FreezeFs,
} from "../src/guards";

const PATH = "/coord/FREEZE-databooks.json";

function memoryFs(files: Record<string, string | Error>): FreezeFs {
  return {
    exists: path => path in files,
    read: path => {
      const value = files[path];
      if (value === undefined) throw new Error("ENOENT");
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

/** Reason extraction of apps/shenron/site/src/lib/databooks-freeze.ts, verbatim. */
function siteReason(raw: string): string {
  let reason = "gel actif (raison non précisée)";
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const candidate = value.reason ?? value.raison ?? value.motif ?? value.message;
    reason = typeof candidate === "string" && candidate.trim() ? candidate.trim() : raw.trim() || reason;
  } catch {
    reason = raw.trim() || reason;
  }
  return reason;
}

const FIXTURES = [
  '{"reason":"  import canon en cours "}',
  '{"raison":"relecture"}',
  '{"motif":"migration"}',
  '{"message":"gel"}',
  '{"reason":"  ","raison":"second"}',
  '{"reason":"   "}',
  '{"frozen":true}',
  "texte libre\n",
  "",
  "   ",
  "null",
  "42",
  "[1,2]",
  '{"reason":5}',
];

describe("databooks freeze gate", () => {
  test("exit code", () => {
    expect(DATABOOKS_FREEZE_EXIT_CODE).toBe(3);
  });

  test("null path in production is frozen (S11)", () => {
    const gate = createDatabooksFreezeGate({
      freezeFile: null,
      production: true,
      fs: memoryFs({}),
    });
    expect(gate.state()).toEqual({
      frozen: true,
      reason: "DATABOOKS_FREEZE_FILE non configuré",
      path: null,
    });
    expect(() => gate.assertWritable()).toThrow(DatabooksFrozenError);
  });

  test("null path outside production is free", () => {
    const gate = createDatabooksFreezeGate({
      freezeFile: null,
      production: false,
      fs: memoryFs({}),
    });
    expect(gate.state()).toEqual({ frozen: false });
    expect(() => gate.assertWritable()).not.toThrow();
  });

  for (const production of [true, false]) {
    test(`absent file is free (production=${production})`, () => {
      const gate = createDatabooksFreezeGate({ freezeFile: PATH, production, fs: memoryFs({}) });
      expect(gate.state()).toEqual({ frozen: false });
    });

    test(`{"frozen": false} is free (production=${production})`, () => {
      const gate = createDatabooksFreezeGate({
        freezeFile: PATH,
        production,
        fs: memoryFs({ [PATH]: '{"frozen": false, "reason": "levé"}' }),
      });
      expect(gate.state()).toEqual({ frozen: false });
    });

    test(`unreadable file is frozen (production=${production})`, () => {
      const gate = createDatabooksFreezeGate({
        freezeFile: PATH,
        production,
        fs: memoryFs({ [PATH]: new Error("EACCES") }),
      });
      expect(gate.state()).toEqual({
        frozen: true,
        reason: "gel actif (raison non précisée)",
        path: PATH,
      });
    });
  }

  test("exists() failure fails closed", () => {
    const gate = createDatabooksFreezeGate({
      freezeFile: PATH,
      production: false,
      fs: {
        exists: () => {
          throw new Error("EIO");
        },
        read: () => "",
      },
    });
    expect(gate.state().frozen).toBe(true);
  });

  test("any other content is frozen with the site's reason extraction", () => {
    for (const raw of FIXTURES) {
      const gate = createDatabooksFreezeGate({
        freezeFile: PATH,
        production: false,
        fs: memoryFs({ [PATH]: raw }),
      });
      expect(gate.state()).toEqual({ frozen: true, reason: siteReason(raw), path: PATH });
      expect(freezeReason(raw)).toBe(siteReason(raw));
    }
  });

  test("frozen values other than false keep the freeze", () => {
    for (const raw of ['{"frozen":"false"}', '{"frozen":0}', '[{"frozen":false}]']) {
      const gate = createDatabooksFreezeGate({
        freezeFile: PATH,
        production: false,
        fs: memoryFs({ [PATH]: raw }),
      });
      expect(gate.state().frozen).toBe(true);
    }
  });

  test("DatabooksFrozenError carries the code and the state", () => {
    const gate = createDatabooksFreezeGate({
      freezeFile: PATH,
      production: true,
      fs: memoryFs({ [PATH]: '{"reason":"import"}' }),
    });
    try {
      gate.assertWritable();
      throw new Error("expected a freeze");
    } catch (error) {
      expect(error).toBeInstanceOf(DatabooksFrozenError);
      const frozen = error as DatabooksFrozenError;
      expect(frozen.code).toBe("DATABOOKS_FROZEN");
      expect(frozen.freeze).toEqual({ frozen: true, reason: "import", path: PATH });
      expect(frozen.message).toBe("Écritures databooks gelées : import");
    }
  });

  test("default fs reads the real file system", () => {
    const gate = createDatabooksFreezeGate({
      freezeFile: `${import.meta.dir}/does-not-exist-freeze.json`,
      production: true,
    });
    expect(gate.state()).toEqual({ frozen: false });
  });
});

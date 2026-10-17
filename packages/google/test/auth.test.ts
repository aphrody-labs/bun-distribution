import { expect, test } from "bun:test";
import { resolveGoogleBinary, resolveGoogleCommand } from "../src/auth.ts";

test("Google facade reports a native binary when one is configured or installed", () => {
  const previous = Bun.env.APHRODY_GOOGLE_BIN;
  try {
    Bun.env.APHRODY_GOOGLE_BIN = "C:/native/aphrody-google.exe";
    expect(resolveGoogleBinary()).toBe("C:/native/aphrody-google.exe");
  } finally {
    if (previous === undefined) delete Bun.env.APHRODY_GOOGLE_BIN;
    else Bun.env.APHRODY_GOOGLE_BIN = previous;
  }
});

test("Google CLI resolves the canonical multi-call owner before legacy links", () => {
  const previous = Bun.env.APHRODY_GOOGLE_BIN;
  delete Bun.env.APHRODY_GOOGLE_BIN;
  try {
    const which = (name: string) => (name === "aphrody" ? "/native/aphrody" : "/legacy/google");
    expect(resolveGoogleCommand(which)).toEqual(["/native/aphrody", "google"]);
    expect(resolveGoogleCommand(name => (name === "google" ? "/native/google" : null))).toEqual(["/native/google"]);
    expect(() => resolveGoogleCommand(() => null)).toThrow("install aphrody");
    Bun.env.APHRODY_GOOGLE_BIN = "/configured/google";
    expect(resolveGoogleCommand(() => null)).toEqual(["/configured/google"]);
  } finally {
    if (previous === undefined) delete Bun.env.APHRODY_GOOGLE_BIN;
    else Bun.env.APHRODY_GOOGLE_BIN = previous;
  }
});

import { expect, test } from "bun:test";
import { googleRuntime } from "../src/runtime.ts";

test("maps Aphrody and RGFR projects without reading credentials", () => {
  expect(googleRuntime({ GOOGLE_CLOUD_PROJECT: "aphrody" }).project).toBe("aphrody");
  expect(googleRuntime({ GOOGLE_CLOUD_PROJECT: "rgfr-8927d" }).project).toBe("rgfr");
});

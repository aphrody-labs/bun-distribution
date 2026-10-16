import { describe, expect, test } from "bun:test";
import { policyFor } from "../src/catalog";
import { launchCommand } from "../src/launcher";

describe("compatibility policy", () => {
  test("keeps FC 27 experimental until end-to-end qualification", () => {
    expect(policyFor("4080220").requiresPublisherServices).toBe(true);
    expect(launchCommand("4080220")).toEqual(["steam", "-applaunch", "4080220"]);
  });

  test("allows unclassified titles only as experimental", () => {
    expect(policyFor("123").support).toBe("experimental");
    expect(launchCommand("123")).toEqual(["steam", "-applaunch", "123"]);
  });
});

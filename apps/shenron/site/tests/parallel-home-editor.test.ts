import { describe, expect, test } from "bun:test";
import { errorMessageFromBody, seedConfig } from "../src/app/admin/home/home-config-client";

describe("home editor client", () => {
  test("extrait le message d'un corps d'erreur JSON de l'API", () => {
    expect(errorMessageFromBody('{"error":"route refusée"}', 400)).toBe("route refusée");
    expect(errorMessageFromBody("", 500)).toBe("HTTP 500");
    expect(errorMessageFromBody("<html>" + "x".repeat(300), 502)).toBe("HTTP 502");
    expect(errorMessageFromBody("Forbidden", 403)).toBe("Forbidden");
  });

  test("un refetch n'écrase pas les modifications non enregistrées", () => {
    const loaded = { v: "serveur" };
    expect(seedConfig(null, loaded)).toBe(loaded);
    const edited = { v: "édité" };
    expect(seedConfig(edited, { v: "autre" })).toBe(edited);
    expect(seedConfig(null, undefined)).toBeNull();
  });
});

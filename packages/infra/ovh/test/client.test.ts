// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { OvhClient, sha1 } from "../src/client.js";

describe("OvhClient pure Bun cryptographic signing", () => {
  it("computes accurate SHA-1 hex digest", () => {
    // SHA1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
    expect(sha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    // SHA1("aphrody") = 1a9c55099105fe738f75ed2b220beaf809702dd8
    expect(sha1("aphrody")).toBe("1a9c55099105fe738f75ed2b220beaf809702dd8");
  });

  it("formats OVH signature adhering to $1$ + SHA1 spec", () => {
    const client = new OvhClient({
      applicationKey: "test_ak",
      applicationSecret: "test_as",
      consumerKey: "test_ck",
    });

    const method = "GET";
    const url = "https://eu.api.ovh.com/1.0/domain/zone";
    const bodyStr = "";
    const timestamp = 1700000000;

    // raw = "test_as+test_ck+GET+https://eu.api.ovh.com/1.0/domain/zone++1700000000"
    const raw = "test_as+test_ck+GET+https://eu.api.ovh.com/1.0/domain/zone++1700000000";
    const expectedSig = `$1$${sha1(raw)}`;

    const actualSig = client.sign(method, url, bodyStr, timestamp);
    expect(actualSig).toBe(expectedSig);
    expect(actualSig.startsWith("$1$")).toBe(true);
  });

  it("handles endpoint selection correctly", () => {
    const euClient = new OvhClient({
      applicationKey: "ak",
      applicationSecret: "as",
      consumerKey: "ck",
      endpoint: "ovh-eu",
    });
    expect(euClient.baseUrl).toBe("https://eu.api.ovh.com/1.0");

    const caClient = new OvhClient({
      applicationKey: "ak",
      applicationSecret: "as",
      consumerKey: "ck",
      endpoint: "ovh-ca",
    });
    expect(caClient.baseUrl).toBe("https://ca.api.ovh.com/1.0");

    const customClient = new OvhClient({
      applicationKey: "ak",
      applicationSecret: "as",
      consumerKey: "ck",
      endpoint: "https://custom.ovh.mock/1.0",
    });
    expect(customClient.baseUrl).toBe("https://custom.ovh.mock/1.0");
  });
});

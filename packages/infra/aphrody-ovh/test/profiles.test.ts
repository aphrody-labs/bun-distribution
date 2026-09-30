// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { KNOWN_PROFILES, parseCredentialsText } from "../src/profiles.js";

describe("OVH Profiles and Credential Parsing", () => {
  it("parses bash export secrets format (.bash_secrets)", () => {
    const text = `
# Production secrets
export OVH_APPLICATION_KEY="ak_12345"
export OVH_APPLICATION_SECRET="as_secret_67890"
export OVH_CONSUMER_KEY="ck_consumer_abcde"
export OVH_ENDPOINT="ovh-eu"
`;
    const parsed = parseCredentialsText(text, ".bash_secrets");
    expect(parsed).not.toBeNull();
    expect(parsed?.applicationKey).toBe("ak_12345");
    expect(parsed?.applicationSecret).toBe("as_secret_67890");
    expect(parsed?.consumerKey).toBe("ck_consumer_abcde");
    expect(parsed?.endpoint).toBe("ovh-eu");
  });

  it("parses INI format (~/.ovh.conf)", () => {
    const text = `
[default]
; default section
[ovh-eu]
application_key = ini_ak_999
application_secret = ini_as_888
consumer_key = ini_ck_777
`;
    const parsed = parseCredentialsText(text, ".ovh.conf");
    expect(parsed).not.toBeNull();
    expect(parsed?.applicationKey).toBe("ini_ak_999");
    expect(parsed?.applicationSecret).toBe("ini_as_888");
    expect(parsed?.consumerKey).toBe("ini_ck_777");
  });

  it("parses Certbot dns_ovh_* prefix format", () => {
    const text = `
dns_ovh_application_key = cb_ak
dns_ovh_application_secret = cb_as
dns_ovh_consumer_key = cb_ck
`;
    const parsed = parseCredentialsText(text, "ovh-dbfr.ini");
    expect(parsed).not.toBeNull();
    expect(parsed?.applicationKey).toBe("cb_ak");
    expect(parsed?.applicationSecret).toBe("cb_as");
    expect(parsed?.consumerKey).toBe("cb_ck");
  });

  it("includes all three segregated infrastructure profiles", () => {
    expect(KNOWN_PROFILES["aphrody.com"]).toBeDefined();
    expect(KNOWN_PROFILES["rosegriffon.fr"]).toBeDefined();
    expect(KNOWN_PROFILES["dragonballfr.com"]).toBeDefined();

    expect(KNOWN_PROFILES["aphrody.com"].domains).toContain("aphrody.com");
    expect(KNOWN_PROFILES["rosegriffon.fr"].domains).toContain("rosegriffon.fr");
    expect(KNOWN_PROFILES["dragonballfr.com"].domains).toContain("dragonballfr.com");
  });
});

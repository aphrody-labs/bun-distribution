// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { decryptManifest, encryptManifest } from "./secrets.js";

describe("Bun Native Secrets Engine", () => {
  test("encrypts and decrypts configuration map adhering to EncryptedManifest format", async () => {
    const raw = {
      DATABASE_URL: "postgres://aphrody_web:Secret123@127.0.0.1:5432/aphrody_web",
      JWT_SECRET: "token_abc_xyz_998877",
    };

    const passphrase = "correct-horse-battery-staple";
    const manifest = await encryptManifest("aphrody-web-api", raw, passphrase);

    expect(manifest.service).toBe("aphrody-web-api");
    expect(manifest.version).toBe(1);
    expect(manifest.crypto.algorithm).toBe("AES-256-GCM");
    expect(manifest.data.DATABASE_URL).toStartWith("ENC[AES256_GCM,");
    expect(manifest.data.JWT_SECRET).toStartWith("ENC[AES256_GCM,");

    const decrypted = await decryptManifest(manifest, passphrase);
    expect(decrypted.DATABASE_URL).toBe(raw.DATABASE_URL);
    expect(decrypted.JWT_SECRET).toBe(raw.JWT_SECRET);
  });

  test("rejects decryption with incorrect password", async () => {
    const raw = { KEY: "value" };
    const manifest = await encryptManifest("test", raw, "right-pass");

    expect(decryptManifest(manifest, "wrong-pass")).rejects.toThrow();
  });
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Pure Bun Native Secrets & Encrypted Envelope Engine for Aphrody Infra.
 *
 * Implements AES-256-GCM authenticated encryption/decryption using Web Crypto (crypto.subtle),
 * compatible with the Rust `EncryptedManifest` envelope format.
 */

export interface CryptoMeta {
  algorithm: string;
  kdf: string;
  iterations: number;
  salt: string;
}

export interface EncryptedManifest {
  version: number;
  service: string;
  encrypted_at: string;
  crypto: CryptoMeta;
  data: Record<string, string>;
}

/**
 * Derive a 256-bit AES-GCM key from a passphrase and salt using PBKDF2-HMAC-SHA256.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = 100_000): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 */
export async function encryptValue(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      enc.encode(plaintext),
    ),
  );

  // In WebCrypto, the 16-byte tag is appended to the ciphertext
  const tagStart = ciphertextWithTag.length - 16;
  const ciphertext = ciphertextWithTag.slice(0, tagStart);
  const tag = ciphertextWithTag.slice(tagStart);

  const b64Data = Buffer.from(ciphertext).toString("base64");
  const b64Iv = Buffer.from(iv).toString("base64");
  const b64Tag = Buffer.from(tag).toString("base64");

  return `ENC[AES256_GCM,data:${b64Data},iv:${b64Iv},tag:${b64Tag}]`;
}

/**
 * Decrypt an envelope value formatted like `ENC[AES256_GCM,data:...,iv:...,tag:...]`.
 */
export async function decryptValue(key: CryptoKey, encToken: string): Promise<string> {
  const trimmed = encToken.trim();
  if (!trimmed.startsWith("ENC[AES256_GCM,") || !trimmed.endsWith("]")) {
    throw new Error("Invalid envelope format");
  }

  const payload = trimmed.slice("ENC[AES256_GCM,".length, -1);
  const parts = payload.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split(":");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  if (!parts.data || !parts.iv || !parts.tag) {
    throw new Error("Missing data, iv or tag in encrypted token");
  }

  const ciphertext = Buffer.from(parts.data, "base64");
  const iv = Buffer.from(parts.iv, "base64");
  const tag = Buffer.from(parts.tag, "base64");

  // WebCrypto expects ciphertext and tag concatenated
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    combined,
  );

  return new TextDecoder().decode(decryptedBuf);
}

/**
 * Encrypt a full configuration map into an EncryptedManifest.
 */
export async function encryptManifest(
  service: string,
  records: Record<string, string>,
  passphrase: string,
): Promise<EncryptedManifest> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);

  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(records)) {
    data[k] = await encryptValue(key, v);
  }

  return {
    version: 1,
    service,
    encrypted_at: new Date().toISOString(),
    crypto: {
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-HMAC-SHA256",
      iterations: 100_000,
      salt: Buffer.from(salt).toString("base64"),
    },
    data,
  };
}

/**
 * Decrypt all secret values in an EncryptedManifest.
 */
export async function decryptManifest(
  manifest: EncryptedManifest,
  passphrase: string,
): Promise<Record<string, string>> {
  const salt = Buffer.from(manifest.crypto.salt, "base64");
  const key = await deriveKey(passphrase, salt, manifest.crypto.iterations);

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(manifest.data)) {
    out[k] = await decryptValue(key, v);
  }

  return out;
}

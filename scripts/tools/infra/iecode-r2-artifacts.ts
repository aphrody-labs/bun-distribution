// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Artifact transfers and checksum readbacks are deliberately ordered. */
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { S3Client } from "bun";

export type Artifact = {
  bucket: "iecode-vfs" | "rg-assets";
  key: string;
  source: string;
  bytes: number;
  sha256: string;
  visibility: "private" | "public-artifact";
};
export type ArtifactInput = {
  schema: "iecode.r2-artifacts/1";
  revision: string;
  files: Artifact[];
};
const digest = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function validateArtifactInput(input: ArtifactInput) {
  if (
    input.schema !== "iecode.r2-artifacts/1" ||
    !/^[a-f0-9]{40}$/.test(input.revision) ||
    !input.files.length
  )
    throw new Error("A non-empty immutable product manifest is required");
  const objects = new Set<string>();
  for (const file of input.files) {
    const prefix =
      file.bucket === "iecode-vfs"
        ? new RegExp(`^(?:iecode|nie)/releases/${input.revision}/`)
        : file.bucket === "rg-assets"
          ? new RegExp(`^releases/${input.revision}/`)
          : null;
    if (
      !prefix?.test(file.key) ||
      /[\\:\0]/.test(file.key) ||
      file.key.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Object is outside the two immutable product prefixes");
    if (
      !isAbsolute(file.source) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Invalid local artifact receipt");
    if (!file.key.includes(`/${file.sha256}/`))
      throw new Error("Object keys must include their content digest");
    if (!["private", "public-artifact"].includes(file.visibility))
      throw new Error("Object visibility is required");
    const paths = [file.key, file.source.replaceAll("\\", "/")];
    if (
      paths.some((path) =>
        /(^|\/)(?:\.codex|\.claude|\.git|\.env[^/]*|\.npmrc|auth|cookies|sessions|credentials|secrets)(\/|$)/i.test(
          path,
        ),
      )
    )
      throw new Error("Protected provider or authentication stores cannot be distributed");
    if (
      paths.some((path) =>
        /\.(?:sqlite|db|dump|pem|pfx|key|rom|nds|nsp|nca|xci|cpk|sav)$/i.test(path),
      )
    )
      throw new Error("Only sealed artifact archives may be distributed by this adapter");
    const object = `${file.bucket}/${file.key}`;
    if (objects.has(object)) throw new Error("Duplicate object key");
    objects.add(object);
  }
  return input.files;
}

export async function distribute(input: ArtifactInput, apply = false) {
  const files = validateArtifactInput(input);
  for (const file of files) {
    const stat = lstatSync(file.source);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== file.bytes ||
      digest(readFileSync(file.source)) !== file.sha256
    )
      throw new Error("Artifact source integrity mismatch");
  }
  const endpoint = process.env.IECODE_R2_ENDPOINT;
  if (!endpoint || !/^https:\/\/[a-f0-9]{32}\.eu\.r2\.cloudflarestorage\.com$/.test(endpoint))
    throw new Error("The protected EU storage endpoint is required");
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
    throw new Error("Protected scoped storage authentication is required");
  const results = [];
  for (const file of files) {
    const client = new S3Client({
      bucket: file.bucket,
      endpoint,
      region: "auto",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    });
    await client.list({ maxKeys: 1 });
    const object = client.file(file.key);
    const exists = await object.exists();
    if (exists) {
      if (digest(new Uint8Array(await object.arrayBuffer())) !== file.sha256)
        throw new Error("Immutable remote artifact differs; overwrite refused");
    } else if (apply) {
      await object.write(Bun.file(file.source));
      if (digest(new Uint8Array(await object.arrayBuffer())) !== file.sha256)
        throw new Error("Remote artifact checksum mismatch");
    }
    results.push({
      bucket: file.bucket,
      key: file.key,
      bytes: file.bytes,
      sha256: file.sha256,
      visibility: file.visibility,
      operation: exists ? "current" : "create",
      verified: exists || apply,
    });
  }
  return {
    schema: "iecode.r2-receipt/1",
    revision: input.revision,
    applied: apply,
    endpoint,
    files: results,
    productionActivated: false,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { input: { type: "string" }, apply: { type: "boolean", default: false } },
  });
  if (!values.input) throw new Error("Use --input SEALED_MANIFEST [--apply]");
  console.log(
    JSON.stringify(await distribute(await Bun.file(values.input).json(), values.apply), null, 2),
  );
}

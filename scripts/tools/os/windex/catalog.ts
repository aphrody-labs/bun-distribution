// SPDX-License-Identifier: Apache-2.0
// Catalog-signature lookup (wintrust CryptCATAdmin*): most Windows binaries carry no embedded signature and are
// signed through a system catalog (CatRoot). The Authenticode hash of the file is computed by the OS and looked up
// in the catalog database; the result is the catalog file and the signer declared by its PKCS#7 envelope. A failed
// lookup is reported as "no catalog", never as signed. The lookup is slow (synchronous catalog database query), so
// scans run it as a deferred pass in the worker pool, not inline with every PE.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseSignedData } from "./authenticode.ts";
import {
  closeHandle,
  GENERIC_READ,
  openHandle,
  readWstr,
  wintrust,
  wstr,
  type Pointer,
} from "./win32.ts";

let admins: { sha256: Pointer | null; sha1: Pointer | null } | undefined;

function acquire(alg: "SHA256" | "SHA1"): Pointer | null {
  const lib = wintrust();
  if (!lib) return null;
  const out = new BigUint64Array(1);
  const ok = lib.CryptCATAdminAcquireContext2(out, null, wstr(alg), null, 0);
  return ok ? (Number(out[0]) as Pointer) : null;
}

function contexts() {
  admins ??= { sha256: acquire("SHA256"), sha1: acquire("SHA1") };
  return admins;
}

function lookup(admin: Pointer, file: Pointer): string | null {
  const lib = wintrust()!;
  const size = new Uint32Array([64]);
  const hash = new Uint8Array(64);
  if (!lib.CryptCATAdminCalcHashFromFileHandle2(admin, file, size, hash, 0)) return null;
  const info = lib.CryptCATAdminEnumCatalogFromHash(admin, hash, size[0]!, 0, null);
  if (!info) return null;
  try {
    // CATALOG_INFO: DWORD cbStruct + WCHAR wszCatalogFile[MAX_PATH].
    const ci = new Uint8Array(4 + 520);
    new DataView(ci.buffer).setUint32(0, ci.byteLength, true);
    if (!lib.CryptCATCatalogInfoFromContext(info, ci, 0)) return "catalog";
    return readWstr(ci, 4, 260) || "catalog";
  } finally {
    lib.CryptCATAdminReleaseCatalogContext(admin, info, 0);
  }
}

export type CatalogSignature = {
  catalog: string;
  signer: string | null;
  issuer: string | null;
  digest: string | null;
};

const signers = new Map<string, Omit<CatalogSignature, "catalog">>();

/** Signer declared by a catalog file (cached per process: a few thousand catalogs sign the whole system). */
function catalogSigner(file: string): Omit<CatalogSignature, "catalog"> {
  let s = signers.get(file);
  if (!s) {
    let a = null;
    try {
      a = parseSignedData(new Uint8Array(readFileSync(file)));
    } catch {
      a = null;
    }
    s = { signer: a?.signer ?? null, issuer: a?.issuer ?? null, digest: a?.digest ?? null };
    signers.set(file, s);
  }
  return s;
}

/** Catalog that lists this file and the catalog's declared signer, or null. */
export function catalogSignature(path: string): CatalogSignature | null {
  const file = catalogFile(path);
  if (!file) return null;
  return {
    catalog: basename(file),
    ...(file.includes("\\") ? catalogSigner(file) : { signer: null, issuer: null, digest: null }),
  };
}

/** Name of the system catalog that lists this file (SHA-256 then SHA-1 catalogs), or null. */
export function catalogOf(path: string): string | null {
  const file = catalogFile(path);
  return file ? basename(file) : null;
}

function catalogFile(path: string): string | null {
  const ctx = contexts();
  if (ctx.sha256 === null && ctx.sha1 === null) return null;
  const h = openHandle(path, GENERIC_READ, 0);
  if ("error" in h) return null;
  try {
    for (const admin of [ctx.sha256, ctx.sha1]) {
      if (admin === null) continue;
      const name = lookup(admin, h.handle);
      if (name) return name;
    }
    return null;
  } finally {
    closeHandle(h.handle);
  }
}

export function releaseCatalogContexts(): void {
  const lib = wintrust();
  if (!lib || !admins) return;
  for (const a of [admins.sha256, admins.sha1])
    if (a !== null) lib.CryptCATAdminReleaseContext(a, 0);
  admins = undefined;
}

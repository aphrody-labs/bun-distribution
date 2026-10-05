// SPDX-License-Identifier: Apache-2.0
//
// The error of the X client. The classification (`kind`) is made once, in Rust
// (crates/web/x/src/policy.rs); the code tables below are the same JSON file
// (crates/web/x/data/x-policy.json), read by both languages, for failures that did not come
// through the native client (a hand-built `XError`, a journal replayed from disk).

import type { XErrorKind, XNativeErrorInfo } from "@aphrody/bun/x";
import policy from "../../../../../crates/web/x/data/x-policy.json";

export type { XErrorKind };

export const AUTH_CODES: ReadonlySet<number> = new Set(policy.auth_codes);
export const AUTH_STATUSES: ReadonlySet<number> = new Set(policy.auth_statuses);
export const TERMINAL_CODES: ReadonlySet<number> = new Set(policy.terminal_codes);
export const TERMINAL_STATUSES: ReadonlySet<number> = new Set(policy.terminal_statuses);
export const RATE_LIMIT_CODES: ReadonlySet<number> = new Set(policy.rate_limit_codes);
export const RATE_LIMIT_STATUSES: ReadonlySet<number> = new Set(policy.rate_limit_statuses);

/** A failure of the X API or of the client that talks to it. */
export class XError extends Error {
  /** The X API error code (`errors[].code`), or -1 when the failure had none. */
  public code: number;
  /** The HTTP status, when the failure was a bare HTTP status. */
  public status?: number;
  /** How to treat it, as classified by Rust. Absent on an error built by hand. */
  public kind?: XErrorKind;
  /** For a rate limit: the epoch second at which the window reopens, when known. */
  public resetEpoch?: number;

  constructor(message: string, code: number, status?: number, kind?: XErrorKind) {
    super(message);
    this.name = "XError";
    this.code = code;
    this.status = status;
    this.kind = kind;
  }
}

/** Build the `XError` of a native failure description. */
export function xErrorFromInfo(info: XNativeErrorInfo): XError {
  const error = new XError(info.message, info.code ?? -1, info.status, info.kind);
  error.resetEpoch = info.reset_epoch;
  return error;
}

/** Extract structured X API errors from a response body and throw if present. */
export function checkApiErrors(body: any): void {
  if (body?.errors && Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const code = typeof first.code === "number" ? first.code : -1;
    const message = first.message || "unknown error";
    throw new XError(`X API error ${code}: ${message}`, code);
  }
}

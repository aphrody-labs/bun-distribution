import type { AchilleaClientResult } from "@rosegriffon/achillea-client";

/** A failed identity read only proves anonymity when the API rejected credentials. */
export function failedIdentityStatus(result: AchilleaClientResult<unknown>): "anonymous" | "error" {
  return !result.ok && result.kind === "http" && (result.status === 401 || result.status === 403)
    ? "anonymous"
    : "error";
}

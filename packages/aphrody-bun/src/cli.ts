// SPDX-License-Identifier: Apache-2.0
import { loadNativeLibrary, resolveNativeLibraryPath } from "./library";

export {
  EXPECTED_ABI_VERSION as EXPECTED_APHRODY_ABI_VERSION,
  abiVersion as getAphrodyAbiVersion,
  version as getAphrodyVersion,
  lastError as getAphrodyLastError,
  run as runAphrody,
  runCaptured as runAphrodyCaptured,
} from "./engine";
export type { CapturedResult as AphrodyCapturedResult } from "./engine";

/** Availability checks validate the same native handle used by every subpath. */
export function isAphrodyFfiAvailable(): boolean {
  if (!resolveNativeLibraryPath()) return false;
  loadNativeLibrary();
  return true;
}

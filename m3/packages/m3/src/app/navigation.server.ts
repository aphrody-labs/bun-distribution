// SPDX-License-Identifier: Apache-2.0
// `next/navigation` in server components (`react-server` condition): control flow only.
import { isNotFoundError, redirectInfo } from "./runtime/shared";

export { notFound, permanentRedirect, redirect, type RedirectType } from "./runtime/shared";

const clientOnly = (hook: string) => (): never => {
  throw new Error(`@aphrody/m3: ${hook} only works in client components ("use client")`);
};

export const useRouter = clientOnly("useRouter()");
export const usePathname = clientOnly("usePathname()");
export const useSearchParams = clientOnly("useSearchParams()");
export const useParams = clientOnly("useParams()");

/** Rethrow the errors the framework handles itself (`notFound()`, `redirect()`) from a `catch`. */
export function unstable_rethrow(error: unknown): void {
  if (isNotFoundError(error) || redirectInfo(error)) throw error;
}

// SPDX-License-Identifier: Apache-2.0
// Constants and control-flow errors shared by the server and the browser runtimes.

/** Content type of a React Server Components payload. */
export const RSC_CONTENT_TYPE = "text/x-component";
/** Request header asking for the RSC payload instead of HTML (client navigation). */
export const RSC_HEADER = "rsc";
/** Request header carrying the server action id. */
export const ACTION_HEADER = "m3-action";
/** Public URL prefix of the client assets. */
export const ASSET_PREFIX = "/_m3/";
/** WebSocket path of the development server. */
export const HMR_PATH = "/_m3/hmr";

const NOT_FOUND = "M3_NOT_FOUND";
const REDIRECT = "M3_REDIRECT";

export type RedirectType = "push" | "replace";

/** Error thrown by `notFound()`; its digest survives the RSC serialization. */
export class NotFoundError extends Error {
  readonly digest = NOT_FOUND;
  constructor() {
    super(NOT_FOUND);
  }
}

/** Error thrown by `redirect()`. Digest: `M3_REDIRECT;<type>;<status>;<url>`. */
export class RedirectError extends Error {
  readonly digest: string;
  constructor(
    readonly url: string,
    readonly status: 307 | 308 | 303,
    readonly type: RedirectType = "replace",
  ) {
    super(REDIRECT);
    this.digest = `${REDIRECT};${type};${status};${url}`;
  }
}

const digestOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string"
    ? (error as { digest: string }).digest
    : undefined;

export function isNotFoundError(error: unknown): boolean {
  return digestOf(error) === NOT_FOUND;
}

/** `{ url, status, type }` of a redirect error (also after serialization), else `undefined`. */
export function redirectInfo(error: unknown): { url: string; status: number; type: RedirectType } | undefined {
  const digest = digestOf(error);
  if (!digest?.startsWith(`${REDIRECT};`)) return undefined;
  const [, type, status, ...url] = digest.split(";");
  return { url: url.join(";"), status: Number(status), type: type as RedirectType };
}

/** `notFound()`: render the nearest `not-found` with a 404 status. */
export function notFound(): never {
  throw new NotFoundError();
}

/** `redirect(url)`: 307 (or 303 after a server action). */
export function redirect(url: string, type: RedirectType = "replace"): never {
  throw new RedirectError(url, 307, type);
}

/** `permanentRedirect(url)`: 308. */
export function permanentRedirect(url: string, type: RedirectType = "replace"): never {
  throw new RedirectError(url, 308, type);
}

/** The model streamed as the RSC payload root. */
export interface RscPayload {
  /** The page tree (the root layout renders `<html>`). */
  root: unknown;
  pathname: string;
  search: string;
  params: Record<string, string | string[]>;
  /** Return value of the server action that produced this payload. */
  returnValue?: unknown;
  /** Form state of a progressively enhanced action (for `useActionState`). */
  formState?: unknown;
  /** A redirect raised by a server action. */
  redirect?: string;
  /** Build id; a mismatch makes the client reload. */
  buildId: string;
}

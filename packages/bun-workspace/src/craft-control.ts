// SPDX-License-Identifier: MIT AND Apache-2.0
/**
 * Bun-native client for the local JSON-lines control channels that Craft owners
 * already expose. This transport is deliberately separate from each engine's
 * CLI contract and supports only the applications with a documented TCP server.
 */

export type CraftControlLibraryId =
  | "cadcraft"
  | "deckcraft"
  | "designcraft"
  | "effectcraft"
  | "figcraft"
  | "filmcraft"
  | "gridcraft"
  | "lightcraft"
  | "photocraft"
  | "soundcraft"
  | "vectorcraft"
  | "wordcraft";

type UnauthenticatedConnection = {
  libraryId: Exclude<CraftControlLibraryId, "photocraft" | "wordcraft">;
  /** Explicit loopback TCP port reported by the running application. */
  port: number;
};

type PhotoCraftConnection = {
  libraryId: "photocraft";
  port: number;
  /** The 256-bit bearer token configured for this running PhotoCraft instance. */
  token: string;
};

type WordCraftConnection = {
  libraryId: "wordcraft";
  port: number;
  /** The 256-bit key read from this running WordCraft instance's private key file. */
  key: string;
};

export type CraftControlConnection =
  UnauthenticatedConnection | PhotoCraftConnection | WordCraftConnection;

export interface CraftControlOptions {
  /** Defaults to 30 seconds; capped at two minutes. */
  timeoutMs?: number;
  /** Defaults to 8 MiB; capped at 64 MiB. */
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

export interface CraftControlReply {
  id: string | number | null;
  ok: boolean;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

export type CraftControlErrorCode =
  | "INVALID_ENDPOINT"
  | "INVALID_REQUEST"
  | "MISSING_CREDENTIAL"
  | "INVALID_CREDENTIAL"
  | "CONNECT_FAILED"
  | "CONNECTION_LIMIT"
  | "ABORTED"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_RESPONSE"
  | "OWNER_ERROR";

export class CraftControlError extends Error {
  constructor(
    readonly code: CraftControlErrorCode,
    message: string,
    readonly reply?: CraftControlReply,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CraftControlError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_ACTIVE_CONNECTIONS = 16;
const TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;
let nextRequestId = 1;
let activeConnections = 0;
const controlLibraryIds = new Set<CraftControlLibraryId>([
  "cadcraft",
  "deckcraft",
  "designcraft",
  "effectcraft",
  "figcraft",
  "filmcraft",
  "gridcraft",
  "lightcraft",
  "photocraft",
  "soundcraft",
  "vectorcraft",
  "wordcraft",
]);

function assertConnection(connection: CraftControlConnection): void {
  if (
    !connection ||
    typeof connection !== "object" ||
    !controlLibraryIds.has(connection.libraryId) ||
    !Number.isInteger(connection.port) ||
    connection.port < 1 ||
    connection.port > 65_535
  ) {
    throw new CraftControlError(
      "INVALID_ENDPOINT",
      "Craft control requires an explicit loopback port from 1 to 65535.",
    );
  }
  if (connection.libraryId === "photocraft") {
    if (!connection.token)
      throw new CraftControlError(
        "MISSING_CREDENTIAL",
        "PhotoCraft control requires this instance's token.",
      );
    if (!TOKEN_PATTERN.test(connection.token))
      throw new CraftControlError(
        "INVALID_CREDENTIAL",
        "PhotoCraft token must be 64 hexadecimal characters.",
      );
  }
  if (connection.libraryId === "wordcraft") {
    if (!connection.key)
      throw new CraftControlError(
        "MISSING_CREDENTIAL",
        "WordCraft control requires this instance's key.",
      );
    if (!TOKEN_PATTERN.test(connection.key))
      throw new CraftControlError(
        "INVALID_CREDENTIAL",
        "WordCraft key must be 64 hexadecimal characters.",
      );
  }
}

function assertOptions(options: CraftControlOptions): {
  timeoutMs: number;
  maxResponseBytes: number;
} {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    throw new CraftControlError(
      "INVALID_REQUEST",
      "Craft control timeout must be between 1 ms and 2 minutes.",
    );
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > MAX_RESPONSE_BYTES
  )
    throw new CraftControlError(
      "INVALID_REQUEST",
      "Craft control response limit must be between 1 byte and 64 MiB.",
    );
  return { timeoutMs, maxResponseBytes };
}

function encodeFrame(value: object): Uint8Array {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch (cause) {
    throw new CraftControlError(
      "INVALID_REQUEST",
      "Craft control request must contain only JSON values.",
      undefined,
      { cause },
    );
  }
  if (typeof encoded !== "string")
    throw new CraftControlError(
      "INVALID_REQUEST",
      "Craft control request could not be serialized as JSON.",
    );
  const frame = new TextEncoder().encode(`${encoded}\n`);
  if (frame.byteLength > MAX_REQUEST_BYTES)
    throw new CraftControlError(
      "INVALID_REQUEST",
      `Craft control request exceeds ${MAX_REQUEST_BYTES} bytes.`,
    );
  return frame;
}

function parseReply(
  line: string,
  expectedId: string | number,
): CraftControlReply {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new CraftControlError(
      "INVALID_RESPONSE",
      "Craft control returned invalid JSON.",
      undefined,
      { cause },
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !((value as Record<string, unknown>).id === expectedId) ||
    typeof (value as Record<string, unknown>).ok !== "boolean"
  ) {
    throw new CraftControlError(
      "INVALID_RESPONSE",
      "Craft control returned a reply with an unexpected shape or ID.",
    );
  }
  const reply = value as CraftControlReply;
  if (reply.ok === false)
    throw new CraftControlError(
      "OWNER_ERROR",
      reply.error ?? "Craft control request failed.",
      reply,
    );
  return reply;
}

/**
 * Call one method on an explicitly addressed local Craft application instance.
 * A fresh connection is used for each request, so calls never multiplex or
 * assume an owner-specific command catalog. Only 127.0.0.1 is contacted.
 */
export async function callCraftControl(
  connection: CraftControlConnection,
  method: string,
  params: Record<string, unknown> = {},
  options: CraftControlOptions = {},
): Promise<CraftControlReply> {
  assertConnection(connection);
  const { timeoutMs, maxResponseBytes } = assertOptions(options);
  if (
    typeof method !== "string" ||
    method.length === 0 ||
    method.includes("\0")
  )
    throw new CraftControlError(
      "INVALID_REQUEST",
      "Craft control method must be a nonempty NUL-free string.",
    );
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new CraftControlError(
      "INVALID_REQUEST",
      "Craft control params must be a JSON object.",
    );
  if (options.signal?.aborted)
    throw new CraftControlError(
      "ABORTED",
      "Craft control request was aborted.",
    );
  if (activeConnections >= MAX_ACTIVE_CONNECTIONS)
    throw new CraftControlError(
      "CONNECTION_LIMIT",
      `Craft control permits at most ${MAX_ACTIVE_CONNECTIONS} active connections per Bun process.`,
    );

  const id = nextRequestId++;
  const request: Record<string, unknown> = { id, method, params };
  if (connection.libraryId === "wordcraft") request.key = connection.key;
  const requestFrame = encodeFrame(request);
  const authFrame =
    connection.libraryId === "photocraft"
      ? encodeFrame({
          id: "auth",
          method: "auth",
          params: { token: connection.token },
        })
      : undefined;

  let socket: Awaited<ReturnType<typeof Bun.connect>> | undefined;
  let settled = false;
  let responseBytes = 0;
  let responseText = "";
  let exchange: "auth" | "request" = authFrame ? "auth" : "request";
  // JSON-lines is UTF-8. Do not silently replace malformed bytes: that can turn
  // a corrupt owner response into apparently valid JSON with damaged strings.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  activeConnections++;

  const result = new Promise<CraftControlReply>((resolve, reject) => {
    const finish = (error?: CraftControlError, reply?: CraftControlReply) => {
      if (settled) return;
      settled = true;
      activeConnections--;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (reply) resolve(reply);
      socket?.close();
    };
    const abort = () =>
      finish(
        new CraftControlError("ABORTED", "Craft control request was aborted."),
      );
    const timer = setTimeout(
      () =>
        finish(
          new CraftControlError(
            "TIMEOUT",
            `Craft control did not reply within ${timeoutMs} ms.`,
          ),
        ),
      timeoutMs,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }

    try {
      void Bun.connect({
        hostname: "127.0.0.1",
        port: connection.port,
        socket: {
          open(connected) {
            socket = connected;
            if (settled) {
              connected.close();
              return;
            }
            const written = connected.write(authFrame ?? requestFrame);
            if (written < (authFrame ?? requestFrame).byteLength)
              finish(
                new CraftControlError(
                  "CONNECT_FAILED",
                  "Craft control request could not be written completely.",
                ),
              );
          },
          data(connected, chunk) {
            if (settled) return;
            responseBytes += chunk.byteLength;
            if (responseBytes > maxResponseBytes) {
              finish(
                new CraftControlError(
                  "RESPONSE_TOO_LARGE",
                  `Craft control response exceeds ${maxResponseBytes} bytes.`,
                ),
              );
              return;
            }
            try {
              responseText += decoder.decode(chunk, { stream: true });
            } catch (cause) {
              finish(
                new CraftControlError(
                  "INVALID_RESPONSE",
                  "Craft control returned malformed UTF-8.",
                  undefined,
                  { cause },
                ),
              );
              return;
            }
            const newline = responseText.indexOf("\n");
            if (newline < 0) return;
            // The first complete frame is the end of this exchange. Flush the
            // streaming decoder before accepting it so a dangling UTF-8 lead
            // byte after the newline cannot be silently discarded on close.
            try {
              decoder.decode();
            } catch (cause) {
              finish(
                new CraftControlError(
                  "INVALID_RESPONSE",
                  "Craft control returned malformed UTF-8.",
                  undefined,
                  { cause },
                ),
              );
              return;
            }
            const line = responseText.slice(0, newline).replace(/\r$/, "");
            const trailing = responseText.slice(newline + 1).trim();
            if (trailing) {
              finish(
                new CraftControlError(
                  "INVALID_RESPONSE",
                  "Craft control sent more than one reply for a single request.",
                ),
              );
              return;
            }
            try {
              if (exchange === "auth") {
                const auth = parseReply(line, "auth");
                if (!auth.ok)
                  throw new CraftControlError(
                    "OWNER_ERROR",
                    "PhotoCraft authentication failed.",
                    auth,
                  );
                exchange = "request";
                responseBytes = 0;
                responseText = "";
                const written = connected.write(requestFrame);
                if (written < requestFrame.byteLength)
                  finish(
                    new CraftControlError(
                      "CONNECT_FAILED",
                      "Craft control request could not be written completely.",
                    ),
                  );
                return;
              }
              finish(undefined, parseReply(line, id));
            } catch (error) {
              finish(
                error instanceof CraftControlError
                  ? error
                  : new CraftControlError(
                      "INVALID_RESPONSE",
                      "Craft control response could not be read.",
                      undefined,
                      { cause: error },
                    ),
              );
            }
          },
          error(_connected, error) {
            finish(
              new CraftControlError(
                "CONNECT_FAILED",
                "Craft control connection failed.",
                undefined,
                { cause: error },
              ),
            );
          },
          connectError(_connected, error) {
            finish(
              new CraftControlError(
                "CONNECT_FAILED",
                `Could not connect to ${connection.libraryId} on loopback port ${connection.port}.`,
                undefined,
                { cause: error },
              ),
            );
          },
          close(_connected, error) {
            if (!settled)
              finish(
                new CraftControlError(
                  "INVALID_RESPONSE",
                  "Craft control closed before returning a complete reply.",
                  undefined,
                  error ? { cause: error } : undefined,
                ),
              );
          },
          end(_connected) {
            if (!settled)
              finish(
                new CraftControlError(
                  "INVALID_RESPONSE",
                  "Craft control ended before returning a complete reply.",
                ),
              );
          },
        },
      })
        .then((connected) => {
          socket = connected;
          if (settled) connected.close();
        })
        .catch((error) => {
          finish(
            new CraftControlError(
              "CONNECT_FAILED",
              `Could not connect to ${connection.libraryId} on loopback port ${connection.port}.`,
              undefined,
              { cause: error },
            ),
          );
        });
    } catch (error) {
      finish(
        new CraftControlError(
          "CONNECT_FAILED",
          `Could not connect to ${connection.libraryId} on loopback port ${connection.port}.`,
          undefined,
          { cause: error },
        ),
      );
    }
  });

  return result;
}

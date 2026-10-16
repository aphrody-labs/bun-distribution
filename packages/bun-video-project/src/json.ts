import { VideoLibraryError } from "./errors.ts";

export type NativeInteger = number | bigint;
export type NativeJSON =
  null | boolean | string | number | bigint | NativeJSON[] | NativeObject;
export interface NativeObject {
  [key: string]: NativeJSON;
}

interface JSONSourceContext {
  source?: string;
}

interface ExactJSON {
  parse(
    text: string,
    reviver: (
      key: string,
      value: unknown,
      context?: JSONSourceContext,
    ) => unknown,
  ): unknown;
  rawJSON(text: string): object;
}

const exactJSON = JSON as unknown as ExactJSON;
const safeInteger = BigInt(Number.MAX_SAFE_INTEGER);

/** Rust emits i64/u64 as decimal integer tokens. Preserve those tokens beyond Number's range. */
export function parseNativeJSON<T = NativeJSON>(text: string): T {
  try {
    return exactJSON.parse(text, (_key, value, context) => {
      if (typeof value !== "number") return value;
      if (!Number.isFinite(value) || !context?.source) {
        throw new VideoLibraryError(
          "INVALID_NATIVE_JSON",
          "Native JSON requires finite numbers and source context.",
        );
      }
      if (/^-?\d+$/.test(context.source)) {
        const integer = BigInt(context.source);
        return integer > safeInteger || integer < -safeInteger
          ? integer
          : value;
      }
      // Fractional/exponent tokens are native floating point values, rather than Rust integer fields.
      return value;
    }) as T;
  } catch (error) {
    if (error instanceof VideoLibraryError) throw error;
    throw new VideoLibraryError(
      "INVALID_NATIVE_JSON",
      "The video engine returned invalid JSON.",
    );
  }
}

/** Serialize bigint as an exact JSON integer, retaining the native Rust command contract. */
export function stringifyNativeJSON(value: unknown, space?: number): string {
  if (
    space !== undefined &&
    (!Number.isInteger(space) || space < 0 || space > 10)
  ) {
    throw new VideoLibraryError(
      "INVALID_JSON_VALUE",
      "JSON indentation must be between 0 and 10.",
    );
  }
  try {
    const text = JSON.stringify(
      value,
      (_key, entry: unknown) => {
        if (typeof entry === "bigint") {
          if (typeof exactJSON.rawJSON !== "function") {
            throw new VideoLibraryError(
              "INVALID_JSON_VALUE",
              "Exact JSON integers require the Aphrody Bun runtime.",
            );
          }
          return exactJSON.rawJSON(entry.toString());
        }
        if (
          (typeof entry === "number" &&
            (!Number.isFinite(entry) ||
              (Number.isInteger(entry) && !Number.isSafeInteger(entry)))) ||
          typeof entry === "function" ||
          typeof entry === "symbol"
        ) {
          throw new VideoLibraryError(
            "INVALID_JSON_VALUE",
            "Use finite JSON values and bigint for large integers.",
          );
        }
        return entry;
      },
      space,
    );
    if (text === undefined)
      throw new VideoLibraryError(
        "INVALID_JSON_VALUE",
        "A JSON value is required.",
      );
    return text;
  } catch (error) {
    if (error instanceof VideoLibraryError) throw error;
    throw new VideoLibraryError(
      "INVALID_JSON_VALUE",
      "The value cannot be serialized as native JSON.",
    );
  }
}

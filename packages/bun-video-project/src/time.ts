import { VideoLibraryError } from "./errors.ts";

export const TICKS_PER_SECOND = 254_016_000_000n;
const minTick = -(1n << 63n);
const maxTick = (1n << 63n) - 1n;

function checkedTick(ticks: bigint): bigint {
  if (typeof ticks !== "bigint" || ticks < minTick || ticks > maxTick) {
    throw new VideoLibraryError("INVALID_TIME", "Ticks must fit a signed 64-bit integer.");
  }
  return ticks;
}

/** Convert plain decimal seconds exactly. Reject values between native ticks. */
export function ticksFromDecimalSeconds(seconds: string): bigint {
  if (typeof seconds !== "string" || seconds.length > 64 || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(seconds)) {
    throw new VideoLibraryError("INVALID_TIME", "Use plain decimal seconds with at most 12 fractional digits.");
  }
  const negative = seconds.startsWith("-");
  const [whole, fraction = ""] = (negative ? seconds.slice(1) : seconds).split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`) * TICKS_PER_SECOND;
  if (numerator % denominator !== 0n) {
    throw new VideoLibraryError("INVALID_TIME", "The supplied seconds do not fall on an exact native tick.");
  }
  return checkedTick((negative ? -numerator : numerator) / denominator);
}

/** Display seconds with a fixed precision, truncated toward zero; this is not a round trip. */
export function ticksToDecimalSeconds(ticks: bigint, precision = 12): string {
  checkedTick(ticks);
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
    throw new VideoLibraryError("INVALID_TIME", "Decimal precision must be between 0 and 12.");
  }
  const scale = 10n ** BigInt(precision);
  const scaled = (ticks * scale) / TICKS_PER_SECOND;
  const magnitude = scaled < 0n ? -scaled : scaled;
  const sign = scaled < 0n ? "-" : "";
  if (precision === 0) return `${sign}${magnitude}`;
  return `${sign}${magnitude / scale}.${(magnitude % scale).toString().padStart(precision, "0")}`;
}

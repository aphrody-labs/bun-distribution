// Keep numeric API identifiers exact when PostgreSQL int8 values arrive as strings.
export function parseRankedId(value: string | number | bigint): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("Ranked identifier is outside the positive safe-integer range");
  }
  return id;
}

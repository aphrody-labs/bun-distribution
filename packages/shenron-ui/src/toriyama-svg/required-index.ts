/** Geometry inputs must contain a value at each index used by a path. */
export function requiredIndex<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (!Number.isInteger(index) || index < 0 || value === undefined) {
    throw new RangeError(`Missing geometry value at index ${index}`);
  }
  return value;
}

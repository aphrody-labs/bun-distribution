/**
 * SIMD Chunked Parallel Sum of Squares via bun:ffi zero-copy.
 */
import { dlopen, FFIType, ptr } from "bun:ffi";
import { defaultLibraryPath } from "./index";

let ffiCache: {
  symbols: { ffi_sum_squares: (p: ReturnType<typeof ptr>, len: number) => number };
} | null = null;

export function fastSumSquares(numbers: Float64Array, customLibPath?: string): number {
  if (numbers.length === 0) return 0;

  if (!ffiCache) {
    const libPath = customLibPath ?? defaultLibraryPath();
    try {
      ffiCache = dlopen(libPath, {
        ffi_sum_squares: {
          args: [FFIType.ptr, FFIType.u64],
          returns: FFIType.f64,
        },
      });
    } catch {
      // Fallback in pure JS if dylib not yet compiled
      let sum = 0;
      for (let i = 0; i < numbers.length; i++) {
        const x = numbers[i]!;
        sum += x * x;
      }
      return sum;
    }
  }

  return ffiCache.symbols.ffi_sum_squares(ptr(numbers), numbers.length);
}

import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import { resolve } from "node:path";

export const tinkeAotLibrary = resolve(
  import.meta.dir,
  "../../../../build/nds/tinke",
  `bun_engine_nds_tinke.${suffix}`,
);

const symbols = {
  bun_engine_nds_tinke_abi: { args: [], returns: FFIType.u32 },
  bun_engine_nds_tinke_decrypt: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u32],
    returns: FFIType.i32,
  },
  bun_engine_nds_tinke_encrypt: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u32],
    returns: FFIType.i32,
  },
  bun_engine_nds_tinke_pac_count: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
} as const;

function pointer(bytes: Uint8Array): ReturnType<typeof ptr> {
  if (bytes.byteLength === 0) throw new RangeError("Tinke buffer must not be empty");
  return ptr(bytes);
}

export function loadTinkeAot(path = tinkeAotLibrary) {
  const library = dlopen(path, symbols);
  if (library.symbols.bun_engine_nds_tinke_abi() !== 1) {
    library.close();
    throw new Error("unsupported Tinke NativeAOT ABI");
  }

  function transform(bytes: Uint8Array, blockSize: number, encrypt: boolean) {
    if (!Number.isSafeInteger(blockSize) || blockSize <= 0) {
      throw new RangeError("block size must be a positive integer");
    }
    const result = encrypt
      ? library.symbols.bun_engine_nds_tinke_encrypt(pointer(bytes), bytes.byteLength, blockSize)
      : library.symbols.bun_engine_nds_tinke_decrypt(pointer(bytes), bytes.byteLength, blockSize);
    if (result !== 0) throw new Error(`Tinke transform failed with status ${result}`);
  }

  return {
    encrypt(bytes: Uint8Array, blockSize: number) {
      transform(bytes, blockSize, true);
    },
    decrypt(bytes: Uint8Array, blockSize: number) {
      transform(bytes, blockSize, false);
    },
    pacCount(bytes: Uint8Array): number {
      const count = library.symbols.bun_engine_nds_tinke_pac_count(pointer(bytes), bytes.byteLength);
      if (count < 0) throw new Error(`invalid Tinke PAC buffer (${count})`);
      return count;
    },
    close() {
      library.close();
    },
  };
}

import { expect, test } from "bun:test";
import { loadTinkeAot, tinkeAotLibrary } from "../src/nds/tinke";

test.skipIf(!(await Bun.file(tinkeAotLibrary).exists()))("Tinke .NET 10 NativeAOT round-trips through Bun FFI", () => {
  const tinke = loadTinkeAot();
  try {
    const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);
    const original = bytes.slice();
    tinke.encrypt(bytes, 16);
    expect(bytes).not.toEqual(original);
    tinke.decrypt(bytes, 16);
    expect(bytes).toEqual(original);

    const pac = new Uint8Array(24);
    new DataView(pac.buffer).setUint32(0, 2, true);
    expect(tinke.pacCount(pac)).toBe(2);
  } finally {
    tinke.close();
  }
});

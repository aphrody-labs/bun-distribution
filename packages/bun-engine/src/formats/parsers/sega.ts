// Sega Mega Drive / Genesis cartridges (raw .md/.gen/.bin and interleaved .smd dumps).
import { BinaryView, hex, hex32 } from "../stream.js";
import { parsed, type ParseContext, type Section } from "../types.js";

/** Interleaved SMD dump: 512-byte header, then 16 KiB blocks storing odd bytes before even ones. */
export function isInterleavedSmd(head: Uint8Array, size: number): boolean {
  return size % 0x4000 === 0x200 && head[8] === 0xaa && head[9] === 0xbb;
}

export function deinterleaveSmdBlock(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(block.byteLength);
  const half = block.byteLength >> 1;
  for (let index = 0; index < half; index++) {
    out[index * 2] = block[half + index]!;
    out[index * 2 + 1] = block[index]!;
  }
  return out;
}

export async function parseGenesis({ source, head }: ParseContext) {
  const interleaved = isInterleavedSmd(head, source.size);
  const view = new BinaryView(interleaved ? deinterleaveSmdBlock(head.subarray(0x200, 0x4200)) : head, "be");
  let checksum: number | undefined;
  if (!interleaved) {
    let sum = 0;
    let carry: number | undefined;
    for await (const { bytes } of source.chunks(0x200)) {
      let index = 0;
      if (carry !== undefined && bytes.byteLength) {
        sum = (sum + ((carry << 8) | bytes[0]!)) & 0xffff;
        index = 1;
        carry = undefined;
      }
      for (; index + 1 < bytes.byteLength; index += 2)
        sum = (sum + ((bytes[index]! << 8) | bytes[index + 1]!)) & 0xffff;
      if (index < bytes.byteLength) carry = bytes[index];
    }
    checksum = sum;
  }
  const entry = view.u32(4);
  const romEnd = view.u32(0x1a4);
  const sections: Section[] = [
    { name: "vectors", offset: 0, size: 0x100, address: 0, kind: "header" },
    {
      name: "header",
      offset: 0x100,
      size: 0x100,
      address: 0x100,
      kind: "header",
    },
  ];
  if (!interleaved)
    sections.push({
      name: "rom",
      offset: 0,
      size: source.size,
      address: 0,
      arch: "m68k",
      kind: "code",
    });
  return parsed({
    header: {
      system: view.ascii(0x100, 16),
      copyright: view.ascii(0x110, 16),
      domesticTitle: view.ascii(0x120, 48).replace(/\s+/g, " "),
      overseasTitle: view.ascii(0x150, 48).replace(/\s+/g, " "),
      serial: view.ascii(0x180, 14),
      checksum: hex(view.u16(0x18e), 4),
      checksumValid: checksum === undefined ? undefined : checksum === view.u16(0x18e),
      devices: view.ascii(0x190, 16),
      romRange: [hex32(view.u32(0x1a0)), hex32(romEnd)],
      sram: view.equals(0x1b0, "RA"),
      region: view.ascii(0x1f0, 3),
      initialStack: hex32(view.u32(0)),
      entry: hex32(entry),
      interleaved,
    },
    sections,
    arch: "m68k",
    entry,
  });
}

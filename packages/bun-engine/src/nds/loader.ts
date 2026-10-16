const ARM7_BIOS_BASE = 0x00000000;
const ARM9_BIOS_BASE = 0xffff0000;

export interface NintendoFirmwareSummary {
  directory: string;
  arm7: FirmwareImageSummary;
  arm9: FirmwareImageSummary;
  firmware: FirmwareImageSummary;
  gba: FirmwareImageSummary;
}

export interface FirmwareImageSummary {
  file: string;
  bytes: number;
  sha256: string;
  firstWord: string;
}

interface FirmwareImage extends FirmwareImageSummary {
  data: Uint8Array;
}

async function loadImage(path: string, expectedBytes: number): Promise<FirmwareImage> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`required Nintendo dump not found: ${path}`);
  if (file.size !== expectedBytes) {
    throw new Error(`${path} must contain exactly ${expectedBytes} bytes, got ${file.size}`);
  }
  const data = await file.bytes();
  if (data.every(byte => byte === 0) || data.every(byte => byte === 0xff)) {
    throw new Error(`${path} contains no usable firmware data`);
  }
  const sha256 = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  const firstWord = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
  return {
    file: path,
    bytes: data.byteLength,
    sha256,
    firstWord: `0x${firstWord.toString(16).padStart(8, "0")}`,
    data,
  };
}

export class NintendoDsFirmware {
  readonly arm7: FirmwareImage;
  readonly arm9: FirmwareImage;
  readonly firmware: FirmwareImage;
  readonly gba: FirmwareImage;
  readonly directory: string;

  private constructor(directory: string, images: FirmwareImage[]) {
    this.directory = directory;
    [this.arm7, this.arm9, this.firmware, this.gba] = images as [
      FirmwareImage,
      FirmwareImage,
      FirmwareImage,
      FirmwareImage,
    ];
  }

  static async load(directory: string): Promise<NintendoDsFirmware> {
    const root = directory.replace(/[\\/]$/, "");
    const images = await Promise.all([
      loadImage(`${root}/biosnds7.rom`, 16 * 1024),
      loadImage(`${root}/biosnds9.rom`, 4 * 1024),
      loadImage(`${root}/firmware.bin`, 256 * 1024),
      loadImage(`${root}/BIOSGBA.ROM`, 16 * 1024),
    ]);
    return new NintendoDsFirmware(root, images);
  }

  readArm7(address: number, length: number): Uint8Array {
    return this.readMapped(this.arm7.data, ARM7_BIOS_BASE, address, length, "ARM7 BIOS");
  }

  readArm9(address: number, length: number): Uint8Array {
    return this.readMapped(this.arm9.data, ARM9_BIOS_BASE, address, length, "ARM9 BIOS");
  }

  readFirmwareSpi(offset: number, length: number): Uint8Array {
    return this.readMapped(this.firmware.data, 0, offset, length, "firmware SPI");
  }

  readGbaBios(address: number, length: number): Uint8Array {
    return this.readMapped(this.gba.data, 0, address, length, "GBA BIOS");
  }

  summary(): NintendoFirmwareSummary {
    const publicImage = ({ data: _data, ...image }: FirmwareImage): FirmwareImageSummary => image;
    return {
      directory: this.directory,
      arm7: publicImage(this.arm7),
      arm9: publicImage(this.arm9),
      firmware: publicImage(this.firmware),
      gba: publicImage(this.gba),
    };
  }

  private readMapped(data: Uint8Array, base: number, address: number, length: number, label: string): Uint8Array {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) || length < 0) {
      throw new RangeError(`${label} address and length must be non-negative integers`);
    }
    const offset = address - base;
    if (offset < 0 || offset + length > data.byteLength) {
      throw new RangeError(`${label} read is outside its mapped range`);
    }
    return data.slice(offset, offset + length);
  }
}

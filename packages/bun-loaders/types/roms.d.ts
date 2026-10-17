// Typed console binary imports provided by src/rom.ts. Register the runtime loader
// with `bun --preload @aphrody/bun-loaders/register` or Bun.plugin(loadersPlugin).
// Under Bun.build the same specifiers resolve to the JSON summary (`ImageSummary`).

declare module "*.nes" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").NesHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").NesHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").NesHeader
  >;
}

declare module "*.fds" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").FdsHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").FdsHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").FdsHeader
  >;
}

declare module "*.gb" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GameBoyHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GameBoyHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GameBoyHeader
  >;
}

declare module "*.gbc" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GameBoyHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GameBoyHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GameBoyHeader
  >;
}

declare module "*.gba" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GbaHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GbaHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GbaHeader
  >;
}

declare module "*.agb" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GbaHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GbaHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GbaHeader
  >;
}

declare module "*.mb" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GbaHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GbaHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GbaHeader
  >;
}

declare module "*.nds" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").NdsHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").NdsHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").NdsHeader
  >;
}

declare module "*.dsi" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").NdsHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").NdsHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").NdsHeader
  >;
}

declare module "*.srl" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").NdsHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").NdsHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").NdsHeader
  >;
}

declare module "*.n64" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").N64Header
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").N64Header;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").N64Header
  >;
}

declare module "*.z64" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").N64Header
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").N64Header;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").N64Header
  >;
}

declare module "*.v64" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").N64Header
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").N64Header;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").N64Header
  >;
}

declare module "*.dol" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").DolHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").DolHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").DolHeader
  >;
}

declare module "*.elf" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").ElfHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").ElfHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").ElfHeader
  >;
}

declare module "*.axf" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").ElfHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").ElfHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").ElfHeader
  >;
}

declare module "*.gcm" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").DiscHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").DiscHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").DiscHeader
  >;
}

declare module "*.wbfs" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").WbfsHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").WbfsHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").WbfsHeader
  >;
}

declare module "*.rvz" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").WiaHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").WiaHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").WiaHeader
  >;
}

declare module "*.wia" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").WiaHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").WiaHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").WiaHeader
  >;
}

declare module "*.iso" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.bin" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.cue" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.chd" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.pbp" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.psx" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.3ds" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.cci" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.cxi" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.nsp" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.xci" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.nro" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.rom" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.bios" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.firmware" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<Record<string, unknown>>;
  export default image;
  export { image };
  export const header: Record<string, unknown>;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<Record<string, unknown>>;
}

declare module "*.md" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GenesisHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GenesisHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GenesisHeader
  >;
}

declare module "*.gen" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GenesisHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GenesisHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GenesisHeader
  >;
}

declare module "*.smd" {
  const image: import("../../bun-engine/src/formats/image").BinaryImage<
    import("../../bun-engine/src/formats/headers").GenesisHeader
  >;
  export default image;
  export { image };
  export const header: import("../../bun-engine/src/formats/headers").GenesisHeader;
  export const format: import("../../bun-engine/src/formats/types").FormatId;
  export const platform: string;
  export const sections: import("../../bun-engine/src/formats/types").Section[];
  export const entry: number | undefined;
  export const arch: import("../../bun-engine/src/formats/types").Arch | undefined;
  export const summary: import("../../bun-engine/src/formats/image").ImageSummary<
    import("../../bun-engine/src/formats/headers").GenesisHeader
  >;
}

export interface LinuxABI {
  abi: "gnu" | "musl";
  libc: "glibc" | "musl";
  interpreter: string;
  machine: number;
}

/** Read the loader selected by the artifact itself before staging it on a GNU host. */
export async function inspectLinuxABI(
  path: string,
  architecture: "x64" | "arm64",
  abi: "gnu" | "musl" = "gnu",
): Promise<LinuxABI> {
  const file = Bun.file(path);
  const header = await file.slice(0, 64).bytes();
  if (
    header.length !== 64 ||
    header[0] !== 127 ||
    header[1] !== 69 ||
    header[2] !== 76 ||
    header[3] !== 70 ||
    header[4] !== 2 ||
    header[5] !== 1
  )
    throw new Error("Linux artifacts must be 64-bit little-endian ELF executables");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const machine = view.getUint16(18, true);
  if (machine !== (architecture === "x64" ? 62 : 183))
    throw new Error("ELF machine differs from the selected architecture");
  const offset = Number(view.getBigUint64(32, true));
  const entrySize = view.getUint16(54, true);
  const count = view.getUint16(56, true);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 64 ||
    offset > 2 * 1024 * 1024 ||
    entrySize < 56 ||
    entrySize > 256 ||
    count < 1 ||
    count > 128 ||
    offset + entrySize * count > file.size
  )
    throw new Error("Invalid ELF program header table");
  const bytes = await file.slice(offset, offset + entrySize * count).bytes();
  const programs = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let interpreter: string | undefined;
  for (let index = 0; index < count; index++) {
    const at = index * entrySize;
    if (programs.getUint32(at, true) !== 3) continue;
    if (interpreter) throw new Error("ELF contains multiple interpreter declarations");
    const start = Number(programs.getBigUint64(at + 8, true));
    const length = Number(programs.getBigUint64(at + 32, true));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 2 ||
      length > 256 ||
      start + length > file.size
    )
      throw new Error("Invalid ELF interpreter range");
    const value = await file.slice(start, start + length).bytes();
    if (value[value.length - 1] !== 0 || value.subarray(0, -1).includes(0))
      throw new Error("Invalid ELF interpreter name");
    interpreter = new TextDecoder().decode(value.subarray(0, -1));
  }
  const expected = abi === "musl"
    ? [architecture === "x64" ? "/lib/ld-musl-x86_64.so.1" : "/lib/ld-musl-aarch64.so.1"]
    : architecture === "x64"
      ? ["/lib64/ld-linux-x86-64.so.2", "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"]
      : ["/lib/ld-linux-aarch64.so.1", "/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1"];
  if (!interpreter || !expected.includes(interpreter))
    throw new Error(
      `The selected ${abi} target requires its own ELF loader; incompatible or static artifacts need separate qualification`,
    );
  return { abi, libc: abi === "gnu" ? "glibc" : "musl", interpreter, machine };
}

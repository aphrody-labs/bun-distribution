import { sourceIntegrity } from "./source-integrity.ts";

type RuntimeReceipt = {
  repository: string;
  target: string;
  abi: string;
  revision: string;
  version: string;
  sha256: string;
  bytes: number;
  qualification: { passed: boolean; gates: string[] };
};

export async function verifyPayload(root = Bun.env.BUN_OS_ROOT ?? "/opt/bun-os") {
  const receipt = (await Bun.file(`${root}/distribution.json`).json()) as {
    name: string;
    runtime: RuntimeReceipt;
  };
  const runtime = receipt.runtime;
  if (
    runtime?.repository !== "aphrody-labs/bun" ||
    runtime.abi !== "gnu" ||
    !/^[0-9a-f]{40}$/.test(runtime.revision) ||
    !/^[0-9a-f]{64}$/.test(runtime.sha256) ||
    !runtime.qualification?.passed ||
    !runtime.qualification.gates.includes("native-runtime")
  ) {
    throw new Error("The payload requires a qualified Aphrody Bun runtime receipt");
  }
  const target = process.arch === "x64" ? "linux-x64" : process.arch === "arm64" ? "linux-arm64" : "";
  if (process.platform !== "linux" || runtime.target !== target) {
    throw new Error(`Runtime target ${runtime.target} does not match ${process.platform}/${process.arch}`);
  }
  const child = Bun.spawn(["getconf", "GNU_LIBC_VERSION"], { stdout: "pipe", stderr: "pipe" });
  const libc = (await new Response(child.stdout).text()).trim();
  if ((await child.exited) !== 0 || !/^glibc \d+\.\d+$/.test(libc))
    throw new Error("The image does not provide GNU glibc");
  const binary = Bun.file(`${root}/runtime/bun`);
  const header = new Uint8Array(await binary.slice(0, 4).arrayBuffer());
  if (header.join(",") !== "127,69,76,70" || binary.size !== runtime.bytes) {
    throw new Error("Runtime ELF header or byte count differs from the receipt");
  }
  const actualHash = new Bun.CryptoHasher("sha256").update(await binary.arrayBuffer()).digest("hex");
  if (actualHash !== runtime.sha256 || Bun.revision !== runtime.revision || Bun.version !== runtime.version) {
    throw new Error("Executing Bun does not match the exact staged runtime");
  }
  for (const path of [
    "sources/bun/package.json",
    "sources/material/package.json",
    "sources/cosmic-epoch/README.md",
    "sources/libcosmic/Cargo.toml",
  ]) {
    if (!(await Bun.file(`${root}/${path}`).exists())) throw new Error(`Missing distribution source ${path}`);
  }
  const sourceReceipt = await Bun.file(`${root}/sources.receipt.json`).json();
  if (sourceReceipt.complete !== true || sourceReceipt.kind !== "bun-os-sources")
    throw new Error("Incomplete source receipt");
  if (
    !sourceReceipt.repositories.some(
      (source: { id: string; revision: string }) => source.id === "bun" && source.revision === runtime.revision,
    )
  )
    throw new Error("Source receipt and runtime revision differ");
  const contents = await sourceIntegrity(`${root}/sources`);
  if (contents.treeSHA256 !== sourceReceipt.treeSHA256)
    throw new Error("Image sources differ from their exported content checksum");
  return receipt;
}

if (import.meta.main) {
  const receipt = await verifyPayload();
  console.log(JSON.stringify({ name: receipt.name, revision: receipt.runtime.revision, runtime: "verified" }));
}

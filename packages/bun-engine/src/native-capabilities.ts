export interface NativeProbe {
  runtime: { version: string; revision: string; platform: string; arch: string };
  network: {
    host: string;
    dns: Awaited<ReturnType<typeof Bun.dns.lookup>>;
    dnsCache: ReturnType<typeof Bun.dns.getCacheStats>;
    tcp443: { connected: boolean; latencyMs: number; error?: string };
  };
  media: {
    image: { available: boolean; backend?: string };
    video: { available: boolean; decoder?: string; backend?: string };
  };
  packages: { winget: { available: boolean; executable: string | null } };
  os: Record<string, unknown>;
}

async function probeTcp(host: string): Promise<NativeProbe["network"]["tcp443"]> {
  const started = Bun.nanoseconds();
  try {
    const socket = await Bun.connect({
      hostname: host,
      port: 443,
      tls: true,
      socket: {
        data() {},
        open(socket) {
          socket.end();
        },
        error() {},
      },
    });
    socket.end();
    return { connected: true, latencyMs: (Bun.nanoseconds() - started) / 1_000_000 };
  } catch (error) {
    return {
      connected: false,
      latencyMs: (Bun.nanoseconds() - started) / 1_000_000,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeOs(): Promise<Record<string, unknown>> {
  if (process.platform === "win32") {
    const windows = (await import("bun:windows")).default;
    const info = windows.systemInfo();
    const toolchain = windows.toolchain();
    return {
      api: "bun:windows",
      supported: windows.isSupported,
      elevated: windows.isElevated(),
      version: windows.version(),
      system: {
        processors: info.processors,
        totalMemory: info.totalMemory,
        freeMemory: info.freeMemory,
        memoryLoad: info.memoryLoad,
        uptime: info.uptime,
        theme: info.theme,
      },
      drives: windows.storage.drives(),
      toolchain: {
        error: toolchain.error,
        msvc: toolchain.msvc?.version ?? null,
        sdk: toolchain.sdk?.version ?? null,
        llvm: toolchain.llvm?.version ?? null,
      },
    };
  }
  if (process.platform === "linux") {
    const moduleName = "bun:linux";
    const linux = (
      (await import(moduleName)) as {
        default: {
          isSupported: boolean;
          ioUring: { probe(): { supported: boolean; ops: number[] } };
          capabilities: { get(): { effective: bigint; permitted: bigint; inheritable: bigint } };
        };
      }
    ).default;
    const capabilities = linux.capabilities.get();
    return {
      api: "bun:linux",
      supported: linux.isSupported,
      ioUring: linux.ioUring.probe(),
      capabilities: {
        effective: capabilities.effective.toString(),
        permitted: capabilities.permitted.toString(),
        inheritable: capabilities.inheritable.toString(),
      },
    };
  }
  return { api: process.platform, supported: false };
}

export async function probeNativeCapabilities(host = "www.retrostic.com"): Promise<NativeProbe> {
  Bun.dns.prefetch(host, 443);
  const [dns, tcp443, os] = await Promise.all([
    Bun.dns.lookup(host, { family: 0, socketType: "tcp", port: 443 }),
    probeTcp(host),
    probeOs(),
  ]);
  const winget = Bun.which("winget");
  return {
    runtime: { version: Bun.version, revision: Bun.revision, platform: process.platform, arch: process.arch },
    network: { host, dns, dnsCache: Bun.dns.getCacheStats(), tcp443 },
    media: {
      image: {
        available: typeof Bun.Image === "function",
        backend: typeof Bun.Image === "function" ? Bun.Image.backend : undefined,
      },
      video: {
        available: typeof Bun.Video === "function" && Bun.Video.available,
        decoder: typeof Bun.Video === "function" ? Bun.Video.decoder : undefined,
        backend: typeof Bun.Video === "function" ? Bun.Video.backend : undefined,
      },
    },
    packages: { winget: { available: winget !== null, executable: winget } },
    os,
  };
}

export async function probeMedia(path: string): Promise<Record<string, unknown>> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`media not found: ${path}`);
  try {
    const image = new Bun.Image(file);
    return { kind: "image", path, metadata: await image.metadata(), backend: Bun.Image.backend };
  } catch (imageError) {
    if (!Bun.Video.available) throw imageError;
    const video = new Bun.Video(path);
    return {
      kind: "video",
      path,
      metadata: await video.metadata(),
      decoder: Bun.Video.decoder,
      backend: Bun.Video.backend,
    };
  }
}

import { join } from "node:path";
import { planChimeraOs } from "./chimeraos/index.ts";
import cachyosIntegration from "./cachyos/integration.json";
import omarchyIntegration from "./omarchy/integration.json";

export type Composition = "server" | "desktop" | "gaming";
export const compositions: Composition[] = ["server", "desktop", "gaming"];
export interface ArchDistributionOptions {
  target: string;
  composition: Composition;
  snapshot?: string;
}

/** Source catalogs are complete inputs, not a request to install conflicting sessions. */
export async function planArchDistribution(options: ArchDistributionOptions) {
  const profile = await Bun.file(join(import.meta.dir, "../profile.json")).json();
  const [cachyos, chimeraos, omarchy, forks] = await Promise.all([
    Bun.file(join(import.meta.dir, "cachyos/integration.json")).json(),
    Bun.file(join(import.meta.dir, "chimeraos/sources.json")).json(),
    Bun.file(join(import.meta.dir, "omarchy/integration.json")).json(),
    Bun.file(join(import.meta.dir, "sources.json")).json(),
  ]);
  const selected = profile.compositions[options.composition];
  if (!selected || !compositions.includes(options.composition)) throw new Error("Unknown Arch composition");
  const packages: string[] = [
    ...(selected.extends ? profile.compositions[selected.extends].packages : []),
    ...selected.packages,
  ];
  const blockers = [
    "A signed, exact pacman binary closure must be resolved for this composition and archive date.",
    "Kernel, SDK/library builds, boot and GPU/input/audio/update qualification need independent artifact receipts.",
  ];
  if (options.target !== "linux-x64")
    blockers.push("The current Arch bootstrap and package closure target Linux x86_64/glibc only.");
  if (!options.snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(options.snapshot))
    blockers.push("Select an absolute Arch archive date (YYYY-MM-DD).");
  return {
    schemaVersion: 1,
    kind: "bun-os-arch-distribution-plan",
    target: options.target,
    composition: options.composition,
    packageManager: "pacman/libalpm",
    profile,
    requestedPackages: [...new Set(packages)],
    snapshot: options.snapshot ?? null,
    catalogs: {
      cachyos: { path: "factory/arch/cachyos", recipes: "catalog.json", integration: cachyos },
      chimeraos: {
        path: "factory/arch/chimeraos",
        sources: chimeraos.sources,
        plan: planChimeraOs({ target: options.target, archiveDate: options.snapshot?.replaceAll("-", "/") }),
      },
      omarchy: { path: "factory/arch/omarchy", recipes: "pkgbuilds.json", rust: "rust.json", integration: omarchy },
    },
    sources: forks,
    graph: [
      { id: "arch:sources", owner: "factory/arch/sources.json", dependsOn: [] },
      { id: "arch:resolve", owner: "factory/arch/resolve.ts", dependsOn: ["arch:sources"] },
      { id: "arch:rootfs", owner: "factory/arch/pacman.ts", dependsOn: ["arch:resolve"] },
      { id: "arch:payload", owner: "src/distribution.ts stageRuntime", dependsOn: ["arch:sources"] },
      { id: "arch:image", owner: "src/distribution.ts buildImage", dependsOn: ["arch:rootfs", "arch:payload"] },
      {
        id: "arch:qualify",
        owner: "factory/native-targets.ts + existing product receipt owners",
        dependsOn: ["arch:image"],
      },
    ],
    servicesEnabled: [],
    executable: false,
    qualified: false,
    blockers,
  };
}

export interface PacmanRepository {
  name: string;
  family: "cachyos" | "archlinux" | "omarchy";
  /** Mirror architecture directory, for example x86_64 or x86_64_v3. */
  arch: string;
  /** Minimum x86-64 microarchitecture level required by the binaries. */
  isa: "x86-64" | "x86-64-v3";
  /** pacman Server templates with $repo and $arch. */
  servers: string[];
  signingKey?: string;
}

const archOfficial: PacmanRepository[] = ["core", "extra", "multilib"].map((name) => ({
  name,
  family: "archlinux",
  arch: "x86_64",
  isa: "x86-64",
  servers: ["https://geo.mirror.pkgbuild.com/$repo/os/$arch", "https://mirrors.kernel.org/archlinux/$repo/os/$arch"],
}));

/** Binary repositories in pacman.conf order: CachyOS optimized, CachyOS generic, Arch, Omarchy. */
export function pacmanRepositories(): PacmanRepository[] {
  return [
    ...(cachyosIntegration.repositories as PacmanRepository[]),
    ...archOfficial,
    ...(omarchyIntegration.repositories as PacmanRepository[]),
  ];
}

export function repositoryUrls(repository: PacmanRepository, file: string): string[] {
  return repository.servers.map(
    (server) => `${server.replaceAll("$repo", repository.name).replaceAll("$arch", repository.arch)}/${file}`,
  );
}

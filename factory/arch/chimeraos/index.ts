// SPDX-License-Identifier: MIT
import catalog from "./catalog.json";
import sources from "./sources.json";

export const chimeraOsCatalog = catalog;
export const chimeraOsSources = sources;

export interface ChimeraOsPlanOptions {
  target: string;
  /** Root-owned Arch archive snapshot, never the upstream relative date. */
  archiveDate?: string;
  /** Verified immutable image digest; source parity still needs a receipt. */
  kernelOciDigest?: string;
}

/** Declarative input to the one root factory; this never installs or deploys. */
export function planChimeraOs(options: ChimeraOsPlanOptions) {
  const blockers: string[] = [];
  if (options.target !== "linux-x64") blockers.push("The pinned image manifest supports x86_64 Linux only.");
  if (!options.archiveDate || !/^\d{4}\/\d{2}\/\d{2}$/.test(options.archiveDate)) {
    blockers.push("A root-owned Arch archive date (YYYY/MM/DD) is required; yesterday is not a pin.");
  }
  if (!options.kernelOciDigest || !/^sha256:[0-9a-f]{64}$/.test(options.kernelOciDigest)) {
    blockers.push("The upstream OGC kernel OCI tag is mutable; a verified immutable digest is required.");
  }
  blockers.push(
    "Resolve all binary packages and their transitive closure to versions, hashes, signatures and license notices in the root pacman lock.",
    "Pin every AUR recipe and downloaded source; upstream local driver recipes contain floating Git sources and SKIP checksums.",
    "Provision the selected external source histories through the root Infra owner and verify kernel artifact/source parity.",
    "Qualify image, boot, input/GPU/audio and data-preserving update receipts through the existing root factory.",
  );
  return {
    schemaVersion: 1 as const,
    id: "chimeraos",
    target: options.target,
    packageManager: "pacman" as const,
    executable: false,
    qualified: false,
    ready: false,
    archiveDate: options.archiveDate ?? null,
    kernel: { ...catalog.kernel, ociDigest: options.kernelOciDigest ?? null },
    packages: catalog.packages,
    aurPackages: catalog.aurPackages,
    localPackages: catalog.localPackages,
    buildPackages: catalog.buildPackages,
    buildAurPackages: catalog.buildAurPackages,
    bootstrapPackages: catalog.bootstrapPackages,
    installerPackages: catalog.installerPackages,
    installerBuildPackages: catalog.installerBuildPackages,
    sources: sources.sources,
    upstreamServices: catalog.upstreamServices,
    upstreamUserServices: catalog.upstreamUserServices,
    enabledServices: catalog.enabledServices,
    enabledUserServices: catalog.enabledUserServices,
    hooks: {
      owner: "root-factory",
      source: "root source lock/export",
      packages: "root pacman resolver and signed package lock",
      build: "root target/profile graph and serialized build/cache owner",
      image: "root image assembler",
      release: "root qualification receipts and release publication",
      upstreamBuildScriptExecution: false,
      bootAutoUpdate: false,
      installerExecution: false,
    },
    persistence: {
      immutableRoot: "read-only btrfs deployment subvolume",
      persistentSubvolumes: ["/home", "/var"],
      etc: { filesystem: "overlayfs", lower: "image /etc", upper: "/frzr_root/etc", work: "/frzr_root/.etc" },
      boot: "UEFI/systemd-boot; staged kernel/initramfs/microcode must match the selected deployment",
      preserve: [
        "user files",
        "application data",
        "credentials",
        "provider sessions",
        "databases",
        "models",
        "datasets",
      ],
      forbiddenAutomaticActions: [
        "disk formatting",
        "data migration",
        "deployment deletion",
        "boot switching",
        "frzr-unlock",
        "boot-time downloads",
      ],
      requiredGates: [
        "explicit deployment authority",
        "signature and source identity",
        "disk/inode budget",
        "exclusive lock",
        "complete image staging",
        "boot health",
        "persistence compatibility",
      ],
    },
    blockers,
  };
}

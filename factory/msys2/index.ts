import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  currentRuntimeFacts,
  isObject,
  loadConfig,
  repositoryRoot,
  runtimeFromFacts,
} from "../../packages/bun-workspace/src/index.ts";
import { inspectMsys2Sources, type Msys2SourceOptions } from "../arch/msys2.ts";
import {
  desktopABIs,
  desktopSourceCapabilities,
  msys2DesktopConfig,
  type Msys2DesktopABI,
} from "./config.ts";
import {
  captureMsys2DesktopLock,
  inspectMsys2DesktopLock,
  type Msys2Inspection,
} from "./lock.ts";

export {
  desktopABIs,
  desktopSourceCapabilities,
  msys2DesktopConfig,
  captureMsys2DesktopLock,
  inspectMsys2DesktopLock,
};
export type { Msys2DesktopABI, Msys2Inspection };
export type { Msys2DesktopPackageLock } from "./lock.ts";

export interface Msys2DesktopOptions extends Msys2SourceOptions {
  root?: string;
  abi?: Msys2DesktopABI;
  /** Root can supply the one shared inspection while physical sources are being relocated. */
  inspection?: Msys2Inspection;
  packageLock?: unknown;
}

interface DesktopDiagnostic {
  id: string;
  state: "pass" | "blocked" | "input-required";
  detail: string;
}

function inside(root: string, path: string) {
  const local = relative(resolve(root), resolve(path));
  return (
    local === "" ||
    (!isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`))
  );
}

function legacyTransitions(inspection: Msys2Inspection) {
  const manifest = inspection.capabilities.cym.manifest;
  const sources: unknown[] = Array.isArray(manifest.sources)
    ? manifest.sources
    : [];
  return sources.flatMap((source) => {
    if (
      !isObject(source) ||
      typeof source.name !== "string" ||
      typeof source.path !== "string"
    )
      return [];
    const registered = inspection.registeredSources.find(
      (item) => item.id === source.name || item.id === `cachyos-${source.name}`,
    );
    const view = inspection.cachyos.find((item) => item.name === source.name);
    const repository = inspection.repositories.find(
      (repo) => repo.path === registered?.path || repo.path === view?.path,
    );
    return [
      {
        name: source.name,
        declaredSourcePath: source.path,
        canonicalView: registered?.path ?? view?.path ?? null,
        resolvedCheckout:
          repository?.resolvedPath ?? view?.resolvedPath ?? null,
        revision: repository?.head ?? null,
        role: repository?.role ?? null,
        clean: repository?.cleanTracked ?? null,
        action:
          "Use the registered vendor owner; do not copy sources or create another junction during planning",
        manifestRewriteApplied: manifest.schema === 2,
      },
    ];
  });
}

/** One read-only Desktop model over the existing inspector and cym source/manifest owners. */
export async function planMsys2Desktop(options: Msys2DesktopOptions = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const sourceRoot = resolve(
    root,
    options.sourceRoot ??
      Bun.env.APHRODY_MSYS2_SOURCE_ROOT ??
      msys2DesktopConfig.sourceRoot,
  );
  const abi = options.abi ?? msys2DesktopConfig.defaultABI;
  if (!(abi in desktopABIs)) throw new Error("Unknown MSYS2 Desktop ABI.");
  const inspection =
    options.inspection ??
    (await inspectMsys2Sources({ ...options, sourceRoot }));
  if (resolve(inspection.sourceRoot).toLowerCase() !== sourceRoot.toLowerCase())
    throw new Error(
      "Inspection sourceRoot differs from selected Desktop sourceRoot.",
    );
  const target = desktopABIs[abi];
  const config = await loadConfig(root);
  const expectedRuntime = target.productTarget
    ? (config.runtimeTargets?.[target.productTarget] ?? config.runtime)
    : config.runtime;
  const runtime = runtimeFromFacts(expectedRuntime, currentRuntimeFacts());
  const vendorRoot = resolve(root, msys2DesktopConfig.sourceRoot);
  const sourceCapabilities = desktopSourceCapabilities.map((capability) => {
    const source = inspection.registeredSources.find(
      (source) => source.id === capability.id,
    );
    const repo =
      source &&
      inspection.repositories.find((repo) => repo.path === source.path);
    return {
      ...capability,
      path: source?.path ?? null,
      revision: repo?.head ?? null,
      available: Boolean(repo?.git && repo.head && !repo.error),
      dirty: repo?.cleanTracked === false,
      pinMatches:
        repo?.rootMatches?.some(
          (match) => match.pinMatches && !match.roleConflict,
        ) ?? false,
    };
  });
  const packages = inspection.pacman.packages;
  const requiredHostPackages = ["pacman", "msys2-runtime", "cachyos-msys2"];
  const missingHostPackages = requiredHostPackages.filter(
    (name) => !packages.some((pkg) => pkg.name === name),
  );
  const nativePackages = target.packagePrefix
    ? packages.filter((pkg) => pkg.name.startsWith(target.packagePrefix))
    : [];
  const metadataLock =
    inspection.pacman.packagesCode === 0
      ? captureMsys2DesktopLock(inspection, abi)
      : null;
  const brokenViews = inspection.cachyos.filter(
    (entry) => entry.type === "link" && !entry.resolvedPath,
  );
  const unmergedSources = inspection.repositories
    .filter((repo) => repo.unmerged)
    .map((repo) => repo.path);
  const legacy = legacyTransitions(inspection);
  return {
    schemaVersion: 1,
    kind: "bun-os-msys2-desktop-plan",
    root,
    sourceRoot,
    abi,
    target,
    sourceGraphOwner: join(vendorRoot, "sources.json"),
    sourceCapabilities,
    runtime,
    host: inspection.host,
    installed: {
      requiredHostPackages,
      missingHostPackages,
      nativePackages,
      packageCount: packages.length,
      metadataLock,
    },
    lockComparison:
      options.packageLock !== undefined && metadataLock
        ? inspectMsys2DesktopLock(options.packageLock, metadataLock)
        : null,
    legacyAdapter: {
      owner: inspection.capabilities.cym.source,
      implementation: inspection.capabilities.cym.implementation,
      transitions: legacy,
      commandsExecuted: [],
      sourcePlanReadOnlyContract:
        inspection.capabilities.cym.manifest.schema === 2,
      installedBinarySourceParity:
        inspection.capabilities.cym.installedBinarySourceParity,
      reason:
        inspection.capabilities.cym.manifest.schema === 2
          ? "Schema 2 cym source delegates pure Desktop inspection to this owner; installed executable parity needs a separate receipt"
          : "Inherited cym pipeline plan/validate call linkSources; do not execute them as read-only probes",
    },
    issues: {
      vendorRegistrationPending: !inside(vendorRoot, sourceRoot),
      brokenViews: brokenViews.map((entry) => entry.path),
      unmergedSources,
      sourceDiagnostics: inspection.repositories.flatMap((repo) =>
        (repo.diagnostics ?? []).map((detail) => ({ path: repo.path, detail })),
      ),
    },
    boundaries: {
      windowsDesktop: true,
      archLinuxRootfs: false,
      linuxCompositorOnWindows: false,
      crossCppAbiLinking: false,
      implicitRustGnuTarget: false,
      protectedHomeImport: false,
    },
    requiredReceipts: [
      "Native Bun executable/source pin and hash",
      "Selected MSVC or MinGW toolchain/SDK/CRT and target receipt",
      "Signed native pacman package/archive closure and payload hashes",
      "Versioned DLL/C-ABI boundary without shared CRT-owned objects",
      "wgpu/winit/Bevy or selected canonical desktop runtime artifact",
      "Windows display/input/audio/process-lifetime qualification",
      "Bun OS packaging, license and activation receipt",
    ],
    executable: false,
    qualified: false,
    buildsExecuted: false,
    inspection,
  };
}

/** Concrete native metadata gates; no shell/installer/build or legacy cym command is executed. */
export async function doctorMsys2Desktop(options: Msys2DesktopOptions = {}) {
  const plan = await planMsys2Desktop(options);
  const diagnostics: DesktopDiagnostic[] = [
    {
      id: "native-host",
      state: plan.host.nativeMsys2Detected ? "pass" : "blocked",
      detail:
        "MSYS2 runtime/package metadata must come from the explicitly selected native Windows installation",
    },
    {
      id: "host-packages",
      state: plan.installed.missingHostPackages.length ? "blocked" : "pass",
      detail:
        plan.installed.missingHostPackages.join(", ") ||
        "Native pacman/runtime/cym package metadata present",
    },
    {
      id: "vendor-owner",
      state: plan.issues.vendorRegistrationPending ? "input-required" : "pass",
      detail:
        "Physical source ownership belongs to the selected flat vendor registry, not installed runtime/home stores",
    },
    {
      id: "source-views",
      state: plan.issues.brokenViews.length ? "blocked" : "pass",
      detail:
        plan.issues.brokenViews.join(", ") ||
        "No dangling Cachy source view observed",
    },
    {
      id: "source-conflicts",
      state: plan.issues.unmergedSources.length ? "blocked" : "pass",
      detail:
        plan.issues.unmergedSources.join(", ") ||
        "No unmerged source index observed",
    },
    {
      id: "desktop-sources",
      state: plan.sourceCapabilities.every((source) => source.available)
        ? "pass"
        : "blocked",
      detail:
        plan.sourceCapabilities
          .filter((source) => !source.available)
          .map((source) => source.id)
          .join(", ") || "Canonical Desktop source owners available",
    },
    {
      id: "source-diagnostics",
      state: plan.issues.sourceDiagnostics.length ? "blocked" : "pass",
      detail:
        plan.issues.sourceDiagnostics
          .map((item) => `${item.path}: ${item.detail}`)
          .join("; ") || "No Git object-store diagnostics observed",
    },
    {
      id: "bun-runtime-pin",
      state:
        plan.runtime.recognizedFork &&
        plan.runtime.versionMatches &&
        plan.runtime.revisionMatches
          ? "pass"
          : "input-required",
      detail:
        "Development runtime presence is separate from a release-pinned executable receipt",
    },
    {
      id: "target-toolchain",
      state: "input-required",
      detail: `${plan.abi}: ${plan.target.cRuntime}/${plan.target.cppRuntime}; native toolchain, SDK, CRT and C-ABI artifact receipts remain required`,
    },
  ];
  if (plan.lockComparison)
    diagnostics.push({
      id: "metadata-lock",
      state:
        plan.lockComparison.valid &&
        !plan.lockComparison.packageDrift &&
        !plan.lockComparison.sourceDrift
          ? "pass"
          : "blocked",
      detail: plan.lockComparison.reason,
    });
  return {
    schemaVersion: 1,
    kind: "bun-os-msys2-desktop-doctor",
    abi: plan.abi,
    sourceRoot: plan.sourceRoot,
    diagnostics,
    metadataReady: diagnostics
      .filter(
        (item) =>
          item.id !== "target-toolchain" && item.id !== "bun-runtime-pin",
      )
      .every((item) => item.state === "pass"),
    installedPackageCount: plan.installed.packageCount,
    sourceCount: plan.inspection.repositories.length,
    packageLock: plan.installed.metadataLock,
    legacyAdapter: plan.legacyAdapter,
    executable: false,
    qualified: false,
    buildsExecuted: false,
  };
}

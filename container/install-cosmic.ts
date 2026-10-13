import { $ } from "bun";

type CosmicPackages = {
  architecture: string;
  repository: string;
  packages: { name: string; version: string; path: string; sha256: string }[];
};

const root = Bun.env.BUN_OS_ROOT ?? "/opt/bun-os";
const lock = (await Bun.file(`${root}/container/cosmic-packages.json`).json()) as CosmicPackages;
const profile = Bun.argv[2] ?? "full";
if (profile !== "perf" && profile !== "full") throw new Error("Unknown COSMIC profile");
const corePackages = new Set([
  "cosmic-session",
  "cosmic-comp",
  "cosmic-panel",
  "cosmic-applets",
  "cosmic-app-library",
  "cosmic-launcher",
  "cosmic-settings",
  "cosmic-settings-daemon",
  "cosmic-workspaces",
  "cosmic-notifications",
  "cosmic-bg",
  "cosmic-osd",
  "cosmic-idle",
  "cosmic-randr",
  "cosmic-files",
  "cosmic-greeter",
  "cosmic-greeter-daemon",
  "cosmic-osk",
  "cosmic-screenshot",
  "cosmic-term",
  "cosmic-icons",
  "pop-launcher",
  "xdg-desktop-portal-cosmic",
]);
const packages = profile === "full" ? lock.packages : lock.packages.filter(entry => corePackages.has(entry.name));
if (profile === "perf" && packages.length !== corePackages.size) throw new Error("Missing pinned core COSMIC package");
if (process.arch !== "x64" || lock.architecture !== "amd64") {
  throw new Error("The COSMIC package lock currently provides Linux x64 only");
}
const directory = "/tmp/bun-os-cosmic-debs";
await $`mkdir -p ${directory}`;
const files: string[] = [];
for (const entry of packages) {
  const response = await fetch(`${lock.repository}/${entry.path}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Downloading ${entry.name} returned ${response.status}`);
  const data = await response.arrayBuffer();
  const sha256 = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  if (sha256 !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.name}`);
  const path = `${directory}/${entry.name}.deb`;
  await Bun.write(path, data);
  files.push(path);
}
await $`apt-get install -y --no-install-recommends ${files}`;
for (const entry of packages) {
  const version = (await $`dpkg-query -W -f=${"${Version}"} ${entry.name}`.text()).trim();
  if (version !== entry.version) throw new Error(`Installed ${entry.name}: expected ${entry.version}, got ${version}`);
}
console.log(`Installed ${packages.length} exact COSMIC packages for ${profile}`);

// SPDX-License-Identifier: Apache-2.0
import { chmod } from "node:fs/promises";
import { saveState } from "./ai-lab.ts";
export interface NetworkSnapshot {
  interface: string;
  peers: {
    id: string;
    address: string;
    state: "recent" | "stale" | "never" | "unavailable";
    handshakeAgeSeconds?: number;
  }[];
}
interface Declaration {
  interface: string;
  peers: { id: string; address: string }[];
}
export function networkSnapshot(
  declaration: Declaration,
  allowed: string,
  handshakes: string,
  now: number,
): NetworkSnapshot {
  const addresses = new Map(
    allowed
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/, 2) as [string, string]),
  );
  const times = new Map(
    handshakes
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/, 2) as [string, string]),
  );
  return {
    interface: declaration.interface,
    peers: declaration.peers.map(({ id, address }) => {
      const key = [...addresses.entries()].find(([, ips]) =>
        ips?.split(",").includes(`${address}/32`),
      )?.[0];
      const timestamp = key ? Number(times.get(key)) : Number.NaN;
      if (!Number.isFinite(timestamp)) return { id, address, state: "unavailable" as const };
      if (timestamp === 0) return { id, address, state: "never" as const };
      const age = Math.max(0, Math.floor(now - timestamp));
      return {
        id,
        address,
        state: age <= 180 ? ("recent" as const) : ("stale" as const),
        handshakeAgeSeconds: age,
      };
    }),
  };
}
async function read(interfaceName: string, field: string): Promise<string> {
  const child = Bun.spawn(["wg", "show", interfaceName, field], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, , status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return status === 0 ? output : "";
}
export async function wireguard(path: string): Promise<NetworkSnapshot> {
  const declaration = (await Bun.file(path).json()) as Declaration;
  if (!/^wg[0-9]+$/.test(declaration.interface))
    throw new Error("Invalid declared WireGuard interface");
  const [allowed, handshakes] = await Promise.all([
    read(declaration.interface, "allowed-ips"),
    read(declaration.interface, "latest-handshakes"),
  ]);
  return networkSnapshot(declaration, allowed, handshakes, Date.now() / 1000);
}
const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (import.meta.main) {
  for (const name of ["--network", "--receipt"])
    if (!process.argv.includes(name)) throw new Error(`Missing ${name}`);
  const result = await wireguard(flag("--network")!);
  await saveState(flag("--receipt")!, result);
  await chmod(flag("--receipt")!, 0o644);
}

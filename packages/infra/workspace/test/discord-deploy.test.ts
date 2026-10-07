// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deployDiscord,
  discordDeployment,
  quiesceDiscord,
  type DiscordDeploymentTransport,
} from "../src/discord.ts";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "discord-deployment-test-"));
  const host = join(root, "config/host");
  await mkdir(join(host, "systemd/aphrody"), { recursive: true });
  await Bun.write(
    join(host, "catalog.json"),
    JSON.stringify({
      units: [
        {
          service: "aphrody-discord-omar-monitor",
          unit: "aphrody-discord-omar-monitor.service",
          path: "systemd/aphrody/aphrody-discord-omar-monitor.service",
          dropIns: [],
          ownerRepo: "aphrody",
          targetHost: "vps",
        },
      ],
    }),
  );
  await Bun.write(
    join(host, "systemd/aphrody/aphrody-discord-omar-monitor.service"),
    "[Service]\nUser=ubuntu\nExecStart=/home/ubuntu/.bun/bin/bun /srv/aphrody-lab/omar-monitor.mjs\n",
  );
  await Bun.write(join(host, "discord-omar-monitor.json"), '{"schemaVersion":1}\n');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fixture(fail: (command: string) => boolean = () => false, native = true) {
  const commands: string[] = [];
  const uploads: string[] = [];
  const builds: string[] = [];
  const transport: DiscordDeploymentTransport = {
    async run(_host, command) {
      commands.push(command);
      if (command.endsWith("--capabilities"))
        return native
          ? { code: 0, stdout: '{"upgradeProtocol":2}', stderr: "" }
          : { code: 1, stdout: "", stderr: "error: --policy required" };
      if (fail(command)) return { code: 1, stdout: "", stderr: "fixture refusal" };
      return {
        code: 0,
        stdout: command.endsWith("-p MainPID --value") ? "1234\n" : "",
        stderr: "",
      };
    },
    async upload(_host, source, target) {
      uploads.push(`${source} -> ${target}`);
    },
    async build(entrypoint, outdir) {
      builds.push(entrypoint);
      await Bun.write(join(outdir, "omar-monitor.mjs"), "// fixture product artifact\n");
    },
    async wait() {},
  };
  return { commands, uploads, builds, transport };
}
const quiet = () => {};

test("release resolves product source and the declared target; foreign targets fail", () => {
  expect(discordDeployment("omar-monitor", "vps", root).entrypoint).toBe(
    join(root, "packages/discord/kit/src/omar-monitor/main.ts"),
  );
  expect(() => discordDeployment("omar-monitor", "dbfr", root)).toThrow("not dbfr");
  expect(() => discordDeployment("arbitrary", "vps", root)).toThrow("Unknown Discord deployment");
});
test("an unqualified legacy artifact cannot bypass the product upgrade protocol", async () => {
  const f = fixture(undefined, false);
  await expect(
    deployDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, quiet),
  ).rejects.toThrow("upgrade protocol");
  expect(f.uploads).toEqual([]);
  expect(f.commands.some((command) => command.includes("--signal"))).toBe(false);
});

test("an active goal prevents uploads, builds, installs and restart", async () => {
  const f = fixture((command) => command.includes("--upgrade-check"));
  await expect(
    deployDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, quiet),
  ).rejects.toThrow("left running");
  expect(f.builds).toEqual([]);
  expect(f.uploads).toEqual([]);
  expect(f.commands.some((command) => /mkdir|install|restart/.test(command))).toBe(false);
});

test("drainage waits on the same live PID and leaves the goal running when observation expires", async () => {
  const f = fixture((command) => command.includes("--upgrade-check"), true);
  await expect(
    quiesceDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, 2),
  ).rejects.toThrow("left running");
  expect(
    f.commands.filter((command) => command.includes("--upgrade-check --expect-pid 1234")),
  ).toHaveLength(2);
  expect(f.commands.some((command) => command.includes("--signal=SIGUSR1"))).toBe(true);
  expect(f.commands.some((command) => /restart|stop|install/.test(command))).toBe(false);
});
test("a monitor still starting receives no drainage signal before its PID publishes readiness", async () => {
  const f = fixture((command) => command.includes("--ready-check"));
  await expect(
    quiesceDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, 2),
  ).rejects.toThrow("no signal was sent");
  expect(f.commands.some((command) => command.includes("--signal"))).toBe(false);
});

test("a changed systemd PID while draining defers upgrade", async () => {
  const f = fixture((command) => command.includes("--upgrade-check"), true);
  let observations = 0;
  const run = f.transport.run;
  f.transport.run = async (host, command) => {
    const result = await run(host, command);
    if (command.endsWith("-p MainPID --value") && ++observations > 1) result.stdout = "2345\n";
    return result;
  };
  await expect(
    quiesceDiscord(discordDeployment("omar-monitor", "vps", root), f.transport),
  ).rejects.toThrow("PID changed");
});

test("a failed staged product probe keeps installed files and service untouched", async () => {
  const f = fixture((command) => command.endsWith("--probe"));
  await expect(
    deployDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, quiet),
  ).rejects.toThrow("fixture refusal");
  expect(f.uploads).toHaveLength(2);
  expect(f.commands.some((command) => /sudo.*install|systemctl restart/.test(command))).toBe(false);
  expect(f.commands.at(-1)).toContain("rm -rf -- '/tmp/aphrody-discord-release-");
});

test("release verifies uploaded bytes, installs the declared unit, and preserves protected stores", async () => {
  const f = fixture(undefined, true);
  await deployDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, quiet);
  expect(f.uploads).toHaveLength(2);
  expect(f.uploads.join("\n")).not.toMatch(/queue\.sqlite|\.env|auth/);
  const checks = f.commands.filter((command) => command.includes("sha256sum -c --quiet"));
  expect(checks).toHaveLength(4);
  expect(f.commands.findIndex((command) => command.endsWith("--probe"))).toBeLessThan(
    f.commands.findIndex((command) => command.includes(".new'")),
  );
  expect(
    f.commands.some((command) =>
      command.includes("systemctl restart 'aphrody-discord-omar-monitor.service'"),
    ),
  ).toBe(true);
  expect(
    f.commands.some(
      (command) => command.includes("queue.sqlite") && !command.includes("readonly:true"),
    ),
  ).toBe(false);
});

test("activation failure restores previous product files and the previous unit", async () => {
  const f = fixture(
    (command) => command.includes("restart") && command.includes("is-active --quiet"),
  );
  await expect(
    deployDiscord(discordDeployment("omar-monitor", "vps", root), f.transport, quiet),
  ).rejects.toThrow("fixture refusal");
  expect(
    f.commands.filter(
      (command) => command.includes("previous-") && command.includes("install -o root"),
    ),
  ).toHaveLength(3);
  expect(
    f.commands.some(
      (command) =>
        command.includes("previous-active") && command.includes("systemctl daemon-reload"),
    ),
  ).toBe(true);
});

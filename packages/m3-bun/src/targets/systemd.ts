// SPDX-License-Identifier: Apache-2.0
// systemd: a unit in the shape of the yolo host units (`tools/config/host/systemd/<ns>/*.service`: Type=simple, an
// unprivileged user, `WorkingDirectory=/home/<user>/apps/<ns>/current`, an `EnvironmentFile` under `/etc/<ns>`, restart on
// failure), with the sandbox written as the shared drop-ins of `tools/config/host/systemd/shared` (copied from the
// yolo checkout when it is there), a catalog entry in the `service-catalog.json` format and an env example.
// Nothing here installs anything: hosts change through Infra's catalog, plan first.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

/** The shared drop-ins this unit uses, in application order, with the text used when yolo is not checked out. */
export const SHARED_DROPINS: ReadonlyArray<readonly [string, string]> = [
  [
    "sandbox-base.conf",
    "# Baseline sandbox: no privilege gain, private /tmp, read-only OS tree (add ReadWritePaths per unit).\n[Service]\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\n",
  ],
  [
    "sandbox-home-ro.conf",
    "# Home directories read-only.\n[Service]\nProtectHome=read-only\n",
  ],
  [
    "sandbox-kernel.conf",
    "# Kernel tunables, modules and cgroups read-only; no setuid/setgid; no personality changes.\n[Service]\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nLockPersonality=true\n",
  ],
  [
    "net-inet-only.conf",
    "# Restrict sockets to unix, IPv4 and IPv6.\n[Service]\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n",
  ],
  [
    "syscall-service.conf",
    "# Allow the @system-service syscall set and deny obsolete/privileged calls.\n[Service]\nSystemCallFilter=@system-service\nSystemCallFilter=~@obsolete @privileged\n",
  ],
];

/** A shared drop-in from `<yolo>/tools/config/host/systemd/shared`, else the embedded text. */
export function sharedDropin(yoloRoot: string, file: string): string {
  const path = join(yoloRoot, "tools/config/host/systemd/shared", file);
  if (existsSync(path)) return readFileSync(path, "utf8");
  return SHARED_DROPINS.find(([name]) => name === file)![1];
}

export const unit = (
  c: TargetContext,
): string => `# SPDX-License-Identifier: Apache-2.0
# ${GENERATED_NOTE}
[Unit]
Description=${c.name}: M3 app, UI and API from one Bun executable
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${c.user}
Group=${c.user}
WorkingDirectory=/home/${c.user}/apps/${c.namespace}/current
Environment=PORT=${c.port}
Environment=HOST=127.0.0.1
EnvironmentFile=-/etc/${c.namespace}/${c.name}.env
ExecStart=/home/${c.user}/apps/${c.namespace}/current/bin/${c.binary}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
`;

export const catalogEntry = (c: TargetContext) => ({
  id: c.name,
  application: c.namespace,
  kind: "bun-http",
  runtime: "bun",
  unit: `${c.name}.service`,
  health: `http://127.0.0.1:${c.port}/healthz`,
  port: c.port,
  sourceRepo: c.namespace,
  workingDirectory: `/home/${c.user}/apps/${c.namespace}/current`,
  environmentFile: `/etc/${c.namespace}/${c.name}.env`,
  publicProxy: "nginx",
  public: Boolean(c.domain),
});

export const systemd: Target = {
  id: "systemd",
  title: "systemd",
  description:
    "Service unit in the yolo host shape, shared sandbox drop-ins, service-catalog entry, env example",
  generate(c): GeneratedFile[] {
    const dropins: GeneratedFile[] = SHARED_DROPINS.map(([name], i) => ({
      path: `${c.name}.service.d/${String(10 + i * 10).padStart(2, "0")}-${name}`,
      content: sharedDropin(c.yoloRoot, name),
    }));
    return [
      { path: `${c.name}.service`, content: unit(c) },
      ...dropins,
      {
        path: `${c.name}.env.example`,
        content: `# ${GENERATED_NOTE}\n# Installed as /etc/${c.namespace}/${c.name}.env (mode 0640, owner root:${c.user}); never commit real values.\nPORT=${c.port}\nHOST=127.0.0.1\n`,
      },
      {
        path: "service-catalog.entry.json",
        content: `${JSON.stringify(catalogEntry(c), null, 2)}\n`,
      },
    ];
  },
};

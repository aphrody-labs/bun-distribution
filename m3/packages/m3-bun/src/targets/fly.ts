// SPDX-License-Identifier: Apache-2.0
// Fly.io: fly.toml for the Dockerfile of the docker target (copy both to the project root). The image is the
// Aphrody Alpine runtime image with the one executable; Fly's HTTP check uses the app's own /healthz.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const flyToml = (c: TargetContext): string => `# ${GENERATED_NOTE}
app = "${c.name}"
primary_region = "${c.region}"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "${c.port}"
  HOST = "0.0.0.0"

[http_service]
  internal_port = ${c.port}
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "requests"
    soft_limit = 200
    hard_limit = 250

  [[http_service.checks]]
    grace_period = "5s"
    interval = "15s"
    method = "GET"
    path = "/healthz"
    timeout = "3s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
`;

export const fly: Target = {
  id: "fly",
  title: "Fly.io",
  description:
    "fly.toml: HTTP service with /healthz check, auto stop and start, built from the docker target's Dockerfile",
  generate: (c): GeneratedFile[] => [{ path: "fly.toml", content: flyToml(c) }],
};

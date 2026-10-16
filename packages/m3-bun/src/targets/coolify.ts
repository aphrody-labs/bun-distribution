// SPDX-License-Identifier: Apache-2.0
// Coolify: a Docker Compose application. Coolify reads `SERVICE_FQDN_<SERVICE>_<PORT>` to generate (or take) the
// domain and route it to that port, so the compose file carries no proxy labels. The build uses the Dockerfile
// of the docker target. Import the repository as a "Docker Compose" resource and point it at this file.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const composeFile = (c: TargetContext): string => `# ${GENERATED_NOTE}
services:
  ${c.name}:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - SERVICE_FQDN_${c.name.toUpperCase().replace(/-/g, "_")}_${c.port}${c.domain ? `=https://${c.domain}` : ""}
      - PORT=${c.port}
      - HOST=0.0.0.0
    healthcheck:
      test: ["CMD", "/app/server", "--healthcheck"]
      interval: 30s
      timeout: 4s
      retries: 3
      start_period: 5s
    restart: unless-stopped
`;

export const coolify: Target = {
  id: "coolify",
  title: "Coolify",
  description:
    "Docker Compose resource with Coolify's SERVICE_FQDN routing variable and the executable's health check",
  generate: (c): GeneratedFile[] => [
    { path: "docker-compose.yaml", content: composeFile(c) },
    {
      path: ".env.example",
      content: `# ${GENERATED_NOTE}\n# Set secrets in Coolify's environment panel, not here.\nPORT=${c.port}\nHOST=0.0.0.0\n`,
    },
  ],
};

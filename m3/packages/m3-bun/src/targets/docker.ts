// SPDX-License-Identifier: Apache-2.0
// Docker: a multi-stage Dockerfile that compiles the app and ends in `FROM scratch`, with exactly the shared
// libraries the executable needs copied from `ldd` (a Bun executable is dynamic: glibc, not static). Plus a
// Dockerfile for a rootfs prepared by `m3-bun package --rootfs`, a compose file and a .dockerignore.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

/** Shell snippet that copies the executable and every library `ldd` lists into /rootfs, same absolute paths. */
export const ROOTFS_SCRIPT = [
  "set -eu",
  "mkdir -p /rootfs/app",
  'cp "$BIN" /rootfs/app/server',
  'for lib in $(ldd "$BIN" | awk \'/=> \\//{print $3} /^[[:space:]]*\\//{print $1}\'); do cp --parents -L "$lib" /rootfs; done',
].join("; ");

const dockerfile = (c: TargetContext): string => `# syntax=docker/dockerfile:1
# ${GENERATED_NOTE}
# ${c.name} ${c.version}: one executable serves the UI and the API. The final image is \`scratch\` plus the
# shared libraries of that executable (libc, libm, libdl, libpthread and the loader), no shell, no package manager.
# \`bun build --compile\` output is dynamically linked: a truly empty image is not possible (see docs/guides/M3-BUN.md).

FROM oven/bun:${c.bunVersion}-debian AS build
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN ${c.cli} compile --target linux-x64 --outfile /out/${c.binary}
RUN BIN=/out/${c.binary}; ${ROOTFS_SCRIPT}

FROM scratch
COPY --from=build /rootfs/ /
ENV PORT=${c.port} HOST=0.0.0.0
EXPOSE ${c.port}
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD ["/app/server", "--healthcheck"]
ENTRYPOINT ["/app/server"]
`;

const scratchfile = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Image of an already compiled app: \`${c.cli} package --rootfs\` writes ./rootfs (the executable and its libraries).
#   docker build -f Dockerfile.scratch -t ${c.image}:${c.version} .
FROM scratch
COPY rootfs/ /
ENV PORT=${c.port} HOST=0.0.0.0
EXPOSE ${c.port}
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD ["/app/server", "--healthcheck"]
ENTRYPOINT ["/app/server"]
`;

const compose = (c: TargetContext): string => `# ${GENERATED_NOTE}
services:
  ${c.name}:
    image: ${c.image}:${c.version}
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:${c.port}:${c.port}"
    environment:
      PORT: "${c.port}"
      HOST: 0.0.0.0
    healthcheck:
      test: ["CMD", "/app/server", "--healthcheck"]
      interval: 30s
      timeout: 4s
      retries: 3
      start_period: 5s
    restart: unless-stopped
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
`;

export const docker: Target = {
  id: "docker",
  title: "Docker",
  description: "Multi-stage Dockerfile ending in scratch plus the executable's shared libraries, a rootfs Dockerfile, compose and .dockerignore",
  generate(c): GeneratedFile[] {
    return [
      { path: "Dockerfile", content: dockerfile(c) },
      { path: "Dockerfile.scratch", content: scratchfile(c) },
      { path: "docker-compose.yml", content: compose(c) },
      { path: ".dockerignore", content: ["node_modules", ".git", "dist", "bin", "deploy", "**/*.log", ".env*", ""].join("\n") },
    ];
  },
};

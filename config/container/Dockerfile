# SPDX-License-Identifier: Apache-2.0
# syntax=docker/dockerfile:1.7
#
# Aphrody in a container. Build context: the repository root.
#
#   docker build -f config/container/Dockerfile --target runtime -t aphrody:runtime .   # Bun apps, MCP servers, yolo
#   docker build -f config/container/Dockerfile --target dev     -t aphrody:dev     .   # + Rust toolchain and build tools
#
# Targets: base (OS, Bun, uv) -> deps (frozen Bun install) -> runtime | dev.
# The container is its own build host: the dev target sets APHRODY_CLOUD=1, the same profile as a Claude cloud
# session (local Cargo through scripts/build/rust/cargo-serial.sh, jobs = CPU count, no factory routing).
# Limits: scoped `-p <crate>` Cargo gates; full-workspace and engine (V8, Tauri, WebKit) builds need a larger host.

ARG UBUNTU=24.04

FROM ubuntu:${UBUNTU} AS base
# Pins follow package.json (packageManager) and config/system-packages.json; pass --build-arg to move them.
ARG BUN_VERSION=1.4.2
ARG UV_VERSION=0.12.22
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client unzip xz-utils zstd jq ripgrep rsync python3 \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | env BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}" \
 && curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh
COPY --chmod=755 config/container/entrypoint.sh /usr/local/bin/aphrody-entrypoint
# Ubuntu 24.04 ships a uid 1000 user; the container user is `aphrody` with the same uid so bind mounts keep ownership.
RUN (userdel -r ubuntu 2>/dev/null || true) && useradd -m -u 1000 -s /bin/bash aphrody \
 && mkdir -p /app /home/aphrody/.aphrody && chown -R aphrody:aphrody /app /home/aphrody

FROM base AS deps
WORKDIR /app
COPY --chown=aphrody:aphrody . .
USER aphrody
RUN --mount=type=cache,target=/home/aphrody/.bun/install/cache,uid=1000,gid=1000 \
    bun install --frozen-lockfile

# Bun-side Aphrody: `yolo`, the MCP servers (yolo, aphrody-m3) and the HTTP API. The Rust `aphrody` binary is not
# built here; mount it or install it from the download server (APHRODY_DOWNLOAD_BASE) into /usr/local/bin.
FROM deps AS runtime
ENV APHRODY_HOME=/home/aphrody/.aphrody PORT=8999 BUN_INSTALL=/home/aphrody/.bun
VOLUME /home/aphrody/.aphrody
EXPOSE 8999
ENTRYPOINT ["aphrody-entrypoint"]
CMD ["mcp"]

FROM deps AS dev
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config clang libclang-dev cmake ninja-build libssl-dev libsqlite3-dev zlib1g-dev \
      liblzma-dev libbz2-dev libzstd-dev protobuf-compiler ffmpeg pigz \
 && rm -rf /var/lib/apt/lists/*
USER aphrody
ENV RUSTUP_HOME=/home/aphrody/.rustup CARGO_HOME=/home/aphrody/.cargo \
    BUN_INSTALL=/home/aphrody/.bun \
    PATH=/home/aphrody/.cargo/bin:/home/aphrody/.bun/bin:/home/aphrody/.local/bin:/usr/local/bin:/usr/bin:/bin \
    APHRODY_HOME=/home/aphrody/.aphrody APHRODY_CLOUD=1
# The channel is the one rust-toolchain.toml pins.
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none \
 && channel="$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' rust-toolchain.toml | head -1)" \
 && rustup toolchain install "${channel}" --profile minimal -c rustfmt -c clippy -c rust-src \
 && rustup default "${channel}"
# Bun gates (oxlint, oxfmt) and prebuilt cargo tools; the latter are best effort (network policies differ).
RUN bun add -g oxlint oxfmt typescript@7.0.2 \
 && (bun scripts/dev/cloud-quickinstall.ts just sccache cargo-nextest cargo-deny cargo-audit sd fd-find ripgrep || true)
ENTRYPOINT ["aphrody-entrypoint"]
CMD ["shell"]

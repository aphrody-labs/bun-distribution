# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: Apache-2.0
#
# Aphrody userland: Alpine with the GNU/busybox core utilities replaced by Rust
# rewrites, and Bun as the JavaScript/TypeScript runtime.
#
#   docker build --target runtime -t aphrody/bun-alpine tools/config/container/aphrody-os # Bun-only runtime
#   docker build -t aphrody/rust-bun tools/config/container/aphrody-os                    # CLI (default)
#   docker build -t aphrody/cosmic --target desktop tools/config/container/aphrody-os     # + COSMIC Epoch
#   docker run --rm -it aphrody/rust-bun
#   docker run --rm aphrody/rust-bun aphrody-selftest                                # 25 checks
#
# COSMIC on a host Wayland session (software rendering unless a GPU is passed):
#   docker run --rm -it -v "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY:/tmp/host-wayland/wayland-0" aphrody/cosmic
# Headless proof (weston headless + grim screenshot): desktop-test/.
#
# Only /bin/sh stays on busybox ash: apk maintainer scripts and Docker `RUN`
# lines are POSIX sh, which neither Nushell nor Ion implement.

ARG ALPINE_VERSION=3.24
ARG BUN_VERSION=1.4.2

# Official Bun image, used only as a source for its verified musl binary.
FROM oven/bun:${BUN_VERSION}-alpine AS bun

FROM alpine:${ALPINE_VERSION} AS runtime

LABEL org.opencontainers.image.title="aphrody/bun-alpine" \
      org.opencontainers.image.description="Minimal non-root Alpine runtime using the official musl Bun binary" \
      org.opencontainers.image.licenses="Apache-2.0"

# Keep the runtime free of compilers and agent/desktop tools. The official
# Alpine Bun image supplies the musl-linked binary; GNU/glibc release artifacts
# must not be copied into this image.
RUN apk add --no-cache ca-certificates libgcc libstdc++ tzdata \
    && addgroup -g 1000 agent \
    && adduser -D -u 1000 -G agent -h /home/agent agent \
    && mkdir -p /home/agent/app \
    && chown -R agent:agent /home/agent

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx

ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    BUN_INSTALL_BIN=/usr/local/bin \
    LANG=C.UTF-8

USER agent
WORKDIR /home/agent/app
CMD ["/usr/local/bin/bun", "--version"]

FROM runtime AS cli

LABEL org.opencontainers.image.title="aphrody/rust-bun" \
      org.opencontainers.image.description="Alpine with uutils, sudo-rs, eza, Nushell, Ion and Bun instead of GNU/busybox tools" \
      org.opencontainers.image.licenses="Apache-2.0"

USER root

# `build_ca` is an optional BuildKit secret for builds behind a TLS-intercepting
# proxy. It is only read during this step and never stored in the image.
RUN --mount=type=secret,id=build_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    apk add --no-cache \
        libgcc libstdc++ ca-certificates tzdata \
        uutils-coreutils uutils-coreutils-groups uutils-coreutils-hostname \
        uutils-coreutils-more uutils-coreutils-uptime \
        sudo-rs sudo-rs-su linux-pam \
        eza ripgrep fd bottom \
        nushell starship ion-shell \
        helix yazi zellij; \
    # sudo-rs-su ships /usr/bin/su; drop busybox's copy so only one su exists.
    rm -f /bin/su

COPY rootfs/ /

# "agent" is the account autonomous agents run as; it gets root through sudo-rs
# without a password (yolo mode, see /etc/sudoers.d/agent).
RUN set -eu; \
    grep -qx "@includedir /etc/sudoers.d" /etc/sudoers || echo "@includedir /etc/sudoers.d" >> /etc/sudoers; \
    chmod 0440 /etc/sudoers /etc/sudoers.d/agent; \
    printf '/usr/bin/nu\n/usr/bin/ion\n' >> /etc/shells; \
    sed -i 's#^agent:x:1000:1000:.*#agent:x:1000:1000:Linux User,,,:/home/agent:/usr/bin/nu#' /etc/passwd; \
    sed -i 's#^root:x:0:0:root:/root:/bin/sh#root:x:0:0:root:/root:/usr/bin/nu#' /etc/passwd; \
    mkdir -p /home/agent/app; \
    cp -r /etc/skel/. /home/agent/; \
    mkdir -p /root/.config && cp -r /etc/skel/.config/. /root/.config/; \
    chown -R agent:agent /home/agent; \
    mkdir -p /usr/share/nushell/vendor/autoload; \
    starship init nu > /usr/share/nushell/vendor/autoload/starship.nu; \
    visudo -c

ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    BUN_INSTALL_BIN=/usr/local/bin \
    SHELL=/usr/bin/nu \
    EDITOR=hx \
    LANG=C.UTF-8

USER agent
WORKDIR /home/agent/app
CMD ["/usr/bin/nu"]


# COSMIC Epoch desktop on top of the CLI image: cosmic-comp (Smithay) and the
# libcosmic/iced applications. Containers have no display of their own, so the
# session runs nested in the host's Wayland compositor (or apps run directly on
# it). Mesa llvmpipe/lavapipe provide software rendering when no GPU is passed.
FROM cli AS desktop

USER root
RUN --mount=type=secret,id=build_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    apk add --no-cache \
        cosmic-comp cosmic-session cosmic-panel cosmic-launcher \
        cosmic-app-library cosmic-applets cosmic-bg cosmic-icons cosmic-idle \
        cosmic-notifications cosmic-osd cosmic-randr cosmic-screenshot \
        cosmic-settings cosmic-settings-daemon cosmic-workspaces \
        cosmic-term cosmic-files cosmic-edit cosmic-store cosmic-player \
        xdg-desktop-portal-cosmic \
        dbus mesa-dri-gallium mesa-vulkan-swrast mesa-egl mesa-gles \
        font-noto font-fira xwayland

COPY desktop/ /

ENV XDG_RUNTIME_DIR=/tmp/xdg-runtime \
    XDG_SESSION_TYPE=wayland \
    XDG_CURRENT_DESKTOP=COSMIC

USER agent
CMD ["/usr/local/bin/aphrody-desktop", "session"]

# Default target: the CLI image.
FROM cli

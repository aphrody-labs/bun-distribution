# syntax=docker/dockerfile:1
# Rootfs is produced offline from the signed root pacman lock by the one factory.
# No package resolution or upstream installer runs during product image assembly.
FROM scratch AS payload
ADD arch/rootfs.tar /
COPY arch/rootfs.receipt.json /opt/bun-os/arch/rootfs.receipt.json
COPY runtime/ /opt/bun-os/runtime/
COPY sources/ /opt/bun-os/sources/
COPY wasm/ /opt/bun-os/wasm/
COPY product/ /opt/bun-os/product/
COPY product.receipt.json product.qualification.json /opt/bun-os/
COPY distribution.json sources.receipt.json /opt/bun-os/
COPY container/ /opt/bun-os/container/
ENV BUN_OS_PACKAGE_MANAGER=pacman
RUN ["/bin/sh", "-ec", "chmod 0755 /opt/bun-os/runtime/bun /opt/bun-os/container/bunos; ln -s /opt/bun-os/runtime/bun /usr/local/bin/bun; ln -s /opt/bun-os/container/bunos /usr/local/bin/bunos; groupadd --gid 10000 bun; useradd --uid 10000 --gid 10000 --create-home --shell /usr/bin/nologin bun; install -d -m 0700 -o bun -g bun /run/user/10000; install -d -o bun -g bun /work; bun /opt/bun-os/container/qualify-image.ts; ldd /usr/local/bin/bun > /opt/bun-os/runtime/shared-libraries.txt; ! grep -q 'not found' /opt/bun-os/runtime/shared-libraries.txt"]
ARG DISTRIBUTION_VERSION
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="Bun OS" \
    org.opencontainers.image.source="https://github.com/aphrody-labs/bun-distribution" \
    org.opencontainers.image.version=$DISTRIBUTION_VERSION \
    org.opencontainers.image.revision=$SOURCE_REVISION
ENV HOME=/home/bun BUN_OS_ROOT=/opt/bun-os XDG_RUNTIME_DIR=/run/user/10000
WORKDIR /work
USER 10000:10000
ENTRYPOINT ["/usr/local/bin/bun", "/opt/bun-os/container/entrypoint.ts"]

FROM payload AS server
ENV BUN_OS_COMPOSITION=server
CMD ["health"]

FROM payload AS desktop
ENV BUN_OS_COMPOSITION=desktop XDG_CURRENT_DESKTOP=COSMIC XDG_SESSION_DESKTOP=COSMIC
CMD ["cosmic"]

FROM payload AS gaming
ENV BUN_OS_COMPOSITION=gaming
CMD ["health"]

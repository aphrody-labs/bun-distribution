# syntax=docker/dockerfile:1.8
# SPDX-License-Identifier: Apache-2.0
# Virtual desktop for computer-use agents: Xvfb + openbox + `aphrody infra remote serve` (viewer 8795, VNC 5900).
# Built on the aphrody:runtime image; build with compose.vnc.yaml (context = this directory).
ARG BASE=aphrody:runtime
FROM ${BASE}
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb openbox xterm x11-utils fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY --from=aphrodybin --chmod=0755 aphrody /usr/local/bin/aphrody
COPY --chmod=0755 entrypoint.sh /usr/local/bin/aphrody-desktop-entrypoint
USER aphrody
ENV DISPLAY=:99
EXPOSE 5900 8795
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bash", "-c", "ip=$(hostname -i | grep -oE '[0-9]+([.][0-9]+){3}' | head -n1); exec 3<>/dev/tcp/$ip/8795; printf 'GET /healthz HTTP/1.0\r\n\r\n' >&3; grep -q ok <&3"]
ENTRYPOINT ["/usr/local/bin/aphrody-desktop-entrypoint"]

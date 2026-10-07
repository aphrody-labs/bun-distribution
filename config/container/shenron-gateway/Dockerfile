# SPDX-License-Identifier: Apache-2.0
# Build on the VPS from this directory; no certificates or runtime stores in context.
FROM ubuntu:26.04

ARG APHRODY_REVISION
LABEL org.opencontainers.image.title="Shenron gateway" \
      org.opencontainers.image.description="Infra-owned Shenron HTTPS and public CDN gateway" \
      org.opencontainers.image.revision="${APHRODY_REVISION}"

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install --yes --no-install-recommends \
      ca-certificates curl nginx \
      libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static \
      libnginx-mod-http-headers-more-filter \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/nginx/sites-enabled/default \
 && for name in dragonballfr bot-dragonballfr cdn-dragonballfr; do \
      ln -sf /dev/stdout "/var/log/nginx/${name}-access.log"; \
      ln -sf /dev/stderr "/var/log/nginx/${name}-error.log"; \
    done

COPY nginx.conf /etc/nginx/nginx.conf

# The root master opens TLS keys and listeners; www-data workers serve requests.
# Compose must drop capabilities and grant only NET_BIND_SERVICE, SETUID and SETGID.
EXPOSE 80 443/tcp 443/udp
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent --show-error --max-time 4 --noproxy '*' \
    --resolve dragonballfr.com:443:127.0.0.1 https://dragonballfr.com/api/health >/dev/null || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

# SPDX-License-Identifier: Apache-2.0
FROM ubuntu:26.04
ARG APHRODY_REVISION
LABEL org.opencontainers.image.source="https://github.com/aphrody-labs/aphrody" org.opencontainers.image.revision="${APHRODY_REVISION}"
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-18=18.6-0ubuntu0.26.04.1 postgresql-client-18=18.6-0ubuntu0.26.04.1 postgresql-18-pgvector=0.8.1-2 redis-server=5:8.0.5-1 redis-tools=5:8.0.5-1 ca-certificates && rm -rf /var/lib/apt/lists/* /var/lib/postgresql/* /var/lib/redis/* /etc/ssl/private/ssl-cert-snakeoil.key
RUN groupmod --gid 111 postgres && usermod --uid 105 --gid 111 postgres && groupmod --gid 110 redis && usermod --uid 104 --gid 110 redis
# Existing PostgreSQL roles, auth and Redis state are mounted; never initialize a new store.
USER 105:111
ENTRYPOINT ["/usr/lib/postgresql/18/bin/postgres"]

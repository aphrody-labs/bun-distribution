# SPDX-License-Identifier: Apache-2.0
FROM ubuntu:26.04
ARG APHRODY_REVISION
LABEL org.opencontainers.image.source="https://github.com/aphrody-labs/aphrody" org.opencontainers.image.revision="${APHRODY_REVISION}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 && rm -rf /var/lib/apt/lists/*
# Context must contain only the qualified b11415 runtime, never weights or adapters.
COPY runtime/ /opt/llama/
ENV LD_LIBRARY_PATH=/opt/llama
USER 1000:1000
ENTRYPOINT ["/opt/llama/llama-server"]

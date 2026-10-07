# SPDX-License-Identifier: Apache-2.0
# Headless COSMIC proof: weston headless (pixman) stands in for the host compositor; see run.sh.
#   docker build -t aphrody/cosmic-test desktop-test && docker run --rm -v $PWD/out:/out -v $PWD/desktop-test/run.sh:/run.sh:ro aphrody/cosmic-test /run.sh
FROM aphrody/cosmic
USER root
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    apk add --no-cache weston weston-backend-headless weston-shell-desktop grim wayland-utils
USER agent

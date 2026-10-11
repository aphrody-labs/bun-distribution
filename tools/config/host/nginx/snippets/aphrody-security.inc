# SPDX-License-Identifier: Apache-2.0
# Security response headers; repeated in every location that sets its own add_header.
add_header X-Content-Type-Options "nosniff" always;
add_header Strict-Transport-Security "max-age=63072000" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# SPDX-License-Identifier: Apache-2.0
# Include in the existing source.aphrody.app TLS server only after service qualification.
# Reserve a separate namespace; Gitea /api/v1/ and its / routes remain unchanged.
location ^~ /api/product/v1/ {
    proxy_pass http://127.0.0.1:29030/api/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Authorization $http_authorization;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
    proxy_buffering off;
}

location = /api/product/healthz {
    proxy_pass http://127.0.0.1:29030/healthz;
    proxy_set_header Host $host;
    proxy_connect_timeout 5s;
    proxy_read_timeout 5s;
}

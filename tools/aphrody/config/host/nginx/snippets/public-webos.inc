# SPDX-License-Identifier: Apache-2.0
# Only public browser assets and release archives; no application or host upstream.
location = /labs/webos { return 308 /labs/webos/; }
location = /labs/webos/ {
    rewrite ^ /labs/webos/index.html last;
}
location = /labs/webos/index.html {
    internal;
    alias /var/www/aphrody-public-webos/current/index.html;
    limit_except GET { deny all; }
}
location = /labs/webos/site.css {
    alias /var/www/aphrody-public-webos/current/site.css;
    limit_except GET { deny all; }
}
location = /labs/webos/site.js {
    alias /var/www/aphrody-public-webos/current/site.js;
    limit_except GET { deny all; }
}
location = /labs/webos/downloads/bun-webos-1.4.4.tgz {
    alias /var/www/aphrody-public-webos/current/downloads/bun-webos-1.4.4.tgz;
    default_type application/gzip;
    limit_except GET { deny all; }
}
location = /labs/webos/downloads/aphrody-bun-tools-1.4.4.tgz {
    alias /var/www/aphrody-public-webos/current/downloads/aphrody-bun-tools-1.4.4.tgz;
    default_type application/gzip;
    limit_except GET { deny all; }
}
location = /labs/webos/downloads/aphrody-supervisor-1.4.4.tgz {
    alias /var/www/aphrody-public-webos/current/downloads/aphrody-supervisor-1.4.4.tgz;
    default_type application/gzip;
    limit_except GET { deny all; }
}
location ^~ /labs/webos/ { return 404; }

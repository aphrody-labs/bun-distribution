<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron gateway image

Build this image on the VPS with a committed Infra revision. DBFR consumes the
sealed image without installing or compiling nginx during activation. The image
supports the HTTP/3, Brotli and headers-more directives already used by the
canonical files in `tools/config/host/nginx/shenron/`; it does not contain a second route
implementation.

Mount the selected, checksum-sealed route files under `/etc/nginx/conf.d` read-only.
Mount the dedicated `/etc/aphrody/shenron-tls` store read-only at `/etc/letsencrypt`; certificate
private keys never enter the context, image or release archive. Bind only the
public wiki, bot assets and public extra stores under `/home/ubuntu/apps/shenron-cdn`, and the
canonical maintenance page at `/var/www/shenron/50x.html`. Never mount home,
conversation, database, backup or model directories as public content.

Use a read-only root filesystem, `no-new-privileges`, `cap_drop: [ALL]`, and grant
only `NET_BIND_SERVICE`, `SETUID`, `SETGID` for the root TLS master and unprivileged
workers. Supply writable tmpfs mounts at `/run`, `/var/lib/nginx` and
`/var/cache/nginx`. Add UID/GID 33 tmpfs submounts at
`/var/lib/nginx/{body,proxy,fastcgi,uwsgi,scgi}` and
`/var/cache/nginx/{shenron_images,shenron_hls}`: nginx must find these directories
already owned by its workers because the TLS master has no `CHOWN` capability.
Set the open-file limit to 65535 for the configured worker connections.
SIGQUIT provides graceful shutdown. Logs go to the
container streams; the health check verifies the apex TLS certificate and the
site health endpoint.

The release must qualify nginx syntax against its exact route files and keys,
HTTP/TLS redirects, static content, API/WebSocket forwarding, MCP transport and
public authentication boundaries. Start this gateway only after the existing
DBFR nginx is stopped, and keep a verified rollback before changing DNS. Image
presence alone does not prove production activation.

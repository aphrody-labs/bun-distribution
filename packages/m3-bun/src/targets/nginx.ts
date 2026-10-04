// SPDX-License-Identifier: Apache-2.0
// nginx: a vhost in the shape of the yolo vhosts (`config/host/nginx/<ns>/*.conf`: an `upstream` with keepalive,
// ACME and redirect on :80, TLS on :443, `include snippets/proxy-client-ip.inc`), proxying everything to the one
// Bun process; an HTTP-only variant for a loopback test; and the `routes.json` entry of yolo's route catalog.
// Static files and API share the upstream: the app server already sets cache headers and compresses.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

const upstreamName = (c: TargetContext) => c.name.replace(/-/g, "_");

const proxyBlock = (c: TargetContext, scheme: "http" | "https") => `    location / {
        proxy_pass http://${upstreamName(c)};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        include snippets/proxy-client-ip.inc;
        proxy_set_header X-Forwarded-Proto ${scheme};
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }
`;

const upstream = (c: TargetContext) => `upstream ${upstreamName(c)} {
    server 127.0.0.1:${c.port};
    keepalive 16;
}
`;

export const vhost = (c: TargetContext): string => {
  const host = c.domain ?? `${c.name}.example.com`;
  const tls =
    c.tls === "letsencrypt"
      ? `    ssl_certificate /etc/letsencrypt/live/${host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
`
      : `    ssl_certificate ${c.tls.cert};
    ssl_certificate_key ${c.tls.key};
`;
  return `# ${GENERATED_NOTE}
# ${c.name}: M3 app (UI and API from one Bun process on 127.0.0.1:${c.port}).
${upstream(c)}
server {
    listen 80;
    server_name ${host};
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 301 https://${host}$request_uri; }
}

server {
${c.http2 === "listen" ? "    listen 443 ssl http2;" : "    listen 443 ssl;\n    http2 on;"}
    server_name ${host};

${tls}    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 2m;

${proxyBlock(c, "https")}}
`;
};

/** Same proxy on a loopback HTTP port, for a smoke test with no certificate. */
export const httpVhost = (c: TargetContext, listen = 8080): string => `# ${GENERATED_NOTE}
# ${c.name}: HTTP-only variant for local tests.
${upstream(c)}
server {
    listen 127.0.0.1:${listen};
    server_name _;
    client_max_body_size 2m;

${proxyBlock(c, "http")}}
`;

export const routeEntry = (c: TargetContext) => ({
  host: c.domain ?? `${c.name}.example.com`,
  service: c.name,
  upstream: `127.0.0.1:${c.port}`,
  probePath: "/healthz",
  vhost: `nginx/${c.namespace}/${c.name}.conf`,
});

export const nginx: Target = {
  id: "nginx",
  title: "nginx",
  description: "TLS vhost proxying to the Bun process, an HTTP-only variant, and the routes.json entry",
  generate(c): GeneratedFile[] {
    return [
      { path: `${c.name}.conf`, content: vhost(c) },
      { path: `${c.name}.http.conf`, content: httpVhost(c) },
      { path: "routes.entry.json", content: `${JSON.stringify(routeEntry(c), null, 2)}\n` },
    ];
  },
};

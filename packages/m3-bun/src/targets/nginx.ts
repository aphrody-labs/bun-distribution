// SPDX-License-Identifier: Apache-2.0
// nginx: a vhost in the shape of the yolo vhosts (`infra/config/host/nginx/<ns>/*.conf`: an `upstream` with keepalive,
// ACME and redirect on :80, TLS on :443, `include snippets/proxy-client-ip.inc`), proxying everything to the one
// Bun process; an HTTP-only variant for a loopback test; and the `routes.json` entry of yolo's route catalog.
// Static files and API share the upstream: the app server already sets cache headers and compresses.
//
// The vhosts are described as the typed model of `crates/infra/infra/src/nginx.rs` (`NginxConfig`) and rendered by
// `aphrody infra nginx render`, the single nginx writer of the workspace. The models are always written; without
// that command on PATH the `.conf` files are replaced by the command that renders them.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

/** `NginxConfig` of `crates/infra/infra/src/nginx.rs`, as its serde JSON. */
export interface NginxModel {
  upstreams: {
    name: string;
    targets: { type: "Tcp" | "UnixSocket"; target: string }[];
    keepalive?: number;
  }[];
  servers: {
    listen_ports: string[];
    server_names?: string[];
    ssl_certificate?: string;
    ssl_certificate_key?: string;
    custom_directives?: string[];
    locations?: {
      path: string;
      proxy_pass?: string;
      proxy_http_version?: string;
      headers?: [string, string][];
      custom_directives?: string[];
    }[];
  }[];
}

const upstreamName = (c: TargetContext) => c.name.replace(/-/g, "_");
const hostOf = (c: TargetContext) => c.domain ?? `${c.name}.example.com`;

const upstream = (c: TargetContext): NginxModel["upstreams"][number] => ({
  name: upstreamName(c),
  targets: [{ type: "Tcp", target: `127.0.0.1:${c.port}` }],
  keepalive: 16,
});

const proxyLocation = (c: TargetContext, scheme: "http" | "https") => ({
  path: "/",
  proxy_pass: `http://${upstreamName(c)}`,
  proxy_http_version: "1.1",
  headers: [
    ["Connection", '""'],
    ["Host", "$host"],
  ] as [string, string][],
  custom_directives: [
    "include snippets/proxy-client-ip.inc",
    `proxy_set_header X-Forwarded-Proto ${scheme}`,
    "proxy_read_timeout 30s",
    "proxy_send_timeout 30s",
  ],
});

/** TLS vhost: ACME and redirect on :80, TLS on :443. */
export const vhostModel = (c: TargetContext): NginxModel => {
  const host = hostOf(c);
  const tls =
    c.tls === "letsencrypt"
      ? {
          ssl_certificate: `/etc/letsencrypt/live/${host}/fullchain.pem`,
          ssl_certificate_key: `/etc/letsencrypt/live/${host}/privkey.pem`,
          custom: ["include /etc/letsencrypt/options-ssl-nginx.conf", "ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem"],
        }
      : {
          ssl_certificate: c.tls.cert,
          ssl_certificate_key: c.tls.key,
          custom: [],
        };
  const listen = c.http2 === "listen" ? "443 ssl http2" : "443 ssl";
  return {
    upstreams: [upstream(c)],
    servers: [
      {
        listen_ports: ["80"],
        server_names: [host],
        locations: [
          {
            path: "^~ /.well-known/acme-challenge/",
            custom_directives: ["root /var/www/letsencrypt", "default_type text/plain", "try_files $uri =404"],
          },
          {
            path: "/",
            custom_directives: [`return 301 https://${host}$request_uri`],
          },
        ],
      },
      {
        listen_ports: [listen],
        server_names: [host],
        ssl_certificate: tls.ssl_certificate,
        ssl_certificate_key: tls.ssl_certificate_key,
        custom_directives: [
          ...(c.http2 === "listen" ? [] : ["http2 on"]),
          ...tls.custom,
          'add_header Strict-Transport-Security "max-age=31536000" always',
          "client_max_body_size 2m",
        ],
        locations: [proxyLocation(c, "https")],
      },
    ],
  };
};

/** Same proxy on a loopback HTTP port, for a smoke test with no certificate. */
export const httpVhostModel = (c: TargetContext, listen = 8080): NginxModel => ({
  upstreams: [upstream(c)],
  servers: [
    {
      listen_ports: [`127.0.0.1:${listen}`],
      server_names: ["_"],
      custom_directives: ["client_max_body_size 2m"],
      locations: [proxyLocation(c, "http")],
    },
  ],
});

/** Argv of `aphrody infra nginx render`, or undefined when no installed aphrody has it. */
export function nginxRenderer(): string[] | undefined {
  const candidates: string[][] = [];
  const infra = Bun.which("aphrody-infra");
  if (infra) candidates.push([infra, "nginx", "render"]);
  const aphrody = Bun.which("aphrody");
  if (aphrody) candidates.push([aphrody, "infra", "nginx", "render"]);
  return candidates.find(
    argv =>
      Bun.spawnSync([...argv, "--help"], {
        windowsHide: true,
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode === 0,
  );
}

/** Renders a model through `aphrody infra nginx render`. */
export async function renderNginx(renderer: string[], model: NginxModel, comments: string[]): Promise<string> {
  const proc = Bun.spawn([...renderer, ...comments.flatMap(line => ["--comment", line]), "-"], {
    windowsHide: true,
    stdin: new TextEncoder().encode(JSON.stringify(model)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${renderer.join(" ")} failed (${code}): ${stderr.trim()}`);
  return stdout;
}

export const routeEntry = (c: TargetContext) => ({
  host: hostOf(c),
  service: c.name,
  upstream: `127.0.0.1:${c.port}`,
  probePath: "/healthz",
  vhost: `nginx/${c.namespace}/${c.name}.conf`,
});

export const nginx: Target = {
  id: "nginx",
  title: "nginx",
  description:
    "TLS vhost proxying to the Bun process and an HTTP-only variant, rendered by `aphrody infra nginx render`, and the routes.json entry",
  async generate(c): Promise<GeneratedFile[]> {
    const variants = [
      {
        file: `${c.name}.conf`,
        model: vhostModel(c),
        comment: `${c.name}: M3 app (UI and API from one Bun process on 127.0.0.1:${c.port}).`,
      },
      {
        file: `${c.name}.http.conf`,
        model: httpVhostModel(c),
        comment: `${c.name}: HTTP-only variant for local tests.`,
      },
    ];
    const files: GeneratedFile[] = variants.map(v => ({
      path: v.file.replace(/\.conf$/, ".nginx.json"),
      content: `${JSON.stringify(v.model, null, 2)}\n`,
    }));
    const renderer = nginxRenderer();
    const rendered = await Promise.all(
      variants.map(async (v): Promise<GeneratedFile> => {
        if (renderer) {
          return {
            path: v.file,
            content: await renderNginx(renderer, v.model, [GENERATED_NOTE, v.comment]),
          };
        }
        const json = v.file.replace(/\.conf$/, ".nginx.json");
        return {
          path: `${v.file}.todo`,
          content: `# ${GENERATED_NOTE}\n# No \`aphrody infra nginx\` on PATH: render this vhost with\n#   aphrody infra nginx render ${json} > ${v.file}\n`,
        };
      }),
    );
    files.push(...rendered);
    files.push({
      path: "routes.entry.json",
      content: `${JSON.stringify(routeEntry(c), null, 2)}\n`,
    });
    return files;
  },
};

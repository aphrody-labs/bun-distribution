// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

const vhost = await Bun.file(
  new URL(
    "../../../../infra/config/host/nginx/shenron/cdn.dragonballfr.com.conf",
    import.meta.url,
  ),
).text();

test("CDN asset misses use only Shenron's public VFS asset handler", () => {
  const pathMap = vhost.match(
    /map \$request_uri \$shenron_vfs_asset_path \{([^}]+)\}/,
  )?.[1];
  expect(pathMap).toBeDefined();
  expect(pathMap).toContain('default "";');
  expect(pathMap).toMatch(/\[A-Za-z0-9\._~-\]/);
  expect(pathMap).not.toContain("%[0-9A-Fa-f]");

  const assetsLocation = vhost.match(
    /location \^~ \/assets\/ \{\s*limit_except GET HEAD \{\s*deny all;\s*\}\s*add_header Cache-Control "[^"]+";\s*try_files \$uri @vfs_public_asset;\s*\}/,
  )?.[0];
  expect(assetsLocation).toBeDefined();

  const wikiAssetsLocation = vhost.match(
    /location \^~ \/assets\/wiki\/ \{[\s\S]*?try_files \$uri @wiki_alias;/,
  )?.[0];
  expect(wikiAssetsLocation).toBeDefined();

  const fallback = vhost.match(
    /location @vfs_public_asset \{([\s\S]*?)\n    \}/,
  )?.[1];
  expect(fallback).toBeDefined();
  expect(fallback).toContain(
    'if ($shenron_vfs_asset_path = "") { return 404; }',
  );
  expect(fallback).toContain(
    "proxy_pass http://shenron_site/api/v1/vfs/file?path=$shenron_vfs_asset_path;",
  );
  expect(fallback).toContain("proxy_pass_request_headers off;");
  expect(fallback).toContain("proxy_set_header Host dragonballfr.com;");

  const forwardedHeaders = fallback!
    .match(/^\s*proxy_set_header\s+[^;]+;/gm)
    ?.map((header) => header.trim());
  expect(forwardedHeaders).toEqual([
    'proxy_set_header Connection "";',
    "proxy_set_header Host dragonballfr.com;",
    "proxy_set_header Accept $http_accept;",
    "proxy_set_header Range $http_range;",
    "proxy_set_header If-None-Match $http_if_none_match;",
    "proxy_set_header If-Modified-Since $http_if_modified_since;",
  ]);
  expect(fallback).not.toMatch(
    /authorization|cookie|sqlite|SHENRON_VFS_DB|\/api\/v1\/vfs\/(?:query|list|stat)/i,
  );
});

test("NGINX accepts the VFS path map and fallback locations", async () => {
  const docker = Bun.which("docker");
  if (!docker) return;

  const config = vhost.match(/map \$request_uri[\s\S]*?\n\}/)?.[0];
  const assets = vhost.match(/location \^~ \/assets\/ \{[\s\S]*?\n    \}/)?.[0];
  const fallback = vhost.match(
    /location @vfs_public_asset \{[\s\S]*?\n    \}/,
  )?.[0];
  expect(config).toBeDefined();
  expect(assets).toBeDefined();
  expect(fallback).toBeDefined();

  const tempDir = Bun.env.TEMP ?? Bun.env.TMP ?? `${Bun.env.LOCALAPPDATA}/Temp`;
  const temp = `${tempDir}/nginx-vfs-${crypto.randomUUID()}.conf`;
  const nginxConfig = `events {}\nhttp {\n${config}\n upstream shenron_site { server 127.0.0.1:5011; }\n server { listen 8080;\n${assets}\n${fallback}\n }\n}\n`;
  await Bun.write(temp, nginxConfig);
  try {
    const result = Bun.spawnSync([
      docker,
      "run",
      "--rm",
      "--mount",
      `type=bind,source=${temp},target=/etc/nginx/nginx.conf,readonly`,
      "nginx:alpine",
      "nginx",
      "-t",
      "-c",
      "/etc/nginx/nginx.conf",
    ]);
    expect(
      result.exitCode,
      result.stderr.toString() || result.stdout.toString(),
    ).toBe(0);
  } finally {
    await Bun.file(temp).delete();
  }
});

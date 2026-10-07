#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Assemble the public Compose release on DBFR; never print resolved credentials."""

import argparse
import json
import pathlib
import shutil
import subprocess


def hardened(image, user):
    return {
        "image": image,
        "user": user,
        "network_mode": "host",
        "read_only": True,
        "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges:true"],
        "restart": "unless-stopped",
        "tmpfs": ["/tmp:rw,noexec,nosuid,size=64m"],
        "ulimits": {"nofile": {"soft": 65535, "hard": 65535}},
    }


def mount(source, target, readonly=True):
    return {
        "type": "bind",
        "source": str(source),
        "target": target,
        "read_only": readonly,
    }


def health(command, start="30s"):
    return {
        "test": ["CMD", *command],
        "interval": "30s",
        "timeout": "5s",
        "retries": 5,
        "start_period": start,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=pathlib.Path)
    parser.add_argument("--app-compose", required=True, type=pathlib.Path)
    parser.add_argument("--image-id", required=True)
    parser.add_argument("--gateway-image-id", required=True)
    parser.add_argument("--public-vfs", required=True, type=pathlib.Path)
    parser.add_argument("--state-image-id")
    parser.add_argument("--chat-image-id")
    parser.add_argument("--model-path", type=pathlib.Path)
    parser.add_argument("--adapter-path", type=pathlib.Path)
    args = parser.parse_args()
    release = args.release.resolve()
    if release.exists():
        parser.error("fresh release directory required")
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(args.app_compose),
            "config",
            "--no-env-resolution",
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        parser.error("application Compose configuration failed; inspect privately")
    config = json.loads(result.stdout)
    services = config["services"]
    if set(services) != {"site", "bot"}:
        parser.error("application owner must supply exactly site and bot")
    for service in services.values():
        service.pop("build", None)
        service["image"] = args.image_id
    vfs = args.public_vfs.resolve(strict=True)
    if not vfs.is_relative_to(pathlib.Path("/srv/shenron/shared/server")):
        parser.error("public VFS must stay in server shared store")
    services["site"]["environment"]["SHENRON_VFS_DB"] = str(
        pathlib.Path("/var/lib/shenron") / vfs.relative_to("/srv/shenron/shared/server")
    )
    release.mkdir(parents=True)
    nginx = release / "nginx"
    nginx.mkdir()
    owner = pathlib.Path(__file__).resolve().parents[2]
    for source in (owner / "config/host/nginx/shenron").glob("*.conf"):
        shutil.copy2(source, nginx / source.name)
    public = release / "public"
    public.mkdir()
    for source in (owner / "config/host/nginx/shenron/errorpages/dragonballfr").glob(
        "*.html"
    ):
        shutil.copy2(source, public / source.name)
    gateway = hardened(args.gateway_image_id, "0:0")
    gateway.update(
        cap_add=["NET_BIND_SERVICE", "SETUID", "SETGID"],
        tmpfs=[
            "/run:rw,nosuid,size=8m",
            "/var/lib/nginx:rw,nosuid,uid=33,gid=33,size=64m",
            "/var/cache/nginx:rw,nosuid,uid=33,gid=33,size=8m",
            *[
                f"/var/cache/nginx/{name}:rw,nosuid,uid=33,gid=33,size=256m"
                for name in ("shenron_images", "shenron_hls")
            ],
            *[
                f"/var/lib/nginx/{name}:rw,nosuid,uid=33,gid=33,size=32m"
                for name in ("body", "proxy", "fastcgi", "uwsgi", "scgi")
            ],
        ],
        volumes=[
            mount(nginx, "/etc/nginx/conf.d"),
            mount("/etc/aphrody/shenron-tls", "/etc/letsencrypt"),
            mount(public, "/srv/shenron-cdn/site"),
            mount(public / "50x.html", "/var/www/shenron/50x.html"),
            mount("/srv/shenron/shared/site/wiki", "/srv/shenron-cdn/wiki"),
            mount("/srv/shenron/shared/bot/assets", "/srv/shenron-cdn/assets"),
            mount(
                "/srv/shenron/shared/site/public-extra", "/srv/shenron-cdn/site-extra"
            ),
        ],
        healthcheck=health(
            [
                "curl",
                "--fail",
                "--silent",
                "--resolve",
                "dragonballfr.com:443:127.0.0.1",
                "https://dragonballfr.com/api/health",
            ]
        ),
        depends_on={"site": {"condition": "service_healthy"}},
    )
    services["gateway"] = gateway
    state = pathlib.Path("/srv/shenron/shared/state")
    if args.state_image_id:
        if not (state / "VERIFIED.json").is_file():
            parser.error("protected state must be prepared and checksum-verified first")
        pg = hardened(args.state_image_id, "105:111")
        pg.update(
            entrypoint=["/usr/lib/postgresql/18/bin/postgres"],
            command=[
                "-D",
                "/var/lib/postgresql/data",
                "-c",
                "config_file=/etc/postgresql/postgresql.conf",
                "-c",
                "data_directory=/var/lib/postgresql/data",
                "-c",
                "hba_file=/etc/postgresql/pg_hba.conf",
                "-c",
                "ident_file=/etc/postgresql/pg_ident.conf",
                "-c",
                "external_pid_file=/run/postgresql/postgresql.pid",
                "-c",
                "unix_socket_directories=/run/postgresql",
                "-c",
                "listen_addresses=127.0.0.1",
                "-c",
                "logging_collector=off",
                "-c",
                "ssl_cert_file=/etc/postgresql/tls/server.crt",
                "-c",
                "ssl_key_file=/etc/postgresql/tls/server.key",
            ],
            tmpfs=[
                "/run/postgresql:rw,nosuid,uid=105,gid=111,size=16m",
                "/tmp:rw,nosuid,size=16m",
            ],
            volumes=[
                mount(state / "postgres/data", "/var/lib/postgresql/data", False),
                mount(state / "postgres/config", "/etc/postgresql"),
                mount(state / "postgres/tls", "/etc/postgresql/tls"),
            ],
            healthcheck=health(
                [
                    "/usr/lib/postgresql/18/bin/pg_isready",
                    "-h",
                    "127.0.0.1",
                    "-p",
                    "5432",
                ]
            ),
        )
        redis = hardened(args.state_image_id, "104:110")
        redis.update(
            entrypoint=["/usr/bin/redis-server"],
            command=["/etc/redis/redis.conf"],
            volumes=[
                mount(state / "redis/data", "/data", False),
                mount(state / "redis/config", "/etc/redis"),
            ],
            healthcheck=health(["redis-cli", "-h", "127.0.0.1", "PING"]),
        )
        services.update(postgres=pg, redis=redis)
        for name in ("site", "bot"):
            services[name]["depends_on"] = {
                "postgres": {"condition": "service_healthy"},
                "redis": {"condition": "service_healthy"},
            }
    if args.chat_image_id:
        if not args.model_path or not args.adapter_path:
            parser.error("qualified external chat model and adapter paths required")
        chat = hardened(args.chat_image_id, "1000:1000")
        chat.update(
            command=[
                "--model",
                "/models/base.gguf",
                "--lora",
                "/models/adapter.gguf",
                "--alias",
                "shenron-chat-v2",
                "--host",
                "127.0.0.1",
                "--port",
                "8799",
                "--ctx-size",
                "8192",
                "--parallel",
                "1",
                "--threads",
                "4",
                "--threads-batch",
                "4",
                "--jinja",
                "--no-webui",
            ],
            volumes=[
                mount(args.model_path.resolve(strict=True), "/models/base.gguf"),
                mount(args.adapter_path.resolve(strict=True), "/models/adapter.gguf"),
            ],
            healthcheck=health(
                ["curl", "--fail", "--silent", "http://127.0.0.1:8799/health"], "180s"
            ),
        )
        services["chat"] = chat
    (release / "compose.yaml").write_text(json.dumps(config, indent=2) + "\n")
    (release / "deploy.env").write_text(
        "# Immutable image identities are sealed directly in Compose.\n"
    )
    print(
        "Public Compose bundle assembled; seal image/source identities and verify before activation"
    )


if __name__ == "__main__":
    main()

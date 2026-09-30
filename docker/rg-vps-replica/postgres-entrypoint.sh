#!/usr/bin/env bash
set -Eeuo pipefail

extension_root=/replica-extensions
pg_share="$(pg_config --sharedir)/extension"
pg_lib="$(pg_config --pkglibdir)"

if [[ -d "$extension_root/usr/share/postgresql/18/extension" ]]; then
	cp -a "$extension_root/usr/share/postgresql/18/extension/." "$pg_share/"
fi
if [[ -d "$extension_root/usr/lib/postgresql/18/lib" ]]; then
	cp -a "$extension_root/usr/lib/postgresql/18/lib/." "$pg_lib/"
fi
if [[ -f "$extension_root/usr/lib/postgresql/18/lib/pg_graphql.so" ]]; then
	cp -a "$extension_root/usr/lib/postgresql/18/lib/pg_graphql.so" "$pg_lib/pg_graphql.so"
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"

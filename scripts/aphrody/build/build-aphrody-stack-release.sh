#!/usr/bin/env bash
set -Eeuo pipefail

# Immutable Shenron compute release built from one monorepo commit (no site, Web, A2A or UI build).
# The former all-in-one superproject bundle was retired with the submodule layout.
# --plan verifies the real source inputs and prints the selected build commands.
compute_release() {
  local plan=false
  if [[ "${1:-}" = --plan ]]; then plan=true; shift; fi
  [[ $# -le 2 ]] || { echo 'usage: build-aphrody-stack-release.sh --compute-only [--plan] [MONOREPO [COMMIT]]' >&2; return 2; }
  local repo pin out target id stage work binary built
  repo="$(realpath -e -- "${1:-$(dirname -- "${BASH_SOURCE[0]}")/../..}")"
  pin="${2:-$(git -C "$repo" rev-parse HEAD)}"
  [[ "$(uname -s)" = Linux && "$(uname -m)" = x86_64 ]] || { echo 'Linux x86_64 build host required' >&2; return 2; }
  [[ "$pin" =~ ^[0-9a-f]{40}$ ]] && git -C "$repo" cat-file -e "$pin^{commit}" || { echo 'invalid source commit' >&2; return 2; }
  for binary in git tar sha256sum ldd; do command -v "$binary" >/dev/null || { echo "missing $binary" >&2; return 2; }; done
  for binary in Cargo.toml Cargo.lock scripts/build/rust/cargo-serial.sh crates/ai/rag/migrations/0001_shenron_postgres.sql; do
    git -C "$repo" cat-file -e "$pin:$binary" || { echo "source commit lacks $binary" >&2; return 2; }
  done
  # Cargo must not reach outside the exported commit: an external path dependency would escape the pin.
  if git -C "$repo" show "$pin:Cargo.toml" | grep -Eq 'path *= *"\.\./'; then
    echo 'the pinned workspace depends on a path outside the repository' >&2; return 2
  fi
  printf 'source=%s\nmode=compute\nservices=aphrody-shenron-embed,aphrody-ai-http\n' "$pin"
  printf '%s\n' \
    'cargo-serial.sh build --locked --offline --release --target x86_64-unknown-linux-gnu -p aphrody --bin aphrody'
  [[ "$plan" = false ]] || return 0

  out="$(realpath -m -- "${APHRODY_COMPUTE_OUT:-$HOME/.aphrody/private/releases/shenron-compute}")"
  target="$(realpath -m -- "${APHRODY_RELEASE_TARGET_DIR:-$HOME/.cache/aphrody/shenron-compute-target}")"
  id="$(date -u +%Y%m%dT%H%M%SZ)-${pin:0:12}-compute"
  install -d -m 0700 "$out"
  [[ ! -e "$out/$id" ]] || { echo 'release already exists' >&2; return 2; }
  stage="$(mktemp -d "$out/.release.XXXXXXXX")"
  work="$(mktemp -d "$out/.source.XXXXXXXX")"
  mkdir -p "$work/aphrody" "$stage/"{bin,systemd,migrations,ops,.logs}
  git -C "$repo" archive --format=tar "$pin" | tar -xf - -C "$work/aphrody"
  grep -Fq -- '--compute-only' "$work/aphrody/scripts/release/atomic-deploy-aphrody-stack.sh" || {
    echo "source commit lacks the compute adapter; source=$work" >&2; return 2;
  }
  # The release records its own commit; the export has no external source inputs to freeze.
  printf '{\n  "schema": "aphrody-compute-source/v1",\n  "repositoryCommit": "%s",\n  "externalSources": []\n}\n' "$pin" > "$stage/SOURCE.json"
  # The archived wrapper shares the process-wide lock and retains sccache.
  # Two compiler jobs leave headroom for the actual ongoing RAG ingestion.
  (
    cd "$work/aphrody"
    export CARGO_TARGET_DIR="$target" APHRODY_CARGO_JOBS="${APHRODY_CARGO_JOBS:-2}"
    # aphrody-mcp, aphrody-embed and aphrody-llama-daemon are entries of the single multi-call `aphrody` binary.
    scripts/build/rust/cargo-serial.sh build --locked --offline --release --target x86_64-unknown-linux-gnu -p aphrody --bin aphrody > "$stage/.logs/aphrody.log" 2>&1
  ) || { echo "compute build failed; logs=$stage/.logs source=$work" >&2; return 1; }
  for binary in aphrody-mcp aphrody-embed aphrody-llama-daemon; do
    built="$binary"
    # The multi-call dispatch keys on the invocation name; the deploy gate requires one regular
    # executable per service, so each name is its own copy of `aphrody`, not a symlink.
    case "$binary" in aphrody-mcp|aphrody-embed|aphrody-llama-daemon) built=aphrody ;; esac
    install -m 0755 "$target/x86_64-unknown-linux-gnu/release/$built" "$stage/bin/$binary"
    ldd "$stage/bin/$binary" > "$stage/.logs/$binary.ldd"
    ! grep -Fq 'not found' "$stage/.logs/$binary.ldd" || { echo "missing runtime library: $binary" >&2; return 1; }
  done
  for binary in aphrody-ai-http aphrody-shenron-embed; do
    install -m 0644 "$work/aphrody/systemd/$binary.service.example" "$stage/systemd/$binary.service"
  done
  # Compute requires a private environment; it must not start with defaults.
  sed -i 's|EnvironmentFile=-/etc/aphrody/aphrody-ai-http.env|EnvironmentFile=/etc/aphrody/aphrody-ai-http.env|' "$stage/systemd/aphrody-ai-http.service"
  sed -i 's|bin/aphrody-embed serve$|bin/aphrody-embed serve --threads 4|' "$stage/systemd/aphrody-shenron-embed.service"
  install -m 0644 "$work/aphrody/crates/ai/rag/migrations/0001_shenron_postgres.sql" "$stage/migrations/0001_shenron_postgres.sql"
  install -m 0755 "$work/aphrody/scripts/release/atomic-deploy-aphrody-stack.sh" "$stage/ops/atomic-deploy-aphrody-stack.sh"
  # The enclosing private store stays 0700. The release itself must retain
  # traversable directories when installed for the aphrody service account.
  chmod 0755 "$stage" "$stage/bin" "$stage/systemd" "$stage/migrations" "$stage/ops"
  chmod 0700 "$stage/.logs"
  printf '%s\n' "$id" > "$stage/RELEASE_ID"
  printf 'aphrody=%s\n' "$pin" > "$stage/RELEASE_SHA"
  (cd "$stage" && find bin systemd migrations ops -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS && sha256sum RELEASE_ID RELEASE_SHA SOURCE.json >> SHA256SUMS)
  # A build is not a production qualification. Only a separate real-service
  # corpus/model evaluation may write SMOKE.json; the adapter refuses it absent.
  mv -T -- "$stage" "$out/$id"
  printf 'release=%s\nsourceSnapshot=%s\nqualification=pending (no SMOKE.json)\n' "$out/$id" "$work"
}

if [[ "${1:-}" = --compute-only ]]; then
  shift
  compute_release "$@"
  exit $?
fi

usage='usage: build-aphrody-stack-release.sh --compute-only [--plan] [MONOREPO [COMMIT]]'
echo "$usage" >&2
exit 2

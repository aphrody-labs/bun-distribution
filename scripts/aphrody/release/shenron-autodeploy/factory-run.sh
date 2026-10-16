#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH=/home/ubuntu/.bun/bin:/home/ubuntu/.cargo/bin:/usr/local/bin:/usr/bin:/bin
SOURCE=/home/ubuntu/src/shenron
STATE=/home/ubuntu/.config/shenron-autodeploy
WORK=/home/ubuntu/build/transient/shenron-autodeploy
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 dbfr)
[[ $(hostname) == vps-203bea89 && $(id -un) == ubuntu ]] || exit 64
[[ ${1:---run} == --plan || ${1:---run} == --run ]] || exit 64
exec 8>"$STATE/factory.lock"
flock -n 8 || exit 0
if [[ ${1:---run} == --run ]]; then
  bun -e 'const dir="/home/ubuntu/.config/shenron-autodeploy"; const fs=await import("node:fs"); const names=fs.readdirSync(dir).filter(n=>/^factory-run-[0-9]{8}T[0-9]{6}Z\.log$/.test(n)).sort().reverse(); for(const n of names.slice(4)){const p=`${dir}/${n}`; if(fs.lstatSync(p).isFile())fs.unlinkSync(p);}'
  exec > >(tee "$STATE/factory-run-$(date -u +%Y%m%dT%H%M%SZ).log") 2>&1
fi
[[ $(git -C "$SOURCE" branch --show-current) == main ]] || { echo 'Source must be on main'; exit 65; }
[[ -z $(git -C "$SOURCE" status --porcelain) ]] || { echo 'Source has local changes; refusing synchronization'; exit 65; }
if [[ ${1:---run} == --run ]]; then
  git -C "$SOURCE" fetch -q origin main
  git -C "$SOURCE" merge-base --is-ancestor HEAD origin/main || { echo 'Local main diverges or is ahead; refusing synchronization'; exit 65; }
  git -C "$SOURCE" merge --ff-only origin/main
fi
SHA=$(git -C "$SOURCE" rev-parse HEAD)
[[ $SHA =~ ^[a-f0-9]{40}$ ]] || exit 64
ACTIVE=$("${SSH[@]}" "python3 -c 'import json,pathlib; p=pathlib.Path(\"/home/ubuntu/apps/shenron/current/release.json\"); m=json.loads(p.read_text()); print(m.get(\"commit\",m.get(\"revision\",\"\")))'")
printf 'source=%s\nactive=%s\nmode=%s\n' "$SHA" "$ACTIVE" "${1:---run}"
[[ ${1:---run} == --run ]] || exit 0
[[ $SHA != "$ACTIVE" ]] || exit 0
exec 9>/home/ubuntu/build/locks/heavy.lock
flock -w 60 9 || exit 75
if [[ -e "$WORK" ]]; then
  [[ -f "$WORK/.git" && $(git -C "$WORK" rev-parse --show-toplevel) == "$WORK" ]] || exit 65
  [[ -f "$STATE/factory-worktree-owned" && $(<"$STATE/factory-worktree-owned") == "$WORK" ]] || { echo 'Unowned worktree; inspect before replacement'; exit 65; }
  [[ -z $(git -C "$WORK" status --porcelain) ]] || { echo 'Managed worktree has changes; inspect before reuse'; exit 65; }
  if [[ $(git -C "$WORK" rev-parse HEAD) != "$SHA" ]]; then
    git -C "$SOURCE" worktree remove --force "$WORK"
    git -C "$SOURCE" worktree add --detach "$WORK" "$SHA"
  fi
else
  git -C "$SOURCE" worktree add --detach "$WORK" "$SHA"
  printf '%s\n' "$WORK" > "$STATE/factory-worktree-owned"
fi
TRANSFER=$(mktemp -d "$STATE/transfer.XXXXXXXX")
cleanup() { rm -f -- "$TRANSFER/image.tar.zst"; rmdir -- "$TRANSFER"; }
trap cleanup EXIT
cd "$WORK"
export TMPDIR="$TRANSFER"
git submodule update --init -- packages/config
export SHENRON_BUN_EXECUTABLE=/home/ubuntu/.bun/bin/bun-1.4.4
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun run test
bun packages/api/scripts/openapi.ts --check
cargo clippy --locked -p shenron-mcp -p shenron-ffi --all-targets -- -D warnings
cargo test --locked -p shenron-mcp -p shenron-ffi
nice -n 5 cargo build --locked --release -p shenron-mcp -p shenron-ffi
bun packages/koharu/scripts/build-wasm.ts
bun packages/pipeline/scripts/build-re-wasm.ts
mkdir -p dist/vfs dist/mcp/linux-x64
scp -q -o BatchMode=yes -o ConnectTimeout=15 dbfr:/home/ubuntu/apps/shenron/shared/server/data/7b26187/shenron-vfs.public.sqlite dist/vfs/shenron-vfs.public.sqlite
bun scripts/build/bot.ts --target linux-x64
bun scripts/build/server.ts --flavor production --target linux-x64
install -m 0755 target/release/shenron-mcp dist/mcp/linux-x64/shenron-mcp
install -D -m 0755 target/release/libshenron_ffi.so dist/server/linux-x64/native/libshenron_ffi.so
[[ $(git rev-parse HEAD) == "$SHA" ]] || exit 65
docker build -f deploy/docker/Dockerfile --build-arg "SHENRON_REVISION=$SHA" -t "localhost/shenron:$SHA" .
docker run --rm "localhost/shenron:$SHA" version
docker run --rm --entrypoint /usr/local/bin/shenron-bot "localhost/shenron:$SHA" --smoke
docker save "localhost/shenron:$SHA" | zstd -q -T2 -3 > "$TRANSFER/image.tar.zst"
scp -q -o BatchMode=yes -o ConnectTimeout=15 "$TRANSFER/image.tar.zst" "dbfr:$STATE/incoming-$SHA.tar.zst"
"${SSH[@]}" bash "$STATE/receive-image.sh" "$SHA" "$STATE/incoming-$SHA.tar.zst"
printf 'deployed=%s\n' "$SHA"
if [[ -z $(git -C "$WORK" status --porcelain) ]]; then
  git -C "$SOURCE" worktree remove "$WORK"
else
  echo 'Build generated tracked changes; managed worktree retained for inspection'
fi

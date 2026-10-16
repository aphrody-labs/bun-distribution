#!/usr/bin/env bash
# Receive a qualified image built on the factory; never compile on production.
set -euo pipefail
umask 077
sha=${1:?revision required}
archive=${2:?compressed image required}
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 2
base=/home/ubuntu/.config/shenron-autodeploy
[[ $archive == "$base/incoming-$sha.tar.zst" && -f $archive && ! -L $archive ]] || exit 2
root=/home/ubuntu/apps/shenron
adapter=/usr/local/libexec/shenron-autodeploy/atomic-deploy-shenron-container.py
sealer=/usr/local/libexec/shenron-autodeploy/seal-shenron-docker-release.py
assembler=/usr/local/libexec/shenron-autodeploy/assemble-shenron.py
exec 9>"$base/receive.lock"
flock -n 9 || { echo 'Another image delivery is running' >&2; exit 75; }
trap 'rm -f -- "$archive"' EXIT
sudo -n python3 "$adapter" verify "$root/current"
zstd -dc -- "$archive" | sudo -n docker load >/dev/null
image=$(sudo -n docker image inspect --format '{{.Id}}' "localhost/shenron:$sha")
revision=$(sudo -n docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
[[ $revision == "$sha" ]] || { echo 'Image revision mismatch' >&2; exit 2; }
active=$(jq -r .commit "$root/current/release.json")
if [[ $active == "$sha" ]]; then
  echo "Already deployed $sha"
  exit 0
fi
git -C /home/ubuntu/src/shenron cat-file -e "$sha^{commit}"
git -C /home/ubuntu/src/shenron merge-base --is-ancestor "$active" "$sha" || { echo 'Refusing stale or divergent deployment' >&2; exit 2; }
old_image=$(jq -r .imageId "$root/current/release.json")
release=$root/releases/docker-$sha
if [[ ! -e $release ]]; then
  sudo -n python3 "$assembler" "$sha" "$image" >/dev/null
fi
if [[ ! -f $release/release.json ]]; then
  args=(--commit "$sha" --image-id "$image" --public-vfs "$(jq -r .publicVfs.path "$root/current/release.json")")
  for role in gateway postgres redis chat; do
    role_image=$(jq -r --arg role "$role" '.images[$role].id // empty' "$root/current/release.json")
    [[ -n $role_image ]] || continue
    role_commit=$(jq -r --arg role "$role" '.images[$role].commit' "$root/current/release.json")
    if [[ $role == gateway ]]; then args+=(--gateway-image-id "$role_image" --gateway-commit "$role_commit");
    else args+=(--service-image "$role" "$role_image" "$role_commit"); fi
  done
  sudo -n python3 "$sealer" "$release" "${args[@]}"
fi
sudo -n python3 "$adapter" verify "$release"
sudo -n python3 "$adapter" activate "$release"
[[ $(jq -r .commit "$root/current/release.json") == "$sha" ]] || exit 2
curl --fail --silent --show-error --max-time 30 https://dragonballfr.com/api/health >/dev/null
# The canonical adapter creates a small transactional rollback receipt, not a data backup.
# Remove only receipts for this successful delivery, honoring the no-archive preference.
while IFS= read -r -d '' receipt; do
  [[ $(sudo -n jq -r .target "$receipt") == "$release" ]] || continue
  directory=${receipt%/ROLLBACK.json}
  [[ $directory == "$root/deploy-backups/"docker-* ]] || exit 2
  sudo -n rm -- "$receipt"
  sudo -n rmdir -- "$directory"
done < <(sudo -n find "$root/deploy-backups" -mindepth 2 -maxdepth 2 -type f -name ROLLBACK.json -print0)
printf 'Deployed %s; public health verified\n' "$sha"
if [[ $old_image != "$image" && -z $(sudo -n docker ps -aq --filter "ancestor=$old_image") ]]; then
  sudo -n docker image rm "$old_image" >/dev/null || echo 'Previous image cleanup requires inspection' >&2
fi

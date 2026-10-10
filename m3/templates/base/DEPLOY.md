# Deploy

One archive, no Bun or Rust toolchain on the server:

```bash
bun run build:bin       # dist/__NAME__: the server compiled into one executable
bun run pack:deploy     # dist/__NAME__-<target>.tar.gz: executable + runtime library + run.sh + systemd unit
```

On a server of the same OS and architecture:

```bash
sudo mkdir -p /opt/__NAME__ && sudo tar -xzf __NAME__-<target>.tar.gz -C /opt/__NAME__ --strip-components=1
sudo cp /opt/__NAME__/__NAME__.service /etc/systemd/system/ && sudo systemctl enable --now __NAME__
```

`Dockerfile` wraps the same archive. The runtime library is found through `YOLO_RUNTIME_LIB`, which
`run.sh` sets. A different target needs the archive built on (or cross-built for) that target together
with its own runtime artifact (`yolo runtime` / the yolo release for that target).

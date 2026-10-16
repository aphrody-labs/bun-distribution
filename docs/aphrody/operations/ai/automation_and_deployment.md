# Aphrody Automation & Deployment Guide

This guide explains how to automate, package, test, and deploy the keyless `aphrody` Python package and its dependencies.

---

## 1. Automated Headless Setup

The `aphrody setup` command configures the local Google Cloud SDK credentials, IAM policy bindings, and enabled APIs. It normally runs interactively, but can be fully automated using environment variables or command-line parameters.

### CLI Overrides

Pass settings directly via CLI flags:

```bash
uv run aphrody setup \
  --project=my-custom-project-id \
  --service_account=my-custom-sa@my-custom-project-id.iam.gserviceaccount.com \
  --location=europe-west9
```

### Environment Variable Overrides

Alternatively, set environment variables prior to running the setup command:

```bash
# Set variables
export APHRODY_PROJECT_ID="my-custom-project-id"
export APHRODY_SERVICE_ACCOUNT="my-custom-sa@my-custom-project-id.iam.gserviceaccount.com"
export APHRODY_LOCATION="europe-west9"

# Execute headless setup
uv run aphrody setup
```

### Headless Verification Flow

When running headlessly (either with CLI overrides or environment variables, without `-i` or `--interactive` flag):
1. **Repository root** is dynamically resolved (searches parent folders containing `.git`).
2. **`gcloud` CLI installation** is checked.
3. **Secrets Directory** (`var/secrets/` (not in repo) in-repo or `~/.aphrody`) is created with locked permissions (`0700`).
4. **Service account keys** are created and saved securely (`0600` permissions).
5. **GCloud authorization** activates the service account key.
6. **IAM Policy** adds owner bindings to the service account.
7. **APIs** are batch-enabled for the project.
8. **`.env` configuration file** is generated with forward slashes, locked to `0600` permissions.
9. **Access token** print is tested.

---

## 2. Packaging & Verification Pipeline

We supply an automated verification tool to test, lint, format, and package the repository.

```bash
uv run python aphrody/scripts/build_verify.py
```

This script performs a 4-stage pipeline:

```mermaid
graph TD
    A[Start Pipeline] --> B[Stage 1: Ruff Check & Format]
    B --> C[Stage 2: Pytest local suite]
    C --> D[Stage 3: Package Build]
    D --> E[Stage 4: Verification of wheel artifact]
    E --> F[Pipeline Complete]
```

- **Stage 1 (Linter & Formatter)**: Runs `ruff check` and `ruff format --check`.
- **Stage 2 (Local Unit Tests)**: Runs `pytest -m "not live_api"`.
- **Stage 3 (Package Build)**: Cleans older builds and executes `uv build --package aphrody --wheel` (or fallback `python -m build`).
- **Stage 4 (Artifact Verification)**: Validates that the `.whl` package exists and has a non-trivial file size.

---

## 3. Autopilot Background Loops

The repository includes loop scripts to run background tasks continuously (e.g. for continuous development or cron operations). The loop reads tasks from `docs/PLAN.md` (not in repo), starts executing them with Claude Code, audits them with Gemini, and marks them completed.

### Linux (Bash)

To start the Linux loop from the repository root:
```bash
./py/aphrody/scripts/autopilot.sh --interval 60 &
```
- **Interval**: Frequency of execution ticks (in seconds).
- **Max Ticks**: Exits after a set number of loops (e.g., `--max-ticks 10`).
- **Single Run**: `--once` runs a single tick and exits.
- **Process ID**: Logged to `var/run/autopilot.pid` (not in repo).
- **Logs**: Written as NDJSON format to `var/log/autopilot.jsonl` (not in repo).
- **Heartbeats**: Emitted to `ai/heartbeat.txt`.
- **Current plan behavior**: the delivery plan uses work packages rather than
  `⏳` task markers, so this legacy loop remains idle unless a matching marker is
  deliberately added.
---

## 4. VPS systemd Integration

Deploying to a Linux VPS is owned by Workspace/Infra. The installed native CLI
exposes the deploy adapters and cataloged service lifecycle:

```bash
aphrody infra deploy --help
aphrody infra service --help
```

The [service catalogue](../../../../infra/config/service-catalog.json) selects the
service and host. Its [systemd units](../../../../infra/config/host/systemd/aphrody)
are the versioned templates.

### Serving React / SPA Web App

Build the site's declared artifact and select its deploy adapter from the native
CLI. Deployment mutation requires `--apply` and an explicit target, as described
by the installed help.

### Supervising a Rust Backend

Deliver the qualified Rust artifact through its deploy adapter. Manage its
cataloged systemd service with `aphrody infra service`; use the installed help
for the available lifecycle actions and target selection.

### HARDENING / SECURITY
- A system-level `aphrody` service user is created with home directory `/opt/aphrody` and shell `/usr/sbin/nologin`.
- Files in `/etc/aphrody` and home directories are strictly chowned to `aphrody:aphrody`.
- Environment variable configuration files (`/etc/aphrody/serve.env`) are kept isolated.
- systemd configurations limit memory usage using `MemoryHigh=2G` and `MemoryMax=4G`.

---

## 5. Dockerized Deployment

You can build and run `aphrody` inside a lightweight container.

### Build the Image
```bash
docker build -f aphrody/deploy/Dockerfile -t aphrody-serve aphrody
```

### Run the Container
Mount your built React/static front-end folder at `/home/ubuntu/apps/site`:
```bash
docker run --rm -p 8080:8080 -v /path/to/dist:/home/ubuntu/apps/site:ro aphrody-serve
```

To reverse-proxy API requests (e.g. `/api/*`) to a running backend at `http://backend:3000`, override the container entrypoint or run:
```bash
docker run --rm -p 8080:8080 \
  -v /path/to/dist:/home/ubuntu/apps/site:ro \
  aphrody-serve \
  sh -c 'aphrody serve "/home/ubuntu/apps/site" --host "0.0.0.0" --port 8080 --proxy "http://backend:3000" --cache'
```

---

## 6. Permissions and Hardening Guidelines

To prevent host cookie or service account credential leakages, `aphrody` enforces strict owner-only permissions:
- On POSIX: Directory permissions are locked to `0700` and files to `0600`.
- On Windows: Inheritance is disabled using `icacls`, granting Full Control (`(F)`) only to the executing user.

If you encounter permission issues in automated pipelines:
1. Ensure the running process user has ownership of the directories.
2. In non-Windows docker containers, files inside mounted volumes might complain if the container user doesn't map to host file owner IDs. Use `USER root` during setup if mounting host paths, or run chown accordingly inside the container.

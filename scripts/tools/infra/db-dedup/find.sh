#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# list candidate db/dump/archive files: size<TAB>mtime<TAB>inode:links<TAB>path
ROOTS="${ROOTS:-/}"
sudo -n find $ROOTS -xdev \
  \( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /mnt -o -path /usr -o -path /snap \
     -o -path /var/lib/docker -o -path /var/lib/containerd -o -path /var/lib/snapd -o -path /var/lib/command-not-found \
     -o -path /var/lib/postgresql -o -path /var/cache -o -path /var/lib/apt -o -path /var/lib/dpkg -o -path /var/lib/rpm -o -path /var/lib/plocate -o -path /var/lib/mlocate \
     -o -path /tmp/dbdedup \
     -o -name node_modules -o -name target -o -name .cache -o -name .codex -o -name .gemini -o -name .mozilla \
     -o -name google-chrome -o -name chromium -o -name BraveSoftware -o -name .rustup -o -name .cargo -o -name .bun -o -name .npm \
     -o -name .git -o -name __pycache__ -o -name .venv -o -name venv -o -name site-packages -o -name .nvm -o -name .vscode-server -o -name .cursor-server \
     -o -path '*/source' -o -path '*/aphrody/upstream' -o -name ms-playwright -o -name .local/share/Trash \) -prune -o \
  -type f \( -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' -o -iname '*.db3' -o -iname '*.dump' -o -iname '*.pgdump' -o -iname '*.backup' \
     -o -iname '*.sql' -o -iname '*.sql.gz' -o -iname '*.sql.zst' -o -iname '*.sql.xz' -o -iname '*.sql.bz2' -o -iname '*.db.gz' -o -iname '*.sqlite.gz' -o -iname '*.db.zst' \
     -o \( \( -iname '*.tar' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.tar.zst' -o -iname '*.tar.xz' -o -iname '*.zip' -o -iname '*.7z' \) \
          \( -ipath '*backup*' -o -ipath '*dump*' -o -ipath '*supabase*' -o -ipath '*sauvegarde*' -o -ipath '*snapshot*' -o -ipath '*postgres*' -o -iname '*db*' -o -iname '*sql*' \) \) \) \
  -size +0 -printf '%s\t%TY-%Tm-%TdT%TH:%TM\t%i:%n\t%p\n' 2>/dev/null

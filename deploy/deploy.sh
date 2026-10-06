#!/usr/bin/env bash
# Redeploy the current checkout: pull, install, build, migrate, restart.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

export PATH="$HOME/.bun/bin:$PATH"

if [ "${1:-}" != "--no-pull" ]; then
	echo "==> git pull"
	git pull --ff-only
fi

echo "==> install"
bun install --frozen-lockfile

echo "==> build"
bun run build

echo "==> migrate"
bun run db:migrate

echo "==> restart"
sudo systemctl restart prinzeugen
sleep 1
sudo systemctl --no-pager --lines=5 status prinzeugen

#!/usr/bin/env bash
# Installs (or refreshes) the systemd service and the weekly backup timer.
# Env overrides: APP_USER (defaults to current user), BUN (path to bun binary).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-$USER}"
BUN="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"

render() {
	sed \
		-e "s|__APP_DIR__|$APP_DIR|g" \
		-e "s|__APP_USER__|$APP_USER|g" \
		-e "s|__BUN__|$BUN|g" \
		"$1"
}

for unit in prinzeugen.service prinzeugen-backup.service prinzeugen-backup.timer; do
	render "$APP_DIR/deploy/systemd/$unit" | sudo tee "/etc/systemd/system/$unit" >/dev/null
	echo "installed /etc/systemd/system/$unit"
done

chmod +x "$APP_DIR"/deploy/*.sh

sudo systemctl daemon-reload
sudo systemctl enable --now prinzeugen.service
sudo systemctl enable --now prinzeugen-backup.timer
sudo systemctl restart prinzeugen.service

echo
if [ ! -f "$APP_DIR/frontend/dist/index.html" ]; then
	echo "WARNING: no frontend build at frontend/dist. Run 'bun run build' and 'sudo systemctl restart prinzeugen'."
	echo
fi
sudo systemctl --no-pager --lines=3 status prinzeugen.service || true
echo
sudo systemctl list-timers prinzeugen-backup.timer --no-pager

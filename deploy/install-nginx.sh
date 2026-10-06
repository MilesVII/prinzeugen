#!/usr/bin/env bash
# Installs the nginx site for the given domain, pointing at the bun server.
#   ./deploy/install-nginx.sh dash.example.com
# TLS: sudo apt-get install certbot python3-certbot-nginx && sudo certbot --nginx -d dash.example.com
set -euo pipefail

DOMAIN="${1:?usage: install-nginx.sh <domain>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-7780}"

sed \
	-e "s|__DOMAIN__|$DOMAIN|g" \
	-e "s|__PORT__|$PORT|g" \
	"$APP_DIR/deploy/nginx.conf.example" | sudo tee /etc/nginx/sites-available/prinzeugen >/dev/null

sudo ln -sf /etc/nginx/sites-available/prinzeugen /etc/nginx/sites-enabled/prinzeugen
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
echo "nginx site installed for $DOMAIN -> 127.0.0.1:$PORT"

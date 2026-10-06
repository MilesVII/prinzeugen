#!/usr/bin/env bash
# One-time provisioning of an Ubuntu host. Idempotent, safe to re-run.
#
#   git clone <repo> ~/prinzeugen && cd ~/prinzeugen
#   cp .env.example .env && $EDITOR .env
#   ./deploy/bootstrap.sh [--domain dash.example.com] [--with-tor]
#
# Installs postgres, nginx, ffmpeg and bun, creates the database role and database
# from DB_CONNECTION, builds the frontend, runs migrations, installs the systemd
# service and the weekly backup timer. With --domain it also installs an nginx site.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-$USER}"
DOMAIN=""
WITH_TOR=0

while [ $# -gt 0 ]; do
	case "$1" in
		--domain) DOMAIN="$2"; shift 2 ;;
		--with-tor) WITH_TOR=1; shift ;;
		*) echo "unknown argument: $1"; exit 1 ;;
	esac
done

cd "$APP_DIR"

if [ ! -f .env ]; then
	cp .env.example .env
	echo "Created .env from .env.example. Fill in DB_CONNECTION, PUBLIC_URL, TG_TOKEN, TG_TARGET_ME and re-run."
	exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

echo "==> apt packages"
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql postgresql-contrib nginx ffmpeg curl unzip git
if [ "$WITH_TOR" = "1" ]; then
	sudo apt-get install -y -qq tor
	sudo systemctl enable --now tor
fi
sudo systemctl enable --now postgresql

echo "==> bun"
if ! command -v bun >/dev/null 2>&1; then
	curl -fsSL https://bun.sh/install | bash
	export PATH="$HOME/.bun/bin:$PATH"
fi
BUN="$(command -v bun)"
echo "using $BUN ($("$BUN" --version))"

echo "==> database"
read -r DB_USER DB_PASS DB_NAME < <("$BUN" -e '
	const u = new URL(process.env.DB_CONNECTION);
	console.log(decodeURIComponent(u.username), decodeURIComponent(u.password), u.pathname.slice(1));
')
if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
	echo "DB_CONNECTION must look like postgresql://user:password@host:5432/database"
	exit 1
fi
ESCAPED_PASS="${DB_PASS//\'/\'\'}"
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname = '$DB_USER'" | grep -q 1; then
	sudo -u postgres psql -v ON_ERROR_STOP=1 -c "create role \"$DB_USER\" login password '$ESCAPED_PASS'"
	echo "created role $DB_USER"
else
	sudo -u postgres psql -v ON_ERROR_STOP=1 -c "alter role \"$DB_USER\" with password '$ESCAPED_PASS'"
fi
if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
	sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
	echo "created database $DB_NAME"
fi

echo "==> build"
"$BUN" install --frozen-lockfile
"$BUN" run build
"$BUN" run db:migrate

echo "==> services"
APP_USER="$APP_USER" BUN="$BUN" "$APP_DIR/deploy/install-services.sh"

if [ -n "$DOMAIN" ]; then
	echo "==> nginx"
	"$APP_DIR/deploy/install-nginx.sh" "$DOMAIN"
fi

echo
echo "Done. Next steps:"
echo "  bun run user create <name> --admin      # first account"
if [ -n "$DOMAIN" ]; then
	echo "  sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
fi
echo "  systemctl status prinzeugen"

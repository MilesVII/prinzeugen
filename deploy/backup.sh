#!/usr/bin/env bash
# Dumps the database, sends it to TG_TARGET_ME via the TG_TOKEN bot, and reports failures.
# Reads .env from the repository root. Optional BACKUP_DIR keeps local copies for 8 weeks.
# Installed as a weekly systemd timer by deploy/install-services.sh; can also be run by hand.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env"
set +a

: "${DB_CONNECTION:?DB_CONNECTION missing in .env}"
: "${TG_TOKEN:?TG_TOKEN missing in .env}"
: "${TG_TARGET_ME:?TG_TARGET_ME missing in .env}"

TG_API="https://api.telegram.org/bot$TG_TOKEN"
TIMESTAMP="$(date +"%Y-%m-%d_%H-%M-%S")"
OUT_DIR="${BACKUP_DIR:-$(mktemp -d)}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/prinzeugen-$TIMESTAMP.sql.gz"

notify() {
	curl -fsS -X POST "$TG_API/sendMessage" \
		-d chat_id="$TG_TARGET_ME" \
		--data-urlencode text="$1" >/dev/null
}

if pg_dump --dbname="$DB_CONNECTION" --format=plain --no-owner --no-privileges | gzip -9 > "$FILE"; then
	SIZE="$(du -h "$FILE" | cut -f1)"
	if curl -fsS -X POST "$TG_API/sendDocument" \
		-F chat_id="$TG_TARGET_ME" \
		-F document=@"$FILE" \
		-F caption="prinzeugen backup $TIMESTAMP ($SIZE)" >/dev/null
	then
		echo "backup sent ($SIZE)"
	else
		notify "Achtung! prinzeugen backup was created but could not be uploaded ($FILE on $(hostname))"
		echo "upload failed" >&2
	fi
else
	rm -f "$FILE"
	notify "Achtung! prinzeugen backup failed on $(hostname)"
	echo "pg_dump failed" >&2
	exit 1
fi

if [ -n "${BACKUP_DIR:-}" ]; then
	find "$BACKUP_DIR" -name "prinzeugen-*.sql.gz" -mtime +56 -delete
else
	rm -rf "$OUT_DIR"
fi

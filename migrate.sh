#!/usr/bin/env bash
set -e

CALENDAR_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$CALENDAR_DIR/instance/events.db"

if [[ ! -f "$DB" ]]; then
    echo "ERROR: DB not found at $DB"
    exit 1
fi

BAK="${DB}.pre-migration-$(date +%Y%m%d).bak"
echo "==> Backing up $DB"
cp "$DB" "$BAK"
echo "    Written: $BAK"

echo "==> Running migrations..."
cd "$CALENDAR_DIR"
uv run flask db upgrade
echo "    Done."

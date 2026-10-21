#!/bin/sh
# Hot backup of the team-platform database.
# VACUUM INTO a temporary file and rename (report 03, 2026-10-20: 123 ms with an active
# writer; cp can leave an inconsistent copy and backup() restarts with every write).
#
# Usage:  scripts/backup.sh
# Output: $DEST/team-<UTC date>.db, checked with integrity_check.
#
# Variables:
#   DEST         host folder where the backup is left (default ./backups)
#   SERVICE      name of the service in the compose file (default team-platform)
#   WITH_FILES   1 adds a tar with the attachments and the edited templates from /data
#   COMPOSE_FILE, COMPOSE_PROJECT_NAME: docker compose's own, if the service lives in another project
set -eu

SERVICE="${SERVICE:-team-platform}"
DEST="${DEST:-./backups}"
WITH_FILES="${WITH_FILES:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="team-$STAMP.db"

mkdir -p "$DEST"

# Inside the container: consistent snapshot to a temporary file, check and rename.
docker compose exec -T "$SERVICE" node -e '
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const dataDir = process.env.DATA_DIR || "/data";
const source = process.env.DB_PATH || dataDir + "/team.db";
const dir = dataDir + "/backups";
const final = dir + "/" + process.argv[1];
const tmp = final + ".tmp";
fs.mkdirSync(dir, { recursive: true });
fs.rmSync(tmp, { force: true });
const db = new DatabaseSync(source, { timeout: 5000 });
db.exec("VACUUM INTO \x27" + tmp + "\x27");
db.close();
const copy = new DatabaseSync(tmp, { readOnly: true });
const check = copy.prepare("PRAGMA integrity_check").get().integrity_check;
copy.close();
if (check !== "ok") { fs.rmSync(tmp, { force: true }); console.error("integrity_check: " + check); process.exit(1); }
fs.renameSync(tmp, final);
' "$NAME"

# To the host, also with a temporary file and rename; then the volume is freed.
docker compose cp "$SERVICE:/data/backups/$NAME" "$DEST/$NAME.tmp"
mv "$DEST/$NAME.tmp" "$DEST/$NAME"
docker compose exec -T "$SERVICE" rm -f "/data/backups/$NAME"

if [ "$WITH_FILES" = "1" ]; then
  docker compose exec -T "$SERVICE" sh -c '
    cd "${DATA_DIR:-/data}"
    dirs=""
    for d in attachments templates; do [ -d "$d" ] && dirs="$dirs $d"; done
    [ -n "$dirs" ] && tar -cf - $dirs
  ' > "$DEST/files-$STAMP.tar.tmp"
  mv "$DEST/files-$STAMP.tar.tmp" "$DEST/files-$STAMP.tar"
  echo "files: $DEST/files-$STAMP.tar"
fi

echo "database: $DEST/$NAME"

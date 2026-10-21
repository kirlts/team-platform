#!/bin/sh
# Respaldo en caliente de la base de team-platform.
# VACUUM INTO a un temporal y rename (informe 03, 2026-10-20: 123 ms con un escritor
# activo; cp puede dejar una copia inconsistente y backup() se reinicia con cada escritura).
#
# Uso:    scripts/backup.sh
# Salida: $DEST/team-<fecha UTC>.db, comprobado con integrity_check.
#
# Variables:
#   DEST         carpeta del anfitrión donde queda el respaldo (por omisión ./backups)
#   SERVICE      nombre del servicio en el compose (por omisión team-platform)
#   WITH_FILES   1 agrega un tar con los adjuntos y las plantillas editadas de /data
#   COMPOSE_FILE, COMPOSE_PROJECT_NAME: los de docker compose, si el servicio vive en otro proyecto
set -eu

SERVICE="${SERVICE:-team-platform}"
DEST="${DEST:-./backups}"
WITH_FILES="${WITH_FILES:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="team-$STAMP.db"

mkdir -p "$DEST"

# Dentro del contenedor: instantánea consistente a un temporal, comprobación y rename.
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

# Al anfitrión, también con temporal y rename; después se libera el volumen.
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
  echo "archivos: $DEST/files-$STAMP.tar"
fi

echo "base: $DEST/$NAME"

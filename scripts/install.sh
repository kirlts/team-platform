#!/bin/sh
# Instalación de team-platform en un VPS con Docker.
# Crea .env desde .env.example pidiendo lo mínimo y levanta el servicio.
#
# Uso:    scripts/install.sh [--no-start]
# Sin terminal interactiva, toma ADMIN_EMAIL, ANTHROPIC_API_KEY y GROQ_API_KEY del entorno.
# Un .env existente no se modifica.
# Además: activa el gancho de pre-commit contra credenciales en este clon (core.hooksPath) y deja la lista de
# contraseñas bloqueadas en el volumen de datos si no está.
set -eu

START=1
[ "${1:-}" = "--no-start" ] && START=0

cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { echo "Falta docker." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta el plugin docker compose." >&2; exit 1; }
[ -f .env.example ] || { echo "Falta .env.example." >&2; exit 1; }

# Gancho de pre-commit contra credenciales (H-42, DT-004): git no activa por sí solo un directorio de ganchos
# versionado. Sin esto, un clon nuevo no tiene la protección que la batería da por puesta.
if [ -d .githooks ] && command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  git config core.hooksPath .githooks
  echo "Gancho de pre-commit activado (core.hooksPath=.githooks)."
fi

# Lista de contraseñas no permitidas (H-43, informe 04 §1.5 y §8). Fuente: SecLists, de Daniel Miessler, licencia MIT
# (https://github.com/danielmiessler/SecLists/blob/master/LICENSE, leída el 2026-10-21). Archivo: las 1.000.000
# contraseñas más comunes del conjunto xato-net-10-million-passwords. Fijado a un commit (consultado el
# 2026-10-20) y verificado por SHA-256, para que lo descargado sea siempre lo mismo.
BLOCKLIST_COMMIT=0c03d70db30ceedb941ac58b0ec910eb85906d6f
# BLOCKLIST_URL y BLOCKLIST_SHA256 del entorno reemplazan la fuente (un espejo propio; las pruebas).
BLOCKLIST_URL="${BLOCKLIST_URL:-https://raw.githubusercontent.com/danielmiessler/SecLists/$BLOCKLIST_COMMIT/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt}"
BLOCKLIST_SHA256="${BLOCKLIST_SHA256:-424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51}"

# in_volume CMD: corre CMD (sh) en un contenedor del servicio, con el volumen de datos montado.
in_volume() {
  docker compose run --rm -T --no-deps --entrypoint sh team-platform -c "$1"
}

# install_blocklist: baja la lista a $DATA_DIR/password-blocklist.txt del volumen, si no está. La aplicación la usa
# sola cuando PASSWORD_BLOCKLIST_FILE no está definida. Se guardan sólo las entradas con el largo mínimo de contraseña
# (PASSWORD_MIN_LENGTH, 15 por omisión): las más cortas ya las rechaza la validación de largo. Si se baja el mínimo en
# .env, se borra el archivo del volumen y se corre de nuevo. Sin red o con otro contenido, avisa y sigue: el servicio
# funciona sin la lista, validando sólo el largo.
install_blocklist() {
  if in_volume 'test -s "$DATA_DIR/password-blocklist.txt"' >/dev/null 2>&1; then
    echo "Lista de contraseñas bloqueadas: ya está en el volumen."
    return 0
  fi
  min="$(sed -n 's/^PASSWORD_MIN_LENGTH=\([0-9][0-9]*\)$/\1/p' .env | head -n 1)"
  min="${min:-15}"
  work="$(mktemp -d)"
  if ! command -v curl >/dev/null 2>&1; then
    echo "Aviso: falta curl; la lista de contraseñas bloqueadas no se instaló." >&2
  elif ! curl -fsSL --max-time 120 -o "$work/raw.txt" "$BLOCKLIST_URL"; then
    echo "Aviso: no se pudo bajar la lista de contraseñas bloqueadas de $BLOCKLIST_URL." >&2
  elif [ "$( (sha256sum "$work/raw.txt" 2>/dev/null || shasum -a 256 "$work/raw.txt") | cut -d' ' -f1)" != "$BLOCKLIST_SHA256" ]; then
    echo "Aviso: la lista bajada no coincide con el SHA-256 esperado; no se instaló." >&2
  else
    tr -d '\r' < "$work/raw.txt" | awk -v min="$min" 'length($0) >= min' > "$work/list.txt"
    in_volume 'umask 077; cat > "$DATA_DIR/password-blocklist.txt"' < "$work/list.txt"
    echo "Lista de contraseñas bloqueadas instalada: $(wc -l < "$work/list.txt" | tr -d ' ') entradas de $min o más caracteres."
  fi
  rm -rf "$work"
}

# set_var NOMBRE VALOR: reemplaza NOMBRE= en .env sin interpretar el valor.
set_var() {
  VAR_NAME="$1" VAR_VALUE="$2" awk '
    BEGIN { n = ENVIRON["VAR_NAME"]; v = ENVIRON["VAR_VALUE"] }
    index($0, n "=") == 1 { print n "=" v; next }
    { print }
  ' .env > .env.tmp
  mv .env.tmp .env
}

# ask NOMBRE "Rótulo" secreto(0|1): usa el entorno si hay valor; si no, pregunta.
ask() {
  name="$1"; label="$2"; secret="$3"
  eval "value=\${$name:-}"
  if [ -z "$value" ] && [ -t 0 ]; then
    printf '%s: ' "$label" >&2
    if [ "$secret" = "1" ]; then
      stty -echo; read -r value || value=""; stty echo; printf '\n' >&2
    else
      read -r value || value=""
    fi
  fi
  if [ -n "$value" ]; then set_var "$name" "$value"; else echo "$name queda vacío." >&2; fi
}

if [ -f .env ]; then
  echo ".env existe: no se modifica."
else
  umask 077
  cp .env.example .env
  ask ADMIN_EMAIL "Correo del primer Editor" 0
  ask ANTHROPIC_API_KEY "Llave de Anthropic" 1
  ask GROQ_API_KEY "Llave de Groq (audio y video, Enter para omitir)" 1
  echo ".env creado (modo 600)."
fi

if [ "$START" = "1" ]; then
  docker compose build
  install_blocklist
  docker compose up -d --wait
  PORT_PUBLISHED="$(sed -n 's/^PUBLISH_PORT=\(.\+\)$/\1/p' .env | head -n 1)"
  echo "Servicio arriba en http://127.0.0.1:${PORT_PUBLISHED:-3000}"
fi

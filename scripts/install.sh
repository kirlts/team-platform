#!/bin/sh
# Instalación de team-platform en un VPS con Docker.
# Crea .env desde .env.example pidiendo lo mínimo y levanta el servicio.
#
# Uso:    scripts/install.sh [--no-start]
# Sin terminal interactiva, toma ADMIN_EMAIL, ANTHROPIC_API_KEY y GROQ_API_KEY del entorno.
# Un .env existente no se modifica.
set -eu

START=1
[ "${1:-}" = "--no-start" ] && START=0

cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { echo "Falta docker." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta el plugin docker compose." >&2; exit 1; }
[ -f .env.example ] || { echo "Falta .env.example." >&2; exit 1; }

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
  docker compose up -d --build --wait
  PORT_PUBLISHED="$(sed -n 's/^PUBLISH_PORT=\(.\+\)$/\1/p' .env | head -n 1)"
  echo "Servicio arriba en http://127.0.0.1:${PORT_PUBLISHED:-3000}"
fi

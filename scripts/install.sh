#!/bin/sh
# Installs team-platform on a VPS with Docker.
# Creates .env from .env.example asking for the minimum and starts the service.
#
# Usage:  scripts/install.sh [--no-start]
# Without an interactive terminal, it takes ADMIN_EMAIL, ANTHROPIC_API_KEY and GROQ_API_KEY from the environment.
# An existing .env is not modified.
set -eu

START=1
[ "${1:-}" = "--no-start" ] && START=0

cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { echo "docker is missing." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "The docker compose plugin is missing." >&2; exit 1; }
[ -f .env.example ] || { echo ".env.example is missing." >&2; exit 1; }

# set_var NAME VALUE: replaces NAME= in .env without interpreting the value.
set_var() {
  VAR_NAME="$1" VAR_VALUE="$2" awk '
    BEGIN { n = ENVIRON["VAR_NAME"]; v = ENVIRON["VAR_VALUE"] }
    index($0, n "=") == 1 { print n "=" v; next }
    { print }
  ' .env > .env.tmp
  mv .env.tmp .env
}

# ask NAME "Label" secret(0|1): uses the environment if it has a value; otherwise asks.
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
  if [ -n "$value" ]; then set_var "$name" "$value"; else echo "$name stays empty." >&2; fi
}

if [ -f .env ]; then
  echo ".env exists: not modified."
else
  umask 077
  cp .env.example .env
  ask ADMIN_EMAIL "Email of the first Editor" 0
  ask ANTHROPIC_API_KEY "Anthropic key" 1
  ask GROQ_API_KEY "Groq key (audio and video, Enter to skip)" 1
  echo ".env created (mode 600)."
fi

if [ "$START" = "1" ]; then
  docker compose up -d --build --wait
  PORT_PUBLISHED="$(sed -n 's/^PUBLISH_PORT=\(.\+\)$/\1/p' .env | head -n 1)"
  echo "Service up at http://127.0.0.1:${PORT_PUBLISHED:-3000}"
fi

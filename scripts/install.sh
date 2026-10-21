#!/bin/sh
# Installs team-platform on a VPS with Docker.
# Creates .env from .env.example asking for the minimum and starts the service.
#
# Usage:  scripts/install.sh [--no-start]
# Without an interactive terminal, takes ADMIN_EMAIL, ANTHROPIC_API_KEY and GROQ_API_KEY from the environment.
# An existing .env is not modified.
# Also: enables the pre-commit hook against credentials in this clone (core.hooksPath) and leaves the blocked
# password list in the data volume if it is not there.
set -eu

START=1
[ "${1:-}" = "--no-start" ] && START=0

cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { echo "docker is missing." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "The docker compose plugin is missing." >&2; exit 1; }
[ -f .env.example ] || { echo ".env.example is missing." >&2; exit 1; }

# Pre-commit hook against credentials (H-42, DT-004): git does not enable a versioned hooks directory on its
# own. Without this, a fresh clone lacks the protection the test suite takes for granted.
if [ -d .githooks ] && command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  git config core.hooksPath .githooks
  echo "Pre-commit hook enabled (core.hooksPath=.githooks)."
fi

# List of disallowed passwords (H-43, report 04 §1.5 and §8). Source: SecLists, by Daniel Miessler, MIT license
# (https://github.com/danielmiessler/SecLists/blob/master/LICENSE, read on 2026-10-21). File: the 1,000,000
# most common passwords of the xato-net-10-million-passwords set. Pinned to a commit (consulted on
# 2026-10-20) and verified by SHA-256, so that what is downloaded is always the same.
BLOCKLIST_COMMIT=0c03d70db30ceedb941ac58b0ec910eb85906d6f
# BLOCKLIST_URL and BLOCKLIST_SHA256 from the environment replace the source (an own mirror; the tests).
BLOCKLIST_URL="${BLOCKLIST_URL:-https://raw.githubusercontent.com/danielmiessler/SecLists/$BLOCKLIST_COMMIT/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt}"
BLOCKLIST_SHA256="${BLOCKLIST_SHA256:-424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51}"

# in_volume CMD: runs CMD (sh) in a container of the service, with the data volume mounted.
in_volume() {
  docker compose run --rm -T --no-deps --entrypoint sh team-platform -c "$1"
}

# install_blocklist: downloads the list to $DATA_DIR/password-blocklist.txt in the volume, if it is not there. The
# application uses it on its own when PASSWORD_BLOCKLIST_FILE is not defined. Only the entries with the minimum password
# length are kept (PASSWORD_MIN_LENGTH, 15 by default): the shorter ones are already rejected by the length validation.
# If the minimum is lowered in .env, the file in the volume is deleted and this runs again. Without network or with
# different content, it warns and continues: the service works without the list, validating only the length.
install_blocklist() {
  if in_volume 'test -s "$DATA_DIR/password-blocklist.txt"' >/dev/null 2>&1; then
    echo "Blocked password list: already in the volume."
    return 0
  fi
  min="$(sed -n 's/^PASSWORD_MIN_LENGTH=\([0-9][0-9]*\)$/\1/p' .env | head -n 1)"
  min="${min:-15}"
  work="$(mktemp -d)"
  if ! command -v curl >/dev/null 2>&1; then
    echo "Warning: curl is missing; the blocked password list was not installed." >&2
  elif ! curl -fsSL --max-time 120 -o "$work/raw.txt" "$BLOCKLIST_URL"; then
    echo "Warning: could not download the blocked password list from $BLOCKLIST_URL." >&2
  elif [ "$( (sha256sum "$work/raw.txt" 2>/dev/null || shasum -a 256 "$work/raw.txt") | cut -d' ' -f1)" != "$BLOCKLIST_SHA256" ]; then
    echo "Warning: the downloaded list does not match the expected SHA-256; it was not installed." >&2
  else
    tr -d '\r' < "$work/raw.txt" | awk -v min="$min" 'length($0) >= min' > "$work/list.txt"
    in_volume 'umask 077; cat > "$DATA_DIR/password-blocklist.txt"' < "$work/list.txt"
    echo "Blocked password list installed: $(wc -l < "$work/list.txt" | tr -d ' ') entries of $min or more characters."
  fi
  rm -rf "$work"
}

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
  ask PUBLISH_PORT "Port on the host (Enter for 3000)" 0
  ask ANTHROPIC_API_KEY "Anthropic key" 1
  ask GROQ_API_KEY "Groq key (audio and video, Enter to skip)" 1
  echo ".env created (mode 600)."
fi

if [ "$START" = "1" ]; then
  docker compose build
  install_blocklist
  docker compose up -d --wait
  PORT_PUBLISHED="$(sed -n 's/^PUBLISH_PORT=\(.\+\)$/\1/p' .env | head -n 1)"
  echo "Service up at http://127.0.0.1:${PORT_PUBLISHED:-3000}"
  if ! grep -q '^ADMIN_PASSWORD=.' .env; then
    echo "With a new database, the first Editor's password is generated and shown once in the log: docker compose logs team-platform | grep 'First editor'"
  fi
fi

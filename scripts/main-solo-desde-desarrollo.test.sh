#!/usr/bin/env bash
# Prueba del candado de `main` con repositorios de mentira: el gancho pre-push y la regla que usa el flujo del servidor.
set -u
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d -p "${TMPDIR:-/tmp}")"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
FALLAS=0
esperar() { # <esperado 0|1> <descripción> <comando...>
  local quiero="$1" que="$2"; shift 2
  "$@" >"$T/salida" 2>&1; local got=$?
  if [ "$got" = "$quiero" ]; then echo "ok   $que"; else echo "FALLA $que (salió $got, esperaba $quiero)"; sed 's/^/     /' "$T/salida"; FALLAS=$((FALLAS+1)); fi
}
git init -q --bare "$T/remoto.git"
git init -q "$T/c" && cd "$T/c" && git checkout -q -b desarrollo
mkdir -p .githooks scripts && cp "$AQUI/.githooks/pre-push" .githooks/ && cp "$AQUI/scripts/main-solo-desde-desarrollo.sh" scripts/
git config core.hooksPath .githooks; git remote add origin "$T/remoto.git"
git add -A && git commit -qm base && A=$(git rev-parse HEAD)
esperar 1 "sin la marca del despliegue, main no se empuja" git push origin "$A:refs/heads/main"
echo uno >f && git add f && git commit -qm uno && B=$(git rev-parse HEAD)
git push -q origin desarrollo
esperar 0 "con la marca y un sha de desarrollo, main avanza (despliegue)" env DEVALIS_DESPLIEGUE_PUBLICA_MAIN="$A" git push origin "$A:refs/heads/main"
git checkout -q -b ajena "$B" && echo dos >g && git add g && git commit -qm ajena && C=$(git rev-parse HEAD)
esperar 1 "con la marca pero un sha que no está en desarrollo, se rechaza" env DEVALIS_DESPLIEGUE_PUBLICA_MAIN="$C" git push origin "$C:refs/heads/main"
esperar 1 "la marca de otro sha no sirve" env DEVALIS_DESPLIEGUE_PUBLICA_MAIN="$A" git push origin "$C:refs/heads/main"
esperar 1 "borrar main se rechaza" env DEVALIS_DESPLIEGUE_PUBLICA_MAIN=0000000000000000000000000000000000000000 git push origin :refs/heads/main
esperar 0 "main avanza por avance rápido a otro sha de desarrollo" env DEVALIS_DESPLIEGUE_PUBLICA_MAIN="$B" git push origin "$B:refs/heads/main"
# La regla del servidor, sobre el mismo repositorio.
git fetch -q origin; DES=$(git rev-parse origin/desarrollo)
esperar 0 "servidor: un ancestro de desarrollo es válido" bash scripts/main-solo-desde-desarrollo.sh "$B" "$DES" "$A"
esperar 1 "servidor: un commit fuera de desarrollo es inválido" bash scripts/main-solo-desde-desarrollo.sh "$C" "$DES" "$B"
[ "$(bash scripts/main-solo-desde-desarrollo.sh "$C" "$DES" "$B" 2>/dev/null)" = "$B" ] && echo "ok   servidor: el último válido es el de desarrollo del que partió" || { echo "FALLA último válido"; FALLAS=$((FALLAS+1)); }
git checkout -q "$A" && git checkout -q -b otra && echo x >h && git add h && git commit -qm reescribe && D=$(git rev-parse HEAD)
esperar 1 "servidor: reescribir main (no avanza sobre el anterior) es inválido" bash scripts/main-solo-desde-desarrollo.sh "$D" "$D" "$B"
[ "$FALLAS" = 0 ] && echo "todo en verde" || { echo "$FALLAS fallas"; exit 1; }

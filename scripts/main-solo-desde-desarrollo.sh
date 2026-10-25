#!/usr/bin/env bash
# La regla única de «main»: sólo avanza a un commit que ya está en `desarrollo`, por avance rápido.
#
#   main-solo-desde-desarrollo.sh <nuevo-main> <desarrollo> [<main-anterior>]
#
# Sale 0 si <nuevo-main> es <desarrollo> o ancestro suyo y, con <main-anterior>, la avanza sin reescribirla.
# Sale 1 si no, e imprime en la salida estándar el último commit de la historia de <nuevo-main> (primer padre)
# que sí cumple: a donde hay que devolver `main`. Lo usan el flujo `main-solo-desde-desarrollo.yml`
# (del lado del servidor) y la prueba `scripts/main-solo-desde-desarrollo.test.sh`. El gancho `.githooks/pre-push`
# aplica la misma regla antes de empujar.
set -eu
NUEVO="${1:?uso: main-solo-desde-desarrollo.sh <nuevo-main> <desarrollo> [<main-anterior>]}"
DESARROLLO="${2:?falta <desarrollo>}"
ANTERIOR="${3:-}"
CERO=0000000000000000000000000000000000000000
en_desarrollo() { git merge-base --is-ancestor "$1" "$DESARROLLO" 2>/dev/null; }
if en_desarrollo "$NUEVO"; then
  if [ -z "$ANTERIOR" ] || [ "$ANTERIOR" = "$CERO" ] || git merge-base --is-ancestor "$ANTERIOR" "$NUEVO" 2>/dev/null; then
    exit 0
  fi
fi
# El último válido: el más nuevo de la historia de primer padre de lo que quedó en main que está en desarrollo.
# Si el nuevo main reescribió la historia, se parte de la anterior.
for c in $(git rev-list --first-parent "$NUEVO"); do
  if en_desarrollo "$c" && { [ -z "$ANTERIOR" ] || [ "$ANTERIOR" = "$CERO" ] || git merge-base --is-ancestor "$c" "$ANTERIOR" 2>/dev/null || git merge-base --is-ancestor "$ANTERIOR" "$c" 2>/dev/null; }; then
    echo "$c"; exit 1
  fi
done
if [ -n "$ANTERIOR" ] && [ "$ANTERIOR" != "$CERO" ] && en_desarrollo "$ANTERIOR"; then echo "$ANTERIOR"; fi
exit 1

#!/bin/sh
# Stand-in for EXECUTE_MACHINE_RUN of a host whose session lives on the machine apart from the connection (src/execute/runners.js, job 156 of 2026-10-25):
# the first call copies the job directory and starts the session detached (its own session, so the death of this process does not reach it); every call, the
# first or a later one, attaches to it and streams its output until it is done. Usage: huesped.sh <workdir> <state dir> <job id>
workdir=$1
dir=$2/maquina-$3
mkdir -p "$dir"
if [ ! -e "$dir/started" ]; then
  touch "$dir/started"
  cp -r "$workdir" "$dir/job"
  setsid sh -c "bash '$dir/job/run.sh' > '$dir/out' 2> '$dir/err'; touch '$dir/done'" < /dev/null > /dev/null 2>&1 &
fi
pos=0
while :; do
  size=$(wc -c < "$dir/out" 2>/dev/null || echo 0)
  if [ "$size" -gt "$pos" ]; then tail -c +$((pos + 1)) "$dir/out" | head -c $((size - pos)); pos=$size; fi
  if [ -e "$dir/done" ] && [ "$size" -eq "$(wc -c < "$dir/out")" ]; then break; fi
  sleep 0.05
done

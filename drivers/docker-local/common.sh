#!/usr/bin/env bash
# Shared by the hooks of the docker-local driver. Sourced, never run.
#
# Contract: this driver meets version 1 of the host contract. The host declares it with EXECUTE_CONTRACT_VERSION=1 in the environment of the worker
# (the worker refuses to start when the major version of the core differs; `scripts/host-conformance.mjs` checks the driver).
#
# Settings (environment of the Team Platform worker; all optional):
#   TP_DOCKER_IMAGE           image of the machine (default team-platform-agent:local, built from drivers/docker-local/Dockerfile)
#   TP_DOCKER_REPO            absolute path of the host repository. Bind-mounted into the machine; the session clones it, works on the branch
#                             tp/<message id> and pushes it back, which is where deliver.sh looks for it. Empty: the session works in the job directory.
#   TP_DOCKER_BASE_REF        ref the branch starts from (default: what HEAD of TP_DOCKER_REPO points to)
#   TP_DOCKER_MAX_CONTAINERS  most machines alive at once; create.sh answers 75 beyond it. Empty: no cap (the cap is the host's to declare).
#   TP_DOCKER_MEMORY, TP_DOCKER_CPUS   limits passed to `docker run` (--memory, --cpus). Empty: Docker's own.
#   TP_DOCKER_NETWORK         Docker network of the machine (default bridge)
#   TP_DOCKER_PASS_ENV        names of variables copied from the worker's environment into the session, by name (default
#                             «ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN»); values never appear in a command line
#   TP_DOCKER_STATE           directory of the driver's own state: the creation lock and the transcripts
#                             (default ${XDG_STATE_HOME:-$HOME/.local/state}/team-platform-docker)

# A `docker` shell function exported by the caller (a wrapper that allocates a terminal, for instance) would be inherited by these scripts and
# would merge stderr into stdout, which is the NDJSON of the session. The real executable is the one the contract needs.
unset -f docker 2>/dev/null || true

TP_DOCKER_IMAGE="${TP_DOCKER_IMAGE:-team-platform-agent:local}"
TP_DOCKER_NETWORK="${TP_DOCKER_NETWORK:-bridge}"
TP_DOCKER_PASS_ENV="${TP_DOCKER_PASS_ENV-ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN}"
TP_DOCKER_STATE="${TP_DOCKER_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/team-platform-docker}"
TP_DRIVER_LABEL="team-platform.driver=docker-local"

# A job id is interpolated into names and paths: only letters, digits, dot, dash and underscore.
tp_safe () { printf '%s' "$1" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^[.-]+//'; }

tp_machine_name () { printf 'tp-job-%s' "$(tp_safe "$1")"; }

# Only machines this driver named can be touched: never a container of someone else (the host is shared).
tp_valid_machine () { [[ "$1" =~ ^tp-job-[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; }

tp_fail () { echo "$(basename "$0"): $*" >&2; exit 1; }

# `docker` must answer. Not being able to reach the daemon is a «not now» of the infrastructure, not a fault of the change.
tp_need_docker () {
  command -v docker >/dev/null 2>&1 || tp_fail "docker is not in the PATH"
  docker info >/dev/null 2>&1 || { echo "$(basename "$0"): the Docker daemon does not answer" >&2; exit 75; }
}

# The machine exists and was created by this driver. Returns 0 present, 1 absent; exits 1 for a container that is not ours.
tp_machine_state () {
  local label
  label="$(docker inspect -f '{{index .Config.Labels "team-platform.driver"}}' "$1" 2>/dev/null)" || return 1
  [ "$label" = "docker-local" ] || tp_fail "the container $1 is not a machine of this driver"
  return 0
}

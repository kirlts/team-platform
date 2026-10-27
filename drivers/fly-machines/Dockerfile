# The machine of the fly-machines driver: node (poll.mjs and the `team` command of the session run on it), bash, git (the clone of the host repository), tar and
# util-linux (runuser) from the base image, and Claude Code. The `claude` version is pinned by CLAUDE_VERSION; the driver never installs it at run time.
# Publish it in the registry of the Fly app the driver uses:
#   docker build -t registry.fly.io/<app>:tp-agent drivers/fly-machines && docker push registry.fly.io/<app>:tp-agent
# CLAUDE_PACKAGE empty builds the image without Claude Code: conformance.sh and the test of the driver do that and put a fake `claude` in the job directory.
FROM node:24-bookworm-slim
ARG CLAUDE_PACKAGE=@anthropic-ai/claude-code
# Latest published on the npm registry when this was pinned (npm view @anthropic-ai/claude-code version, 2026-10-26). Raise it on purpose.
ARG CLAUDE_VERSION=2.1.311
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && if [ -n "$CLAUDE_PACKAGE" ]; then npm install -g "$CLAUDE_PACKAGE@$CLAUDE_VERSION" && npm cache clean --force; fi
# Fly runs the command of the machine (`sleep <TP_FLY_MAX_LIFE_S>`, set by create.sh), so nothing here needs to keep the machine alive.
CMD ["sleep", "infinity"]

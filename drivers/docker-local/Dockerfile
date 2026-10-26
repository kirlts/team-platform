# The machine of the docker-local driver: node (the `team` command of the session runs on it), bash and git (run.sh and the clone of the host
# repository), and Claude Code. The `claude` version is pinned by CLAUDE_VERSION; the driver never installs it at run time.
#   docker build -t team-platform-agent:local drivers/docker-local
# CLAUDE_PACKAGE empty builds the image without Claude Code: the test of the driver does that and puts a fake `claude` in the job directory.
FROM node:24-bookworm-slim
ARG CLAUDE_PACKAGE=@anthropic-ai/claude-code
ARG CLAUDE_VERSION=latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && if [ -n "$CLAUDE_PACKAGE" ]; then npm install -g "$CLAUDE_PACKAGE@$CLAUDE_VERSION" && npm cache clean --force; fi
# Sleeps until destroy.sh removes it; the session runs as `docker exec`, never as the command of the container.
CMD ["sleep", "infinity"]

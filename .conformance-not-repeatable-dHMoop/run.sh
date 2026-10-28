#!/usr/bin/env bash
export CLAUDE_CONFIG_DIR="$2/claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
exec bash "$2/run.sh"

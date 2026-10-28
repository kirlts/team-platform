#!/usr/bin/env bash
N="$(dirname "$0")/count"
echo x >> "$N"
echo "ref-$(wc -l < "$N" | tr -d " ")"

#!/bin/sh
# The `claude` of the end-to-end suite. It records the whole environment the worker hands to the session
# (one file per process, named by the pid the fake keeps after `exec`) and runs the fake session of src/execute/testing.
if [ -n "$FAKE_EXECUTE_STATE" ]; then env | sort > "$FAKE_EXECUTE_STATE/env-$$.txt"; fi
exec node "$FAKE_CLAUDE" "$@"

#!/bin/bash
# pre-commit wrapper for oxfmt: normalizes exit code 2 (no files to format)
node_modules/.bin/oxfmt "$@"
rc=$?
# exit code 2 means "no files to format" — treat as success for pre-commit
[ $rc -eq 2 ] && exit 0 || exit $rc

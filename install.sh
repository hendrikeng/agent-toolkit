#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
exec node "$repo_dir/shared/install.cjs" "$@"

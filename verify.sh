#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
cd "$repo_dir"

[[ $# -eq 0 ]] || { printf 'Usage: ./verify.sh\n' >&2; exit 2; }
for script in install.sh setup-paseo.sh update.sh skills/deepsec/scripts/deepsec; do
  bash -n "$script"
done
for script in shared/install.cjs shared/paseo-setup.cjs shared/paseo-service.cjs shared/postgres/pg-test.cjs shared/postgres/pg18-fresh.cjs; do
  node --check "$script"
done
node --test shared/install.test.cjs shared/paseo-setup.test.cjs shared/paseo-service.test.cjs shared/pi-native.test.cjs shared/postgres/*.test.cjs
extension_tests=()
for test_file in pi/extensions/*/tests/*.test.ts; do
  if [[ $test_file == pi/extensions/project-blueprint/tests/project-update.test.ts && ! -f vendor/agent-project-blueprint/scripts/bootstrap-configure.mjs ]]; then
    printf 'Skipping project update integration test: blueprint submodule is not initialized.\n'
    continue
  fi
  extension_tests+=("$test_file")
done
node --experimental-strip-types --test "${extension_tests[@]}"
python3 skills/autoreview/scripts/autoreview_test.py
printf 'Toolkit checks passed. Fresh CLI/model behavior and live reviewer invocation still require human acceptance.\n'

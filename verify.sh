#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
cd "$repo_dir"

[[ $# -eq 0 ]] || { printf 'Usage: ./verify.sh\n' >&2; exit 2; }
for script in install.sh update.sh shared/agent-safety/agent-yolo shared/agent-safety/git-yolo-guard; do
  bash -n "$script"
done
for script in shared/agent-safety/configure.cjs shared/agent-safety/pg-test.cjs; do
  node --check "$script"
done
node -e 'JSON.parse(require("node:fs").readFileSync("shared/agent-safety/pi-permission-system.json", "utf8"))'
node shared/agent-safety/configure.cjs --self-test
node --test shared/agent-safety/*.test.cjs
extension_tests=()
for test_file in pi/extensions/*/tests/*.test.ts; do
  if [[ $test_file == pi/extensions/project-blueprint/tests/project-update.test.ts && ! -f vendor/agent-project-blueprint/scripts/bootstrap-configure.mjs ]]; then
    printf 'Skipping project update integration test: blueprint submodule is not initialized.\n'
    continue
  fi
  extension_tests+=("$test_file")
done
node --experimental-strip-types --test "${extension_tests[@]}"
printf 'Toolkit checks passed. Install from a trusted human terminal, then start a fresh Pi session.\n'

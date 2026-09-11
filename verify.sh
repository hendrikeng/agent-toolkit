#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
cd "$repo_dir"
case ${1:---source} in
  --source)
    [[ -n ${2:-} ]] || { printf 'Provide a patched scratch package path. No installed package is read implicitly.\n' >&2; exit 2; }
    [[ -n ${AGENT_TOOLKIT_SCRATCH_ROOT:-} ]] || { printf 'AGENT_TOOLKIT_SCRATCH_ROOT is required. Run this check from pi-yolo, which supplies a private scratch directory under ~/Code.\n' >&2; exit 2; }
    bash -n install.sh
    bash -n shared/agent-safety/agent-yolo
    bash -n shared/agent-safety/git-yolo-guard
    bash -n shared/agent-safety/pi-yolo-dispatch
    node --check shared/agent-safety/permission-bundle.cjs
    node --check shared/agent-safety/local-resources.cjs
    node --experimental-strip-types --check pi/extensions/development-access/index.ts
    node --experimental-strip-types --check pi/extensions/task-graph/index.ts
    node shared/agent-safety/configure.cjs --self-test
    node --test shared/agent-safety/development-policy.test.cjs shared/agent-safety/local-resources.test.cjs shared/agent-safety/resource-boundaries.test.cjs shared/agent-safety/git-operation-policy.test.cjs shared/agent-safety/launcher-syntax-contract.test.cjs shared/agent-safety/shared-launcher.test.cjs
    node --experimental-strip-types --test pi/extensions/task-graph/tests/task-graph.test.ts pi/extensions/task-graph/tests/runtime-regressions.test.ts
    node --experimental-transform-types shared/agent-safety/permission-api-reference.check.cjs "$2"
    node shared/agent-safety/extension-loader.check.cjs "$2"
    printf 'Source checks passed. Installed runtime and fresh sessions are NOT accepted by these checks.\n'
    ;;
  --bundle)
    [[ -n ${2:-} ]] || { printf 'Provide the physical retained bundle path.\n' >&2; exit 2; }
    node shared/agent-safety/permission-bundle.cjs verify "$2"
    node --experimental-transform-types shared/agent-safety/permission-api-reference.check.cjs "$2/node_modules/@gotgenes/pi-permission-system"
    printf 'Bundle bytes and parser checked. Native tools, live Orca and fresh-session acceptance remain separate.\n'
    ;;
  *) printf 'Usage: verify.sh --source <patched-package-path> | --bundle <physical-bundle-path>\n' >&2; exit 2 ;;
esac

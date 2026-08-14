#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
  printf 'usage: %s\n' "$0"
  exit 0
fi
if (($#)); then
  printf 'usage: %s\n' "$0" >&2
  exit 2
fi
if [[ ! -t 0 || ! -t 1 ]]; then
  printf 'update.sh requires an interactive terminal. In Pi, use /skills-update.\n' >&2
  exit 2
fi

for name in GIT_ASKPASS GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE GIT_EXEC_PATH GIT_PROXY_COMMAND GIT_SSH GIT_SSH_COMMAND SSH_ASKPASS; do
  if [[ ${!name+x} ]]; then
    printf 'Unset %s before updating.\n' "$name" >&2
    exit 1
  fi
done
while IFS='=' read -r name _; do
  if [[ $name == GIT_CONFIG_* ]]; then
    printf 'Unset %s before updating.\n' "$name" >&2
    exit 1
  fi
done < <(env)

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
git_bin=
for candidate in /usr/bin/git /usr/local/bin/git /opt/homebrew/bin/git; do
  if [[ -x $candidate ]]; then
    git_bin=$candidate
    break
  fi
done
if [[ -z $git_bin ]]; then
  printf 'Git is unavailable.\n' >&2
  exit 1
fi
safe_git=(
  "$git_bin"
  --no-replace-objects
  -c core.fsmonitor=false
  -c core.hooksPath=/dev/null
  -c core.sshCommand=/usr/bin/ssh
  -c protocol.ext.allow=never
  -c diff.external=
  -C "$repo_dir"
)

if [[ -n $("${safe_git[@]}" status --porcelain --untracked-files=all) ]]; then
  printf 'Commit or discard agent-toolkit changes before updating.\n' >&2
  exit 1
fi

branch=$("${safe_git[@]}" branch --show-current)
if [[ -z $branch ]]; then
  printf 'Cannot update a detached agent-toolkit checkout.\n' >&2
  exit 1
fi
upstream_remote=$("${safe_git[@]}" config --get "branch.$branch.remote")
merge_ref=$("${safe_git[@]}" config --get "branch.$branch.merge")
remote_url=$("${safe_git[@]}" remote get-url "$upstream_remote")
printf -v display_repo '%q' "$repo_dir"
printf -v display_branch '%q' "$branch"
printf -v display_remote '%q' "$upstream_remote"
printf -v display_ref '%q' "$merge_ref"
printf -v display_url '%q' "$remote_url"

printf 'Update Agent Toolkit?\n  checkout: %s\n  branch:   %s\n  upstream: %s %s\n  URL:      %s\n' "$display_repo" "$display_branch" "$display_remote" "$display_ref" "$display_url"
printf 'This pulls remote code, runs install.sh, and updates global skills. Continue? [y/N] '
read -r answer
if [[ $answer != "y" && $answer != "Y" ]]; then
  printf 'Update cancelled.\n'
  exit 0
fi

if [[ -n $("${safe_git[@]}" status --porcelain --untracked-files=all) ]] ||
   [[ $("${safe_git[@]}" branch --show-current) != "$branch" ]] ||
   [[ $("${safe_git[@]}" config --get "branch.$branch.remote") != "$upstream_remote" ]] ||
   [[ $("${safe_git[@]}" config --get "branch.$branch.merge") != "$merge_ref" ]] ||
   [[ $("${safe_git[@]}" remote get-url "$upstream_remote") != "$remote_url" ]]; then
  printf 'The toolkit checkout changed after approval.\n' >&2
  exit 1
fi
"${safe_git[@]}" pull --ff-only --no-tags "$upstream_remote" "$merge_ref"
global_status=0
"$repo_dir/shared/update-global-skills" || global_status=$?
"$repo_dir/install.sh"
if ((global_status)); then
  printf 'The toolkit is installed, but one or more global skills did not update.\n' >&2
  exit "$global_status"
fi
printf 'Update complete. Restart active agent sessions if installation added a resource.\n'

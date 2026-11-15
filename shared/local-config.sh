# Reads ~/.config/agent-toolkit/local.env as data, never as code. Sourced by scripts/apply-claude-sandbox.sh and shared/sandbox-probe.sh.
# shared/agent-stop.pl has the same rules in Perl; scripts/apply-claude-sandbox.test.cjs checks that both return the same roots.

# toolkit_config FILE KEY: prints the value of the first KEY=value line and returns 0, or returns 1 if no line sets KEY.
# Surrounding whitespace, a trailing CR, and one pair of matching single or double quotes are removed.
toolkit_config() {
  local line value
  [[ -f $1 ]] || return 1
  while IFS= read -r line || [[ $line ]]; do
    [[ $line =~ ^[[:space:]]*$2=(.*)$ ]] || continue
    value=${BASH_REMATCH[1]%$'\r'}
    [[ $value =~ ^[[:space:]]*(.*[^[:space:]])[[:space:]]*$ ]] && value=${BASH_REMATCH[1]} || value=
    [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]] && value=${BASH_REMATCH[1]}
    printf '%s' "$value"
    return 0
  done < "$1"
  return 1
}

# toolkit_project_roots FILE HOME: prints one project root per line. Default: HOME/Code.
# A root is an absolute or ~/ path. Paths with . or .. parts or glob characters, /, and HOME itself are dropped with one warning.
toolkit_project_roots() {
  local value root path dropped=
  value=$(toolkit_config "$1" TOOLKIT_PROJECT_ROOTS) || value=$2/Code
  local -a list
  read -r -a list <<< "$value"
  for root in ${list[@]+"${list[@]}"}; do
    path=$root
    [[ $path == '~/'* ]] && path=$2/${path#'~/'}
    path=${path%"${path##*[!/]}"}
    if [[ $path != /* || /$path/ =~ /\.\.?/ || $path == *[*?[]* || $path == "${2%/}" ]]; then dropped+=" $root"; continue; fi
    printf '%s\n' "$path"
  done
  [[ -z $dropped ]] || printf 'Ignoring invalid project roots in %s:%s\n' "$1" "$dropped" >&2
}

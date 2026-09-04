#!/usr/bin/env bash
# Brand scan + init gate for the explore-design skill.
# One pass that reports: whether a repo-local branded template exists (the init
# gate), candidate design-system docs, theme/token files, and font signals.
# Usage: scan-brand.sh [repo-root]   (defaults to current directory)
set -u
ROOT="${1:-.}"
cd "$ROOT" 2>/dev/null || { echo "ERROR: cannot cd to $ROOT"; exit 1; }

PRUNE=( \( -type d \( -name node_modules -o -name .git -o -name dist -o -name .next -o -name build -o -name vendor \) -prune \) -o )
# exploration outputs and this skill's own assets must not feed the scan
GREP_EXCLUDES=( --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next --exclude-dir=build --exclude-dir=vendor --exclude-dir=design-explorations --exclude-dir=explorations --exclude-dir=.explorations --exclude-dir=explore-designs --exclude-dir=explore-design )

TPL=$(find . -maxdepth 5 "${PRUNE[@]}" \( -name "_template.html" \( -path "*exploration*" -o -path "*scratch*" \) \) -print 2>/dev/null | head -1)
BRAND=$(find . -maxdepth 5 "${PRUNE[@]}" -name "_brand.md" -print 2>/dev/null | head -1)

echo "== INIT GATE =="
if [ -n "$TPL" ]; then
  echo "STATUS: TEMPLATE_FOUND"
  echo "TEMPLATE: $TPL"
  [ -n "$BRAND" ] && echo "BRAND_NOTES: $BRAND"
  echo "ACTION: copy this template for the new exploration. Do NOT re-run brand init unless the user asked to re-init/rebrand."
else
  echo "STATUS: NO_TEMPLATE"
  echo "ACTION: brand init is REQUIRED before writing any exploration HTML."
  echo "        Read references/brand-init.md in the skill directory and follow it."
  echo "        (Init styles the document chrome only — the source mock/wireframe is content, not a brand input.)"
fi

echo
echo "== DESIGN-SYSTEM DOCS =="
find . -maxdepth 5 "${PRUNE[@]}" \( -iname "DESIGN.md" -o -iname "design-system*" -o -iname "*style-guide*" -o -iname "brand.md" -o -iname "brand-guide*" \) -print 2>/dev/null | head -10
find . -maxdepth 5 "${PRUNE[@]}" -type d -iname "tokens" -print 2>/dev/null | head -5

echo
echo "== THEME / TOKEN FILES =="
find . -maxdepth 3 "${PRUNE[@]}" -name "tailwind.config.*" -print 2>/dev/null | head -5
CSS_WITH_ROOT=()
while IFS= read -r -d '' css; do
  grep -q ":root" "$css" 2>/dev/null || continue
  CSS_WITH_ROOT+=("$css")
  [ "${#CSS_WITH_ROOT[@]}" -ge 5 ] && break
done < <(find . -maxdepth 5 "${PRUNE[@]}" -type f -name "*.css" -not -path "*exploration*" -not -path "*explore-designs*" -print0 2>/dev/null)
if [ "${#CSS_WITH_ROOT[@]}" -gt 0 ]; then
  echo "-- CSS files with :root custom properties --"
  printf '%s\n' "${CSS_WITH_ROOT[@]}"
  echo "-- sample custom properties --"
  for css in "${CSS_WITH_ROOT[@]}"; do
    grep -h -- "--[A-Za-z][A-Za-z0-9-]*:" "$css" 2>/dev/null
  done | sed 's/^[[:space:]]*//' | head -30
fi

echo
echo "== FONTS =="
grep -rhoE "fonts\.googleapis\.com/css2\?[^\"' ]+" --include="*.html" --include="*.css" --include="*.vue" --include="*.tsx" --include="*.ts" --include="*.js" "${GREP_EXCLUDES[@]}" . 2>/dev/null | head -5
grep -rhoE "font-family:[^;}]+" --include="*.css" "${GREP_EXCLUDES[@]}" . 2>/dev/null | sed 's/^[[:space:]]*//' | sort -u | head -10

echo
echo "== DONE =="

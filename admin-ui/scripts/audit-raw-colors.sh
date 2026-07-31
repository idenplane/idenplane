#!/usr/bin/env bash
#
# audit-raw-colors.sh
#
# Repeatable audit for raw Tailwind palette utility classes (e.g. bg-gray-100,
# text-red-700, border-indigo-500) inside admin-ui/src/pages and
# admin-ui/src/components, EXCLUDING the design-system internals
# (src/components/ui) and test files (*.test.tsx / *.test.ts).
#
# Goal: the design system defines semantic tokens (bg-surface, text-fg,
# text-muted, border-line, Badge variants, etc.) in src/index.css and
# src/components/ui/*. Pages/components should use those tokens/components
# instead of hardcoding raw Tailwind palette colors. This script finds
# every remaining raw-color usage so it can be migrated (see
# implementation_plan.json / build-progress.txt for the phased migration).
#
# Usage:
#   ./scripts/audit-raw-colors.sh            # human-readable per-file counts, sorted desc
#   ./scripts/audit-raw-colors.sh --total     # print only the grand total match count
#   ./scripts/audit-raw-colors.sh --files     # print only the count of distinct files with matches
#   ./scripts/audit-raw-colors.sh --raw       # print raw matches (file:line:match)
#
# Uses `rg` (ripgrep) if available, otherwise falls back to GNU `grep -P`
# so the script works in environments without ripgrep installed.
#
# Exit code: 0 always for the default/--total/--files/--raw modes (informational).
# CI/regression-guard usage (see Phase 9) should check the printed total is 0.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Raw Tailwind palette color families we consider "not part of the design system".
COLOR_FAMILIES="gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
PREFIXES="bg|text|border|ring|divide|from|to|via"

# Match e.g. "bg-gray-100", "hover:text-red-700", "dark:border-slate-200" etc.
# Require a non-word char (or line start) before the prefix so we don't match
# things like "MyBgText-gray-100" as a substring of a longer identifier.
PATTERN="(^|[^A-Za-z0-9_-])(${PREFIXES})-(${COLOR_FAMILIES})-[0-9]+"

SEARCH_DIRS=("src/pages" "src/components")
MODE="${1:-default}"

collect_matches() {
  # Emits "file:line:matched_text" lines, one per raw-color match.
  if command -v rg >/dev/null 2>&1; then
    rg -n -P -o -e "$PATTERN" \
      --glob '!src/components/ui/**' \
      --glob '!*.test.tsx' \
      --glob '!*.test.ts' \
      "${SEARCH_DIRS[@]}" 2>/dev/null
  else
    find "${SEARCH_DIRS[@]}" \
      \( -path 'src/components/ui' -o -path '*/src/components/ui' -o -path '*/src/components/ui/*' \) -prune -o \
      -name '*.test.tsx' -prune -o \
      -name '*.test.ts' -prune -o \
      -type f \( -name '*.tsx' -o -name '*.ts' \) -print0 \
      | xargs -0 grep -n -o -P "$PATTERN" 2>/dev/null
  fi
}

case "$MODE" in
  --total)
    collect_matches | wc -l | tr -d ' '
    ;;
  --files)
    collect_matches | cut -d: -f1 | sort -u | wc -l | tr -d ' '
    ;;
  --raw)
    collect_matches
    ;;
  *)
    echo "Raw Tailwind palette color audit (src/pages + src/components, excluding src/components/ui and *.test.tsx)"
    echo "================================================================================================="
    echo

    TMP_FILE=$(mktemp)
    collect_matches > "$TMP_FILE"

    if [ -s "$TMP_FILE" ]; then
      cut -d: -f1 "$TMP_FILE" | sort | uniq -c | sort -rn | \
        awk '{count=$1; $1=""; sub(/^ /, ""); printf "%6s  %s\n", count, $0}'

      TOTAL_FILES=$(cut -d: -f1 "$TMP_FILE" | sort -u | wc -l | tr -d ' ')
      TOTAL_MATCHES=$(wc -l < "$TMP_FILE" | tr -d ' ')
      echo
      echo "-------------------------------------------------------------------------------------------------"
      echo "Files with raw-color matches: $TOTAL_FILES"
      echo "Total raw-color matches:      $TOTAL_MATCHES"
    else
      echo "No raw Tailwind palette color matches found. \xf0\x9f\x8e\x89"
      echo "Files with raw-color matches: 0"
      echo "Total raw-color matches:      0"
    fi
    rm -f "$TMP_FILE"
    ;;
esac

#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2024-2026 Gracker (Chris)
# This file is part of SmartPerfetto. See LICENSE for details.
#
# Add SPDX AGPL v3 headers to source files that lack them.
#
# Usage:
#   scripts/add-spdx-header.sh                # dry-run: list files that would change
#   scripts/add-spdx-header.sh --apply        # apply changes
#
# Scans: backend/src/**/*.ts, backend/skills/**/*.{yaml,yml}, scripts/*.sh
# Skips: files that already contain SPDX-License-Identifier in their first 5 lines.
# Shebangs and "use strict" directives are preserved at the top; header is
# inserted immediately after.

set -euo pipefail

APPLY=0
if [ "${1:-}" = "--apply" ]; then
  APPLY=1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

HEADER_TS='// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.
'

HEADER_HASH='# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2024-2026 Gracker (Chris)
# This file is part of SmartPerfetto. See LICENSE for details.
'

collect_targets() {
  git ls-files \
    'backend/src/**/*.ts' \
    'backend/skills/**/*.yaml' \
    'backend/skills/**/*.yml' \
    'scripts/*.sh' 2>/dev/null \
  | while IFS= read -r f; do
      head -5 "$f" | grep -q 'SPDX-License-Identifier' || echo "$f"
    done
}

pick_header() {
  case "$1" in
    *.ts) printf '%s' "$HEADER_TS" ;;
    *.yaml|*.yml|*.sh) printf '%s' "$HEADER_HASH" ;;
  esac
}

insert_header() {
  local file="$1"
  local header; header=$(pick_header "$file")
  local first; first=$(head -1 "$file")

  # Preserve shebang or "use strict" line at top
  if [[ "$first" == "#!"* ]] || [[ "$first" == "'use strict'"* ]] || [[ "$first" == '"use strict"'* ]]; then
    {
      echo "$first"
      echo ""
      printf '%s\n\n' "$header"
      tail -n +2 "$file"
    } > "$file.tmp"
  else
    {
      printf '%s\n\n' "$header"
      cat "$file"
    } > "$file.tmp"
  fi
  mv "$file.tmp" "$file"
}

main() {
  local count=0
  local applied=0
  local targets
  targets=$(collect_targets)

  if [ -z "$targets" ]; then
    echo "All source files already carry SPDX headers. ✓"
    return 0
  fi

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    count=$((count + 1))
    if [ "$APPLY" -eq 1 ]; then
      insert_header "$f"
      applied=$((applied + 1))
    else
      echo "would add header: $f"
    fi
  done <<< "$targets"

  if [ "$APPLY" -eq 1 ]; then
    echo ""
    echo "Added SPDX headers to $applied file(s)."
    echo "Run 'git diff --stat' to review, then commit."
  else
    echo ""
    echo "Dry-run: $count file(s) would be modified."
    echo "Re-run with --apply to commit the change."
  fi
}

main

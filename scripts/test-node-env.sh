#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2024-2026 Gracker (Chris)
# This file is part of SmartPerfetto. See LICENSE for details.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_HOME="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT

mkdir -p "$TMP_HOME/.nvm"
cat > "$TMP_HOME/.nvm/nvm.sh" <<'NVM'
[ -z "$NVM_DIR" ] && export NVM_DIR="$HOME/.nvm"
nvm() {
  return 0
}
NVM

# shellcheck disable=SC2016
HOME="$TMP_HOME" env -u NVM_DIR bash -u -c '
  . "$1/scripts/node-env.sh"
  smartperfetto_load_nvm
  test "${NVM_DIR:-}" = "$HOME/.nvm"
' bash "$PROJECT_ROOT"

echo "node-env tests passed"

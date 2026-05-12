#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2024-2026 Gracker (Chris)
# This file is part of SmartPerfetto. See LICENSE for details.

# SmartPerfetto Docker entrypoint
# Starts both backend and frontend services

set -euo pipefail

echo "=============================================="
echo "SmartPerfetto (Docker)"
echo "=============================================="

# Verify LLM credentials are configured for Docker runs. Docker cannot use the
# host's Claude Code login, but health/UI smoke checks still work without AI.
ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_TOKEN="${ANTHROPIC_AUTH_TOKEN:-}"
ANTHROPIC_BASE="${ANTHROPIC_BASE_URL:-}"
OPENAI_KEY="${OPENAI_API_KEY:-}"
OPENAI_BASE="${OPENAI_BASE_URL:-}"
AGENT_RUNTIME="${SMARTPERFETTO_AGENT_RUNTIME:-claude-agent-sdk}"
PROVIDER_DATA_DIR="${PROVIDER_DATA_DIR_OVERRIDE:-/app/backend/data}"
PROVIDERS_FILE="$PROVIDER_DATA_DIR/providers.json"
HAS_ACTIVE_PROVIDER_PROFILE=false
ACTIVE_PROVIDER_SUMMARY=""
if [ -s "$PROVIDERS_FILE" ]; then
  ACTIVE_PROVIDER_SUMMARY="$(
    node - "$PROVIDERS_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
try {
  const providers = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(providers)) process.exit(0);
  const active = providers.find((provider) => provider && provider.isActive);
  if (!active) process.exit(0);
  const runtime = active.connection?.agentRuntime || 'auto';
  const model = active.models?.primary || 'unknown-model';
  console.log(`${active.name || active.id || 'unnamed'} (${active.type || 'unknown'}, ${runtime}, ${model})`);
} catch {
  process.exit(0);
}
NODE
  )"
fi
if [ -n "$ACTIVE_PROVIDER_SUMMARY" ]; then
  HAS_ACTIVE_PROVIDER_PROFILE=true
fi

has_concrete_env_value() {
  local value="${1:-}"
  case "${value,,}" in
    ""|your_*|replace_with_*|example_*|sk-ant-xxx|sk-proxy-xxx|xxx|placeholder)
      return 1
      ;;
  esac
  [[ ! "$value" =~ ^\<[^[:space:]]+\>$ ]]
}

is_enabled_env_flag() {
  local value="${1:-}"
  has_concrete_env_value "$value" || return 1
  case "${value,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

HAS_ENV_CREDENTIALS=false
HAS_BEDROCK_ENV=false
if is_enabled_env_flag "${CLAUDE_CODE_USE_BEDROCK:-}"; then
  HAS_BEDROCK_ENV=true
fi
if has_concrete_env_value "$ANTHROPIC_KEY" || \
   has_concrete_env_value "$ANTHROPIC_TOKEN" || \
   has_concrete_env_value "$ANTHROPIC_BASE" || \
   has_concrete_env_value "$OPENAI_KEY" || \
   has_concrete_env_value "$OPENAI_BASE" || \
   [ "$HAS_BEDROCK_ENV" = true ]; then
  HAS_ENV_CREDENTIALS=true
fi

if [ "$HAS_ACTIVE_PROVIDER_PROFILE" = true ]; then
  echo "AI credential source: Provider Manager active provider: $ACTIVE_PROVIDER_SUMMARY"
  if [ "$HAS_ENV_CREDENTIALS" = true ]; then
    echo "NOTE: Docker environment credentials are present, but the active Provider Manager profile takes priority."
    echo "      Deactivate the provider in AI Assistant settings to use .env / environment fallback."
  fi
else
  echo "AI credential source: Docker .env / environment fallback"
fi

if [ "$HAS_ACTIVE_PROVIDER_PROFILE" != true ] && \
   ! has_concrete_env_value "$ANTHROPIC_KEY" && \
   ! has_concrete_env_value "$ANTHROPIC_TOKEN" && \
   ! has_concrete_env_value "$ANTHROPIC_BASE" && \
   [ "$HAS_BEDROCK_ENV" != true ] && \
   { [ "$AGENT_RUNTIME" != "openai-agents-sdk" ] || { ! has_concrete_env_value "$OPENAI_KEY" && ! has_concrete_env_value "$OPENAI_BASE"; }; }; then
  echo "WARNING: LLM credentials are missing or still use an example placeholder."
  echo "AI analysis needs credentials for the selected agent runtime."
  echo "Set a Provider Manager profile or matching Claude/OpenAI env block before running real AI analysis."
  echo ""
fi

# Start backend
echo "Starting backend on port ${PORT:-3000}..."
cd /app/backend
node dist/index.js &
BACKEND_PID=$!

# Wait for backend health
echo "Waiting for backend..."
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${PORT:-3000}/health" >/dev/null 2>&1; then
    echo "Backend ready (${i}s)"
    break
  fi
  sleep 1
done

# shellcheck disable=SC2016 # The single-quoted body is JavaScript for node -e.
HEALTH_SUMMARY="$(
  { curl -fsS "http://localhost:${PORT:-3000}/health" 2>/dev/null || true; } | node -e '
let raw = "";
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const health = JSON.parse(raw);
    const ai = health.aiEngine || {};
    const parts = [
      `runtime=${ai.runtime || "unknown"}`,
      `credentialSource=${ai.credentialSource || ai.source || "unknown"}`,
      `providerMode=${ai.providerMode || "unknown"}`,
    ];
    if (ai.activeProvider?.name) parts.push(`activeProvider=${ai.activeProvider.name}`);
    if (ai.providerOverridesEnv) parts.push("providerOverridesEnv=true");
    console.log(parts.join(", "));
  } catch {
    process.exit(0);
  }
});
'
)"
if [ -n "$HEALTH_SUMMARY" ]; then
  echo "Backend AI engine: $HEALTH_SUMMARY"
fi

# Start frontend (pre-built Perfetto UI static server)
echo "Starting frontend on port 10000..."
cd /app/perfetto/out/ui/ui
PORT=10000 node server.js &
FRONTEND_PID=$!

echo ""
echo "=============================================="
echo "SmartPerfetto is running!"
echo "  Perfetto UI: http://localhost:10000"
echo "  Backend API: http://localhost:${PORT:-3000}"
echo "=============================================="

# shellcheck disable=SC2317,SC2329 # Invoked indirectly by trap.
shutdown() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}

# Handle shutdown gracefully
trap shutdown SIGTERM SIGINT

# Wait for either process to exit
set +e
wait -n "$BACKEND_PID" "$FRONTEND_PID"
EXIT_CODE=$?
set -e

# If one exits, stop the other
kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
exit "$EXIT_CODE"

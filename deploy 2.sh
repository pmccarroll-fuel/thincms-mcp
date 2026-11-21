#!/bin/bash
# Deploy the hosted MCP server (dist/http.js) to production.
# Usage: bash deploy.sh
#
# Uses the server settings from ../thincms/deploy/deploy.conf. The PM2 app
# definition (`thincms-mcp`) lives in ../thincms/ecosystem.config.js, which is
# deployed with ThinCMS — deploy ThinCMS first the first time.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_FILE="$SCRIPT_DIR/../thincms/deploy/deploy.conf"
[ -f "$CONF_FILE" ] && source "$CONF_FILE"

SERVER_IP="${SERVER_IP:-}"
SSH_USER="${SSH_USER:-root}"
MCP_REMOTE_DIR="${MCP_REMOTE_DIR:-/var/www/thincms-mcp}"
THINCMS_REMOTE_DIR="${REMOTE_DIR:-/var/www/thincms}"

if [ -z "$SERVER_IP" ]; then
  echo "Error: SERVER_IP not configured in thincms/deploy/deploy.conf"
  exit 1
fi
REMOTE="$SSH_USER@$SERVER_IP"

echo "=== ThinCMS MCP Deploy → $REMOTE:$MCP_REMOTE_DIR ==="

echo "[1/3] Building..."
cd "$SCRIPT_DIR"
npm run build

echo "[2/3] Syncing..."
ssh "$REMOTE" "mkdir -p $MCP_REMOTE_DIR /var/log/thincms-mcp"
rsync -avz --delete \
  dist bin package.json package-lock.json \
  "$REMOTE:$MCP_REMOTE_DIR/"

echo "[3/3] Installing production deps and (re)starting..."
ssh "$REMOTE" "cd $MCP_REMOTE_DIR && npm ci --omit=dev && \
  pm2 startOrReload $THINCMS_REMOTE_DIR/ecosystem.config.js --only thincms-mcp && pm2 save && \
  sleep 2 && curl -sf http://127.0.0.1:3100/healthz"

echo ""
echo "Done."

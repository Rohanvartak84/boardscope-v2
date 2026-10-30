#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ ! -f "$PROJECT_DIR/frontend/dist/index.html" ]; then
  echo 'Build the frontend first: cd frontend && npm ci && npm run build' >&2
  exit 1
fi
cd "$PROJECT_DIR/backend"
exec "$PROJECT_DIR/.venv/bin/python" -m boardscope serve

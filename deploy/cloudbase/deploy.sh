#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVICE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PORT_VALUE=${PORT:-8786}

if ! command -v tcb >/dev/null 2>&1; then
  echo 'CloudBase CLI 未安装，请先执行: npm i -g @cloudbase/cli' >&2
  exit 1
fi

cd "$SERVICE_ROOT"
exec tcb cloudrun deploy --source . --port "$PORT_VALUE" "$@"

#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HOST_VALUE=${HOST:-127.0.0.1}
PORT_VALUE=${PORT:-8786}

cd "$ROOT_DIR"

echo "==> media-service migrate"
node ./scripts/migrate.js

echo "==> media-service start host=${HOST_VALUE} port=${PORT_VALUE}"
HOST="$HOST_VALUE" PORT="$PORT_VALUE" node ./server.js

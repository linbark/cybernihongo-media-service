#!/usr/bin/env sh
set -eu

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy

export HOST=${HOST:-0.0.0.0}
export PORT=${PORT:-8786}

echo "==> media-service migrate"
node ./scripts/migrate.js

echo "==> media-service start host=${HOST} port=${PORT}"
exec node ./server.js

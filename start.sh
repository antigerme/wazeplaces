#!/usr/bin/env bash
set -e

if [ -z "$PHP_CLI_SERVER_WORKERS" ]; then
  export PHP_CLI_SERVER_WORKERS=4
fi

PORT="${PORT:-8080}"
HOST="${HOST:-0.0.0.0}"

cd "$(dirname "$0")"

echo "Iniciando Waze Places em http://$HOST:$PORT"
echo "Workers: $PHP_CLI_SERVER_WORKERS"
echo "Para parar, aperte Ctrl+C"
echo ""

exec php -S "$HOST:$PORT"

#!/bin/sh
# End-to-end test against a real Octane + Swoole server.
#
#   tests/e2e/run.sh 13        # Laravel 13 (10, 11, 12 and 13 are supported)
#
# Builds a throwaway Laravel app under tests/e2e/.apps/laravel-<version> (kept between runs),
# links this package into it, fills a few Swoole tables and runs tests/e2e/e2e.mjs in a browser.
# Needs Docker and Node. Locally PW_CHANNEL=chrome uses the installed Chrome instead of a downloaded Chromium.
set -eu

VERSION=${1:-13}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
E2E=$ROOT/tests/e2e
APP=$E2E/.apps/laravel-$VERSION
PORT=${OTM_E2E_PORT:-8097}
NAME=otm-e2e-$VERSION
IMAGE=otm-e2e-swoole

docker build -q -t $IMAGE "$E2E" >/dev/null

in_app() {
    docker run --rm -v "$APP:/app" -v "$ROOT:/package" -w /app $IMAGE sh -c "$1"
}

if [ ! -f "$APP/artisan" ]; then
    mkdir -p "$E2E/.apps"
    docker run --rm -v "$E2E/.apps:/apps" $IMAGE \
        composer create-project "laravel/laravel:^$VERSION.0" "/apps/laravel-$VERSION" --no-interaction --quiet --no-install --no-scripts
    # Throwaway app only: Composer refuses Laravel 10/11 releases that have security advisories (both are end of life).
    in_app 'composer config policy.advisories.block false \
        && composer install --no-interaction --quiet \
        && { [ -f .env ] || cp .env.example .env; } \
        && php artisan key:generate --no-interaction \
        && { ! grep -q "^DB_CONNECTION=sqlite" .env || { touch database/database.sqlite && php artisan migrate --force --no-interaction; }; } \
        && composer config repositories.otm "{\"type\":\"path\",\"url\":\"/package\",\"options\":{\"symlink\":true}}" \
        && composer require laravel/octane "klc/octane-table-manager:*@dev" -W --no-interaction --quiet \
        && php artisan octane:install --server=swoole --no-interaction \
        && php /package/tests/e2e/fixtures/install.php'
fi

start() {
    docker rm -f $NAME >/dev/null 2>&1 || true
    docker run -d --name $NAME -e APP_ENV="$1" -e OTM_READ_ONLY="${2:-false}" ${3:-} -p $PORT:8000 -v "$APP:/app" -v "$ROOT:/package" -w /app $IMAGE \
        php artisan octane:start --server=swoole --host=0.0.0.0 --port=8000 --workers=4 >/dev/null
    for _ in $(seq 1 60); do
        [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/otm-e2e/ping")" = 200 ] && return 0
        sleep 1
    done
    docker logs $NAME
    exit 1
}
trap 'docker rm -f $NAME >/dev/null 2>&1 || true' EXIT

echo "== Laravel $VERSION: $(in_app 'php artisan --version')"

start local
curl -sf "http://localhost:$PORT/otm-e2e/seed" >/dev/null
OTM_E2E_URL="http://localhost:$PORT" OTM_E2E_LOG="$APP/storage/logs/laravel.log" node "$E2E/e2e.mjs"

start local true
curl -sf "http://localhost:$PORT/otm-e2e/seed" >/dev/null
OTM_E2E_URL="http://localhost:$PORT" node "$E2E/e2e.mjs" read-only

# An empty prefix (the manager on its own host, OTM_DOMAIN keeps the app's own / away): URLs stay paths, never //assets.
start local false "-e OTM_ROUTE_PREFIX= -e OTM_DOMAIN=localhost"
js=$(curl -s "http://localhost:$PORT/" | sed -n 's/.*<script type="module" src="\([^"]*\)".*/\1/p')
status=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$js")
case $js in /assets/*) [ "$status" = 200 ] ;; *) false ;; esac && echo "OK   empty prefix -> $js $status" || { echo "FAIL empty prefix -> script src '$js' ($status)"; exit 1; }

# Outside the local environment the manager is closed unless the viewOctaneTableManager gate allows it.
start production
status=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/octane-table-manager/list")
[ "$status" = 403 ] && echo "OK   production without gate -> 403" || { echo "FAIL production without gate -> $status"; exit 1; }

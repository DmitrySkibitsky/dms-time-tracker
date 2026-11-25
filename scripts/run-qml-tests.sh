#!/bin/sh
# Runs the QML test suite (tests/qml) with qmltestrunner against the bundled lib/tracker.mjs.
# Expects `npm run build:test` to have produced tests/qml/generated/fakes.mjs.
# Starts the HTTP mock server used by tst_http.qml and stops it afterwards.
set -eu

cd "$(dirname "$0")/.."

RUNNER="${QMLTESTRUNNER:-$(command -v qmltestrunner || command -v qmltestrunner6 || true)}"
if [ -z "$RUNNER" ] && [ -x /usr/lib/qt6/bin/qmltestrunner ]; then
    RUNNER=/usr/lib/qt6/bin/qmltestrunner
fi
if [ -z "$RUNNER" ]; then
    echo "qmltestrunner not found (install Qt 6 qtdeclarative or run inside 'nix develop')" >&2
    exit 1
fi

# Nix keeps QML modules next to the binary instead of a global path.
IMPORT_ARGS=""
QML_DIR="$(dirname "$(dirname "$(readlink -f "$RUNNER")")")/lib/qt-6/qml"
if [ -d "$QML_DIR" ]; then
    IMPORT_ARGS="-import $QML_DIR"
fi

GEN=tests/qml/generated
mkdir -p "$GEN"
rm -f "$GEN/server.mjs"

node tests/integration/mockServer.ts "$GEN/server.mjs" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

i=0
while [ ! -s "$GEN/server.mjs" ]; do
    i=$((i + 1))
    if [ "$i" -gt 100 ]; then
        echo "mock server did not start" >&2
        exit 1
    fi
    sleep 0.1
done

# shellcheck disable=SC2086
QT_QPA_PLATFORM="${QML_TEST_PLATFORM:-offscreen}" TZ="${TZ:-UTC}" "$RUNNER" $IMPORT_ARGS -input tests/qml "$@"

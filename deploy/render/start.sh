#!/bin/sh
# Starts the backend and nginx in one container (deploy/render/Dockerfile).
# nginx listens on $PORT (the platform's port, default 10000); the backend always
# listens on 3000 inside the container, so the two never compete for $PORT.
# If either process exits, the other is stopped and the container exits, so the
# platform restarts it.
set -eu

NGINX_PORT="${PORT:-10000}"
BACKEND_PORT=3000

if [ "$NGINX_PORT" = "$BACKEND_PORT" ]; then
  echo "PORT must not be $BACKEND_PORT: the backend uses it inside the container" >&2
  exit 1
fi

sed "s/__PORT__/$NGINX_PORT/" /etc/nginx/draftly.conf.template > /tmp/nginx.conf
nginx -e /dev/stderr -t -q -c /tmp/nginx.conf

PORT="$BACKEND_PORT" node /app/dist/server.js &
backend_pid=$!

nginx -e /dev/stderr -c /tmp/nginx.conf -g 'daemon off;' &
nginx_pid=$!

stop() {
  kill -TERM "$backend_pid" "$nginx_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
  wait "$nginx_pid" 2>/dev/null || true
}

trap 'stop; exit 0' TERM INT

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done

echo "backend or nginx exited; stopping the container" >&2
stop
exit 1

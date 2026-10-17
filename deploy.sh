#!/bin/bash
# Kido deploy (Docker Compose): nginx vhost kido.wmmw.sh -> 127.0.0.1:4371 (ARCHITECTURE 9; 4370 is taken on this host).
#
#   ./deploy.sh up       first deploy: create .env.prod if missing, build, start, health check
#   ./deploy.sh update   git pull --ff-only, rebuild, restart, health check (not during a timed game)
#   ./deploy.sh status   container state, local and public health
#   ./deploy.sh logs     follow container logs
#   ./deploy.sh down     stop the container (the SQLite volume stays)
set -euo pipefail

DOMAIN="kido.wmmw.sh"
PORT=4371
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE=".env.prod"
cd "$APP_DIR"

# Docker needs sudo for this user on the host.
DOCKER="docker"
docker ps >/dev/null 2>&1 || DOCKER="sudo docker"
compose() { $DOCKER compose --env-file "$ENV_FILE" "$@"; }

ensure_env() {
  if [[ -f "$ENV_FILE" ]]; then return; fi
  (
    umask 077
    printf 'KIDO_ADMIN_TOKEN=%s\nKIDO_PUBLIC_URL=https://%s\n' \
      "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" "$DOMAIN" > "$ENV_FILE"
  )
  echo "created $ENV_FILE (mode 600); store KIDO_ADMIN_TOKEN for Maïa, never print it"
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if body=$(curl -fsS "http://127.0.0.1:${PORT}/healthz" 2>/dev/null); then
      echo "healthy: $body"
      return 0
    fi
    sleep 2
  done
  echo "app did not become healthy; see ./deploy.sh logs" >&2
  return 1
}

build_and_start() {
  GIT_SHA="$(git rev-parse --short HEAD)"
  export GIT_SHA
  if [[ "$DOCKER" == sudo* ]]; then
    sudo GIT_SHA="$GIT_SHA" docker compose --env-file "$ENV_FILE" up -d --build
  else
    compose up -d --build
  fi
  wait_healthy
}

case "${1:-status}" in
  up)
    ensure_env
    build_and_start
    ;;
  update)
    [[ -f "$ENV_FILE" ]] || { echo "no $ENV_FILE: run ./deploy.sh up first" >&2; exit 1; }
    git pull --ff-only
    build_and_start
    ;;
  status)
    compose ps
    echo "local:  $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/healthz" || true)"
    echo "public: $(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/healthz" || true)"
    ;;
  logs)
    compose logs -f
    ;;
  down)
    compose down
    ;;
  *)
    echo "usage: $0 {up|update|status|logs|down}" >&2
    exit 2
    ;;
esac

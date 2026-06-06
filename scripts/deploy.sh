#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_PROJECT="${COMPOSE_PROJECT:-warera-eco-simulator}"
PROXY_NETWORK="${PROXY_NETWORK:-proxy}"
ENABLE_TRAEFIK="${ENABLE_TRAEFIK:-0}"
TRAEFIK_COMPOSE_FILE="${TRAEFIK_COMPOSE_FILE:-docker-compose.traefik.yml}"

RUN_TESTS=1
FOLLOW_LOGS=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy.sh [options]

Builds the Eco Simulator image, optionally runs the containerized Node checks,
and restarts the web service.

Options:
  --skip-tests        Do not run the docker-compose test service.
  --logs              Follow web logs after deploy.
  -h, --help          Show this help.

Environment overrides:
  COMPOSE_PROJECT     Compose project name. Default: warera-eco-simulator
  ENABLE_TRAEFIK      Include docker-compose.traefik.yml when set to 1. Default: 0
  TRAEFIK_COMPOSE_FILE Optional Traefik compose overlay. Default: docker-compose.traefik.yml
  PROXY_NETWORK       External Traefik network name when ENABLE_TRAEFIK=1. Default: proxy
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)
      RUN_TESTS=0
      ;;
    --logs)
      FOLLOW_LOGS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

COMPOSE_FILES=(-f docker-compose.yml)
if [[ "$ENABLE_TRAEFIK" == "1" ]]; then
  COMPOSE_FILES+=(-f "$TRAEFIK_COMPOSE_FILE")
fi
COMPOSE_ARGS=("${COMPOSE_FILES[@]}" -p "$COMPOSE_PROJECT")

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo -n docker)
else
  echo "Docker is required, but this user cannot access the Docker daemon." >&2
  exit 1
fi

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose "${COMPOSE_ARGS[@]}")
elif command -v docker-compose >/dev/null 2>&1; then
  if [[ "${DOCKER[*]}" == "docker" ]]; then
    COMPOSE=(docker-compose "${COMPOSE_ARGS[@]}")
  else
    COMPOSE=(sudo -n docker-compose "${COMPOSE_ARGS[@]}")
  fi
else
  echo "Docker Compose is required, but neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

run() {
  echo
  echo "+ $*"
  "$@"
}

echo "Deploying WarEra Eco Simulator from $ROOT_DIR"

if [[ "$ENABLE_TRAEFIK" == "1" ]] && ! "${DOCKER[@]}" network inspect "$PROXY_NETWORK" >/dev/null 2>&1; then
  run "${DOCKER[@]}" network create "$PROXY_NETWORK"
fi

run "${COMPOSE[@]}" build

if [[ "$RUN_TESTS" -eq 1 ]]; then
  run "${COMPOSE[@]}" run --rm test
fi

run "${COMPOSE[@]}" up -d --no-deps --remove-orphans web
run "${COMPOSE[@]}" ps

echo
echo "Deploy complete."

if [[ "$FOLLOW_LOGS" -eq 1 ]]; then
  run "${COMPOSE[@]}" logs -f --tail=100 web
fi

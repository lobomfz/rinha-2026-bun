#!/usr/bin/env bash
set -euo pipefail

DOCKER_USER=${DOCKER_USER:?DOCKER_USER required (Docker Hub namespace)}
TAG=v1

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_DIR"

RUNTIME="${DOCKER_USER}/bun-rinha-runtime:${TAG}"
API="${DOCKER_USER}/rinha-v2-api:${TAG}"
LB="${DOCKER_USER}/rinha-v2-lb:${TAG}"

echo "==> building $RUNTIME"
DOCKER_BUILDKIT=1 docker build \
  -f bun-custom/Dockerfile \
  --target bun-binary \
  -t "$RUNTIME" \
  .

echo "==> building $API"
DOCKER_BUILDKIT=1 docker build \
  -f Dockerfile \
  --target prod \
  --build-arg BUN_RUNTIME_IMAGE="$RUNTIME" \
  -t "$API" \
  .

echo "==> building $LB"
DOCKER_BUILDKIT=1 docker build \
  -f load-balancer/Dockerfile \
  --target prod \
  --build-arg BUN_RUNTIME_IMAGE="$RUNTIME" \
  -t "$LB" \
  load-balancer

echo "==> pushing"
docker push "$RUNTIME"
docker push "$API"
docker push "$LB"

echo "==> done"
echo "    $RUNTIME"
echo "    $API"
echo "    $LB"

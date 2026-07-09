#!/usr/bin/env bash
set -euo pipefail

# Enable BuildKit for cache mounts and faster layer resolution.
export DOCKER_BUILDKIT=1

DRY_RUN=false
FORCE=false
VERSION=""

for arg in "$@"; do
    case "$arg" in
        --dry)
            DRY_RUN=true
            ;;
        -f)
            FORCE=true
            ;;
        *)
            VERSION="$arg"
            ;;
    esac
done

if [ -z "$VERSION" ]; then
	echo "Usage: sh publish.sh [--dry] [-f] <version>"
	exit 1
fi

PREFIX="git.troople.be/troople/idenplane"

DOCKER_BUILD_ARGS=(
	-f Dockerfile
	-t "$PREFIX:latest"
	-t "$PREFIX:$VERSION"
)

if [ "$FORCE" = true ]; then
	DOCKER_BUILD_ARGS+=(--no-cache)
fi

docker build \
	"${DOCKER_BUILD_ARGS[@]}" \
	--platform linux/amd64 .

if [ "$DRY_RUN" = false ]; then
	docker push "$PREFIX:latest"
	docker push "$PREFIX:$VERSION"
fi
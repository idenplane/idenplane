#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
VERSION=""

for arg in "$@"; do
    case "$arg" in
        --dry)
            DRY_RUN=true
            ;;
        *)
            VERSION="$arg"
            ;;
    esac
done

if [ -z "$VERSION" ]; then
	echo "Usage: sh publish.sh [--dry] <version>"
	exit 1
fi

PREFIX="git.troople.be/troople/idenplane"

docker build \
	-f Dockerfile \
	-t "$PREFIX:latest" \
	-t "$PREFIX:$VERSION" \
	--platform linux/amd64 .

if [ "$DRY_RUN" = false ]; then
	docker push "$PREFIX:latest"
	docker push "$PREFIX:$VERSION"
fi
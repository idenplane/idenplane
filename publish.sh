#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
	echo "Usage: sh build.sh <version>"
	exit 1
fi

PREFIX="git.troople.be/troople/idenplane"

docker build \
	-f Dockerfile \
	-t "$PREFIX:latest" \
	-t "$PREFIX:$VERSION" \
	--platform linux/amd64 .

docker push "$PREFIX:latest"
docker push "$PREFIX:$VERSION"
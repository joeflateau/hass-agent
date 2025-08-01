#!/bin/bash

set -e

RELEASE_TYPE=${1:-patch}

# Fetch tags from origin to ensure we have the latest
echo "Fetching tags from origin..."
git fetch --tags

# Get the latest tag, default to v0.0.0 if no tags exist
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")

echo "Latest tag: $LATEST_TAG"

# Remove 'v' prefix and split version
VERSION=${LATEST_TAG#v}
IFS='.' read -ra VERSION_PARTS <<< "$VERSION"

MAJOR=${VERSION_PARTS[0]:-0}
MINOR=${VERSION_PARTS[1]:-0}
PATCH=${VERSION_PARTS[2]:-0}

# Bump version based on release type
case $RELEASE_TYPE in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Invalid release type: $RELEASE_TYPE. Use major, minor, or patch."
    exit 1
    ;;
esac

NEW_VERSION="v$MAJOR.$MINOR.$PATCH"

echo "Bumping from $LATEST_TAG to $NEW_VERSION"

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Working directory is not clean. Please commit or stash changes first."
  exit 1
fi

# Push any local commits to origin
echo "Pushing any local commits..."
git push origin HEAD

# Create and push the new tag
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"
git push origin "$NEW_VERSION"

echo "Successfully created and pushed tag: $NEW_VERSION"

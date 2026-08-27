#!/usr/bin/env bash
#
# update-from-upstream.sh
# Safely pull the author's (upstream) updates into this fork's main branch.
#
# This is the CORRECT way to update this fork. Do NOT use `gh repo sync` — with our own
# commits it either fails or, with --force, deletes our work. A merge keeps both sides.
#
set -euo pipefail

BRANCH="${1:-main}"

# Ensure upstream remote exists (author's repo).
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding 'upstream' remote -> bilawalsidhu/gods-eye-view"
  git remote add upstream https://github.com/bilawalsidhu/gods-eye-view.git
fi

echo "==> Fetching upstream..."
git fetch upstream

# Refuse to run with a dirty tree so nothing gets clobbered.
if ! git diff-index --quiet HEAD --; then
  echo "ERROR: You have uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

echo "==> Switching to '$BRANCH'..."
git checkout "$BRANCH"

BEHIND=$(git rev-list --count "$BRANCH"..upstream/main)
if [ "$BEHIND" -eq 0 ]; then
  echo "Already up to date with upstream. Nothing to merge."
  exit 0
fi

echo "==> upstream/main has $BEHIND new commit(s). Merging..."
if git merge --no-edit upstream/main; then
  echo ""
  echo "Merge succeeded. Recommended next steps:"
  echo "  npm install && npm test"
  echo "  git push origin $BRANCH"
else
  echo ""
  echo "!! Merge stopped on CONFLICTS (only in files edited on both sides)."
  echo "   Resolve them, then:  git add -A && git commit"
  echo "   Files with conflicts:"
  git diff --name-only --diff-filter=U | sed 's/^/     - /'
  echo "   (Ask Claude to help resolve — then npm test and git push origin $BRANCH)"
  exit 1
fi

#!/usr/bin/env bash
# Push HEAD to the staging site (andersonjacob2012/deadhead-to-diesel-king-staging, GitHub Pages from main /) and wait until it serves it.
#   tools/stage.sh            -> prints the staging URL and SHA once staging index.html == HEAD's index.html
# Staging shares the live origin but uses its own save keys (idletruck_staging), shows a STAGING badge and is noindex (see index.html DK_STAGE).
# Nothing reaches live from here: QA passes staging, then tools/promote.sh <sha>.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REPO=andersonjacob2012/deadhead-to-diesel-king-staging URL=https://andersonjacob2012.github.io/deadhead-to-diesel-king-staging/
git remote get-url staging >/dev/null 2>&1 || git remote add staging "https://github.com/$REPO.git"
git diff --quiet && git diff --cached --quiet || echo "note: uncommitted tracked changes are NOT staged (only commits are pushed)" >&2
sha=$(git rev-parse HEAD); short=$(git rev-parse --short=7 HEAD)
git push -f staging HEAD:refs/heads/main
want=$(git show HEAD:index.html | sha256sum | cut -d' ' -f1)
for i in $(seq 1 120); do
  got=$(curl -fsSL -H 'Cache-Control: no-cache' "${URL}index.html?cb=$(date +%s%N)" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)
  [[ $got == "$want" ]] && { shown=$(git show HEAD:index.html | sed -n "s/^const VERSION='\([^']*\)',BUILD='\([^']*\)'.*/v\1 (\2)/p"); echo "STAGED $short ($sha)"; echo "URL $URL"; echo "shows: STAGING · $shown"; exit 0; }
  sleep 10
done
echo "staging did not serve $short within 20 min (check: gh api repos/$REPO/pages/builds/latest)" >&2; exit 1

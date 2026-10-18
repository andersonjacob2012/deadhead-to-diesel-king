#!/usr/bin/env bash
# Stage a source commit: tools/stage.sh [<src>]   (default HEAD)
# Builds the deploy commit (tools/deploy-commit.sh: <src> + version.json stamped with <src>'s SHA), force-pushes it to the staging site
# (andersonjacob2012/deadhead-to-diesel-king-staging, GitHub Pages from main /) and waits until staging serves its index.html AND version.json.
# The game then shows "STAGING · vX.Y.Z (<src short>)". Staging shares the live origin but uses its own save keys (idletruck_staging), a STAGING badge and noindex.
# Nothing reaches live from here: QA passes staging, then tools/promote.sh <src short> pushes this same deploy commit live.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REPO=andersonjacob2012/deadhead-to-diesel-king-staging URL=https://andersonjacob2012.github.io/deadhead-to-diesel-king-staging/
git remote get-url staging >/dev/null 2>&1 || git remote add staging "https://github.com/$REPO.git"
git diff --quiet && git diff --cached --quiet || echo "note: uncommitted tracked changes are NOT staged (only commits are pushed)" >&2
src=$(git rev-parse --verify "${1:-HEAD}^{commit}"); short=${src:0:7}
dep=$(tools/deploy-commit.sh "$src")
git update-ref refs/deploy/staging "$dep"
git push -f staging "$dep:refs/heads/main"
want=$(git show "$dep:index.html" | sha256sum | cut -d' ' -f1)
for i in $(seq 1 120); do
  got=$(curl -fsSL -H 'Cache-Control: no-cache' "${URL}index.html?cb=$(date +%s%N)" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)
  vj=$(curl -fsSL -H 'Cache-Control: no-cache' "${URL}version.json?cb=$(date +%s%N)" 2>/dev/null || true)
  if [[ $got == "$want" && $vj == *"\"sha\":\"$src\""* ]]; then
    ver=$(git show "$dep:version.json" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    echo "STAGED $short ($src) as deploy commit $(git rev-parse --short=7 "$dep")"; echo "URL $URL"; echo "shows: STAGING · v$ver ($short)"
    echo "after QA passes: tools/promote.sh $short"; exit 0
  fi
  sleep 10
done
echo "staging did not serve $short within 20 min (check: gh api repos/$REPO/pages/builds/latest)" >&2; exit 1

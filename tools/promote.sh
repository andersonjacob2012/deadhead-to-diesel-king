#!/usr/bin/env bash
# Promote a QA-passed staging build to live: tools/promote.sh <sha>
# Refuses unless <sha> is exactly what staging main has AND what the staging site serves; then pushes that exact commit
# to origin main (fast-forward only, never force) and waits until live index.html matches.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 1 ]] || { echo "usage: $0 <sha>   (the staging SHA QA passed)" >&2; exit 2; }
SURL=https://andersonjacob2012.github.io/deadhead-to-diesel-king-staging/ LURL=https://andersonjacob2012.github.io/deadhead-to-diesel-king/
sha=$(git rev-parse --verify "$1^{commit}") || { echo "unknown commit $1" >&2; exit 1; }
git fetch -q staging main && git fetch -q origin main
st=$(git rev-parse staging/main)
[[ $st == "$sha" ]] || { echo "REFUSED: staging main is $(git rev-parse --short=7 "$st"), not $(git rev-parse --short=7 "$sha"). Stage it and have QA pass it first." >&2; exit 1; }
want=$(git show "$sha:index.html" | sha256sum | cut -d' ' -f1)
got=$(curl -fsSL "${SURL}index.html?cb=$(date +%s%N)" | sha256sum | cut -d' ' -f1)
[[ $got == "$want" ]] || { echo "REFUSED: the staging site is not serving $sha yet (wait for tools/stage.sh to finish)" >&2; exit 1; }
git merge-base --is-ancestor origin/main "$sha" || { echo "REFUSED: $sha is not a fast-forward of origin/main $(git rev-parse --short=7 origin/main)" >&2; exit 1; }
git push origin "$sha:refs/heads/main"
for i in $(seq 1 120); do
  got=$(curl -fsSL -H 'Cache-Control: no-cache' "${LURL}index.html?cb=$(date +%s%N)" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)
  [[ $got == "$want" ]] && { echo "LIVE $(git rev-parse --short=7 "$sha") at $LURL"; exit 0; }
  sleep 10
done
echo "live did not match within 20 min (check Pages builds)" >&2; exit 1

#!/usr/bin/env bash
# Promote a QA-passed staging build to live: tools/promote.sh <sha>   (<sha> = the source SHA QA saw on staging, "vX.Y.Z (<sha>)"; the deploy commit SHA also works)
# Refuses unless staging main is the deploy commit of exactly that source (first parent + version.json sha) AND the staging site serves it;
# then pushes that same deploy commit to origin main (fast-forward only, never force), so live serves the identical tree and shows the same
# "vX.Y.Z (<sha>)", and waits until live index.html and version.json match.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 1 ]] || { echo "usage: $0 <sha>   (the staging build QA passed)" >&2; exit 2; }
SURL=https://andersonjacob2012.github.io/deadhead-to-diesel-king-staging/ LURL=https://andersonjacob2012.github.io/deadhead-to-diesel-king/
arg=$(git rev-parse --verify "$1^{commit}") || { echo "unknown commit $1" >&2; exit 1; }
git fetch -q staging main && git fetch -q origin main
dep=$(git rev-parse staging/main)
src=$(git show "$dep:version.json" 2>/dev/null | sed -n 's/.*"sha":"\([0-9a-f]\{40\}\)".*/\1/p')
[[ -n $src && $(git rev-parse "$dep^1") == "$src" ]] || { echo "REFUSED: staging main $(git rev-parse --short=7 "$dep") is not a deploy commit (re-stage with tools/stage.sh)" >&2; exit 1; }
[[ $arg == "$src" || $arg == "$dep" ]] || { echo "REFUSED: staging serves build ${src:0:7}, not $(git rev-parse --short=7 "$arg"). Stage it and have QA pass it first." >&2; exit 1; }
want=$(git show "$dep:index.html" | sha256sum | cut -d' ' -f1)
got=$(curl -fsSL "${SURL}index.html?cb=$(date +%s%N)" | sha256sum | cut -d' ' -f1)
vj=$(curl -fsSL "${SURL}version.json?cb=$(date +%s%N)" || true)
[[ $got == "$want" && $vj == *"\"sha\":\"$src\""* ]] || { echo "REFUSED: the staging site is not serving ${src:0:7} yet (wait for tools/stage.sh to finish)" >&2; exit 1; }
git merge-base --is-ancestor origin/main "$dep" || { echo "REFUSED: deploy commit is not a fast-forward of origin/main $(git rev-parse --short=7 origin/main): re-stage (live moved)" >&2; exit 1; }
git push origin "$dep:refs/heads/main"
for i in $(seq 1 120); do
  got=$(curl -fsSL -H 'Cache-Control: no-cache' "${LURL}index.html?cb=$(date +%s%N)" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)
  vj=$(curl -fsSL -H 'Cache-Control: no-cache' "${LURL}version.json?cb=$(date +%s%N)" 2>/dev/null || true)
  [[ $got == "$want" && $vj == *"\"sha\":\"$src\""* ]] && { echo "LIVE ${src:0:7} (deploy commit $(git rev-parse --short=7 "$dep")) at $LURL"; exit 0; }
  sleep 10
done
echo "live did not match within 20 min (check Pages builds)" >&2; exit 1

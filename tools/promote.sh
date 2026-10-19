#!/usr/bin/env bash
# Promote a QA-passed staging build to live: tools/promote.sh <sha>   (<sha> = the source SHA QA saw on staging, "vX.Y.Z (<sha>)"; the deploy commit SHA also works)
# Refuses unless staging main is the deploy commit of exactly that source (first parent + version.json sha) AND the staging site serves it;
# then pushes that same deploy commit to origin main (fast-forward only, never force), so live serves the identical tree and shows the same
# "vX.Y.Z (<sha>)", and waits until live index.html and version.json match.
# Then the new site: the same build + CNAME (tools/deploy-commit.sh --web) goes to remote `web` (andersonjacob2012/deadheadtodieselking-web,
# deadheadtodieselking.com); skipped with a warning if that remote or repo doesn't exist yet. A build that carries the domain-move redirect
# (the old github.io index forwards players and their save to deadheadtodieselking.com) goes to `web` FIRST and must be served there,
# otherwise it is refused: pushing it to origin alone would send every player to a dead domain.
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
WURL=https://deadheadtodieselking.com/
web(){ # push the web deploy commit of $src; returns 1 (with a warning) if the web remote/repo isn't there
  git remote get-url web >/dev/null 2>&1 || { echo "WARNING: no 'web' remote (git remote add web https://github.com/andersonjacob2012/deadheadtodieselking-web.git): skipped deadheadtodieselking.com" >&2; return 1; }
  git ls-remote --exit-code web >/dev/null 2>&1; [[ $? -le 2 ]] || { echo "WARNING: web repo unreachable or missing: skipped deadheadtodieselking.com" >&2; return 1; }
  wdep=$(tools/deploy-commit.sh --web "$src") || return 1
  local old; old=$(git ls-remote web refs/heads/main | cut -f1)  # deploy-only repo: replace whatever is there (README / GitHub's CNAME commit), but only if it hasn't moved since we looked
  git push --force-with-lease="refs/heads/main:$old" web "$wdep:refs/heads/main" || return 1
  for i in $(seq 1 60); do
    vj=$(curl -fsSL -H 'Cache-Control: no-cache' "${WURL}version.json?cb=$(date +%s%N)" 2>/dev/null || true)
    [[ $vj == *"\"sha\":\"$src\""* ]] && { echo "WEB ${src:0:7} (deploy commit $(git rev-parse --short=7 "$wdep")) at $WURL"; return 0; }
    sleep 10
  done
  echo "WARNING: $WURL did not serve ${src:0:7} within 10 min (check Pages / DNS / HTTPS)" >&2; return 1
}
MOVE=0; git show "$dep:index.html" | grep -q 'dkmove=' && MOVE=1
if [[ $MOVE == 1 ]]; then web || { echo "REFUSED: this build redirects the old site to $WURL, which isn't serving it; live left unchanged" >&2; exit 1; }; fi
git push origin "$dep:refs/heads/main"
for i in $(seq 1 120); do
  got=$(curl -fsSL -H 'Cache-Control: no-cache' "${LURL}index.html?cb=$(date +%s%N)" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)
  vj=$(curl -fsSL -H 'Cache-Control: no-cache' "${LURL}version.json?cb=$(date +%s%N)" 2>/dev/null || true)
  [[ $got == "$want" && $vj == *"\"sha\":\"$src\""* ]] && { echo "LIVE ${src:0:7} (deploy commit $(git rev-parse --short=7 "$dep")) at $LURL"; [[ $MOVE == 1 ]] || web || true; exit 0; }
  sleep 10
done
echo "live did not match within 20 min (check Pages builds)" >&2; exit 1

#!/usr/bin/env bash
# Build the deploy commit for a source commit: tools/deploy-commit.sh [--web] [<src>]  -> prints the deploy commit SHA (creates no branch, touches no working tree).
# Targets: default = staging/live (fast-forwards origin/main, the github.io site). --web = the deadheadtodieselking.com Pages repo (remote `web`):
# same tree plus a CNAME file (deadheadtodieselking.com), parent <src> only. Only the web target ever gets a CNAME.
# Deploy commit = <src>'s tree + version.json {"version":VERSION,"build":<src short>,"sha":<src full>}, first parent <src>.
# If live (origin/main) is an earlier deploy commit that <src> doesn't contain, it becomes the second parent, so promoting stays a fast-forward
# (source branches never need the deploy commits). Refuses if live has source commits that <src> lacks.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
R=origin; [[ ${1:-} == --web ]] && { R=web; shift; }
src=$(git rev-parse --verify "${1:-HEAD}^{commit}"); short=${src:0:7}
ver=$(git show "$src:index.html" | sed -n "s/^const VERSION='\([0-9]*\.[0-9]*\.[0-9]*\)'.*/\1/p")
[[ -n $ver ]] || { echo "VERSION not found in $short:index.html" >&2; exit 1; }
P=(-p "$src"); live=
# web is deploy-only (promote.sh force-pushes it with a lease; GitHub may add its own CNAME commit there), so it never needs a second parent
[[ $R == web ]] || { git fetch -q origin main && live=$(git rev-parse origin/main); } || { echo "cannot fetch origin main" >&2; exit 1; }
if [[ -n $live ]] && ! git merge-base --is-ancestor "$live" "$src"; then
  lsrc=$(git show "$live:version.json" 2>/dev/null | sed -n 's/.*"sha":"\([0-9a-f]\{40\}\)".*/\1/p')
  [[ -n $lsrc && $(git rev-parse "$live^1") == "$lsrc" ]] && git merge-base --is-ancestor "$lsrc" "$src" \
    || { echo "REFUSED: live $(git rev-parse --short=7 "$live") has commits that $short does not contain: merge origin/main first" >&2; exit 1; }
  P+=(-p "$live")
fi
idx=$(mktemp); trap 'rm -f "$idx"' EXIT
GIT_INDEX_FILE=$idx git read-tree "$src"
blob=$(printf '{"version":"%s","build":"%s","sha":"%s"}\n' "$ver" "$short" "$src" | git hash-object -w --stdin)
GIT_INDEX_FILE=$idx git update-index --add --cacheinfo "100644,$blob,version.json"
[[ $R == web ]] && GIT_INDEX_FILE=$idx git update-index --add --cacheinfo "100644,$(echo deadheadtodieselking.com | git hash-object -w --stdin),CNAME"
tree=$(GIT_INDEX_FILE=$idx git write-tree)
git commit-tree "$tree" "${P[@]}" -m "Deploy v$ver (build $short)$([[ $R == web ]] && echo " for deadheadtodieselking.com")" -m "Source $src. Tree = source + stamped version.json (tools/deploy-commit.sh)."

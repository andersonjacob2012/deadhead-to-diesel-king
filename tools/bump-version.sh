#!/usr/bin/env bash
# Deadhead to Diesel King: version + build stamp (web and the Capacitor apps share one number).
#
#   tools/bump-version.sh patch "Player-facing note" ["another note" ...]   # fixes:    1.0.2 -> 1.0.3
#   tools/bump-version.sh minor "Player-facing note" ...                    # features: 1.0.2 -> 1.1.0
#   tools/bump-version.sh stamp                                             # no bump; only re-stamp the build hash
#
# What it does (run on main with the release's code already committed):
#   1. bump/minor: VERSION in index.html, "version" in package.json, versionName/versionCode (+1) in
#      android/app/build.gradle, MARKETING_VERSION / CURRENT_PROJECT_VERSION in the iOS project if present,
#      and prepends a CHANGELOG.md entry (notes from the args, newest first).
#   2. stamp: writes BUILD='<short SHA of the current HEAD>' into index.html, then commits everything as
#      "Release vX.Y.Z (build <sha>)".
# So the live commit is the release commit and the hash the game shows ("v1.0.3 (abc1234)") is its immediate
# parent: the last code commit. GitHub Pages deploys straight from main (legacy build, no Actions), so the
# hash cannot be stamped at deploy time; this keeps it inline (works offline, file://, and inside the app,
# since platform/build-www.mjs copies index.html as is). The pre-push hook (tools/pre-push, installed with
# `tools/bump-version.sh hook`) refuses a push to main whose BUILD is not the pushed commit or its parent.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mode=${1:-}; shift || true
if [[ $mode == hook ]]; then
  hd=$(git rev-parse --git-common-dir)/hooks; install -m 755 tools/pre-push "$hd/pre-push"; echo "installed $hd/pre-push"; exit 0
fi
[[ $mode =~ ^(patch|minor|stamp)$ ]] || { echo "usage: $0 patch|minor|stamp|hook [notes...]" >&2; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo "commit or stash tracked changes first (the stamp must name a real commit)" >&2; exit 1; }
cur=$(sed -n "s/^const VERSION='\([0-9]*\.[0-9]*\.[0-9]*\)'.*/\1/p" index.html)
[[ -n $cur ]] || { echo "VERSION not found in index.html" >&2; exit 1; }
IFS=. read -r MA MI PA <<<"$cur"
case $mode in patch) new="$MA.$MI.$((PA+1))";; minor) new="$MA.$((MI+1)).0";; stamp) new=$cur;; esac
sha=$(git rev-parse --short=7 HEAD)
sed -i "s/^const VERSION='$cur',BUILD='[^']*'/const VERSION='$new',BUILD='$sha'/" index.html
grep -q "^const VERSION='$new',BUILD='$sha'" index.html || { echo "stamp failed" >&2; git checkout index.html; exit 1; }
if [[ $mode != stamp ]]; then
  [[ -f package.json ]] && sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$new\"/" package.json
  [[ -f package-lock.json ]] && node -e "const f='package-lock.json',j=require('./'+f);j.version='$new';if(j.packages&&j.packages[''])j.packages[''].version='$new';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\\n')"
  g=android/app/build.gradle
  if [[ -f $g ]]; then
    vc=$(sed -n 's/^\s*versionCode \([0-9]*\).*/\1/p' $g | head -1)
    sed -i -e "s/^\(\s*versionCode \)[0-9]*/\1$((vc+1))/" -e "s/^\(\s*versionName \)\"[^\"]*\"/\1\"$new\"/" $g
  fi
  p=ios/App/App.xcodeproj/project.pbxproj
  if [[ -f $p ]] && grep -q MARKETING_VERSION $p; then
    bn=$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([0-9]*\);.*/\1/p' $p | head -1)
    sed -i -e "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $new;/" -e "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $(( ${bn:-0}+1 ));/" $p
  fi
  [[ $# -gt 0 ]] || set -- "Fixes and polish."
  { echo "# Changelog"; echo; echo "## $new — $(date +%Y-%m-%d)"; for n in "$@"; do echo "- $n"; done; echo
    [[ -f CHANGELOG.md ]] && sed '1{/^# Changelog/d}' CHANGELOG.md | sed '1{/^$/d}'; } > CHANGELOG.md.tmp
  mv CHANGELOG.md.tmp CHANGELOG.md
fi
for f in index.html package.json package-lock.json android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj CHANGELOG.md; do [[ -f $f ]] && git add -- "$f"; done
git commit -q -m "Release v$new (build $sha)"
echo "v$new ($sha) committed as $(git rev-parse --short=7 HEAD); push with: git push origin main"

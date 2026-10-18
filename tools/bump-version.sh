#!/usr/bin/env bash
# Deadhead to Diesel King: version number (web and the Capacitor apps share one number).
#
#   tools/bump-version.sh patch "Player-facing note" ["another note" ...]   # fixes:    1.0.2 -> 1.0.3
#   tools/bump-version.sh minor "Player-facing note" ...                    # features: 1.0.2 -> 1.1.0
#   tools/bump-version.sh hook                                              # install the pre-push guard (tools/pre-push)
#
# What it does (run on main with the release's code already committed): VERSION in index.html, "version" in package.json,
# versionName/versionCode (+1) in android/app/build.gradle, MARKETING_VERSION / CURRENT_PROJECT_VERSION in the iOS project if
# present, prepends a CHANGELOG.md entry (notes from the args, newest first) and commits "Release vX.Y.Z".
# The build hash is NOT in the source any more (a commit can't hold its own SHA): tools/stage.sh stamps version.json with the
# source SHA in a deploy commit, staging serves it, tools/promote.sh pushes that same deploy commit live, and the game shows
# "vX.Y.Z (<source sha>)" from version.json (vX.Y.Z only when it can't be read). platform/build-www.mjs stamps the app's copy.
# The pre-push hook (tools/pre-push, installed with `tools/bump-version.sh hook`) only lets deploy commits onto main.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mode=${1:-}; shift || true
if [[ $mode == hook ]]; then
  hd=$(git rev-parse --git-common-dir)/hooks; install -m 755 tools/pre-push "$hd/pre-push"; echo "installed $hd/pre-push"; exit 0
fi
[[ $mode =~ ^(patch|minor)$ ]] || { echo "usage: $0 patch|minor|hook [notes...]" >&2; exit 2; }
FILES="index.html package.json package-lock.json android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj CHANGELOG.md"
git diff --cached --quiet || { echo "staged changes present: commit them first" >&2; exit 1; }
for f in $FILES; do [[ -f $f ]] && ! git diff --quiet -- "$f" && { echo "$f has uncommitted changes: commit them first" >&2; exit 1; }; done
[[ -z $(git status --porcelain --untracked-files=no) ]] || echo "note: other uncommitted tracked files are left out of the release commit: $(git status --porcelain --untracked-files=no | awk '{print $2}' | tr '\n' ' ')" >&2
cur=$(sed -n "s/^const VERSION='\([0-9]*\.[0-9]*\.[0-9]*\)'.*/\1/p" index.html)
[[ -n $cur ]] || { echo "VERSION not found in index.html" >&2; exit 1; }
IFS=. read -r MA MI PA <<<"$cur"
case $mode in patch) new="$MA.$MI.$((PA+1))";; minor) new="$MA.$((MI+1)).0";; esac
sed -i "s/^const VERSION='$cur';/const VERSION='$new';/" index.html
grep -q "^const VERSION='$new';" index.html || { echo "VERSION update failed" >&2; git checkout index.html; exit 1; }
if true; then
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
for f in $FILES; do [[ -f $f ]] && git add -- "$f"; done
git commit -q -m "Release v$new"
echo "v$new committed as $(git rev-parse --short=7 HEAD); next: tools/stage.sh (QA on staging; it shows v$new ($(git rev-parse --short=7 HEAD))), then tools/promote.sh $(git rev-parse --short=7 HEAD)"

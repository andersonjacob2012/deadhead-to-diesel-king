#!/usr/bin/env bash
# Fill the release contact details in ONE place (tools/release-contact.env) and write them everywhere they ship:
#   index.html  const FEEDBACK_EMAIL='...'   (in-game Feedback mailto, Copy report "To:", the address shown in the form)
#   privacy.html <- /workspace/business/privacy.html with every [PLACEHOLDER] filled and "version 1.0.x" -> this VERSION's "X.Y.x"
# Dry run by default (prints what would change); --apply writes the two files. Commits, stages, pushes nothing.
# Refuses if anything is left unfilled: an empty required value, a [..] placeholder, or example.com.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ENV=${ENV_FILE:-tools/release-contact.env}; SRC=${PRIVACY_SRC:-/workspace/business/privacy.html}
[[ -f $ENV ]] || { echo "missing $ENV (copy tools/release-contact.env.example and fill it in)" >&2; exit 2; }
# shellcheck disable=SC1090
source "$ENV"
: "${CONTACT_EMAIL:=$FEEDBACK_EMAIL}" "${EFFECTIVE_DATE:=$(date '+%B %-d, %Y')}" "${YEAR:=$(date +%Y)}" "${DELETE_DAYS:=30 days}"
: "${FUTURE_RELAY:=a Cloudflare Worker or Supabase function}" "${FUTURE_RETENTION:=$FEEDBACK_RETENTION}" "${DRAFT_BANNER:=keep}" "${NOINDEX:=keep}"
miss=(); for v in FEEDBACK_EMAIL LEGAL_NAME FEEDBACK_RETENTION EMAIL_PROVIDER EMAIL_PROVIDER_POLICY_URL; do [[ -n ${!v:-} ]] || miss+=("$v"); done
((${#miss[@]}==0)) || { echo "fill in: ${miss[*]} ($ENV)" >&2; exit 1; }
re='^[^@[:space:]<>"'"'"']+@[^@[:space:]<>"'"'"']+\.[a-z]{2,}$'
for v in FEEDBACK_EMAIL CONTACT_EMAIL; do [[ ${!v} =~ $re && ${!v} != *example.com ]] || { echo "$v is not a real address: ${!v}" >&2; exit 1; }; done
[[ $EMAIL_PROVIDER_POLICY_URL =~ ^https:// ]] || { echo "EMAIL_PROVIDER_POLICY_URL must be https://..." >&2; exit 1; }
ver=$(sed -n "s/^const VERSION='\([0-9]*\.[0-9]*\)\.[0-9]*'.*/\1/p" index.html); [[ -n $ver ]] || { echo "VERSION not found in index.html" >&2; exit 1; }
out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
FEEDBACK_EMAIL="$FEEDBACK_EMAIL" CONTACT_EMAIL="$CONTACT_EMAIL" LEGAL_NAME="$LEGAL_NAME" EFFECTIVE_DATE="$EFFECTIVE_DATE" YEAR="$YEAR" EMAIL_PROVIDER="$EMAIL_PROVIDER" \
EMAIL_PROVIDER_POLICY_URL="$EMAIL_PROVIDER_POLICY_URL" FEEDBACK_RETENTION="$FEEDBACK_RETENTION" DELETE_DAYS="$DELETE_DAYS" FUTURE_RELAY="$FUTURE_RELAY" FUTURE_RETENTION="$FUTURE_RETENTION" \
DRAFT_BANNER="$DRAFT_BANNER" NOINDEX="$NOINDEX" VERX="$ver" SRC="$SRC" OUT="$out" python3 - <<'PY'
import os,re,html
E=os.environ;h=lambda k:html.escape(E[k],quote=True)
s=open(E['SRC'],encoding='utf-8').read()
link='<a href="%s">%s</a>'%(h('EMAIL_PROVIDER_POLICY_URL'),h('EMAIL_PROVIDER')+' privacy policy')
rep=[('[CONTACT EMAIL]',h('CONTACT_EMAIL')),('[FEEDBACK_EMAIL]',h('FEEDBACK_EMAIL')),('[LEGAL ENTITY NAME]',h('LEGAL_NAME')),('[EFFECTIVE DATE]',h('EFFECTIVE_DATE')),('[YEAR]',h('YEAR')),
 ('[EMAIL PROVIDER, e.g. Google Workspace]',h('EMAIL_PROVIDER')),('[LINK to our email provider’s policy]',link),('[RETENTION, e.g. up to 12 months after the issue is resolved]',h('FEEDBACK_RETENTION')),
 ('[e.g. 30 days]',h('DELETE_DAYS')),('[e.g. Cloudflare Worker / Supabase function]',h('FUTURE_RELAY')),('[RETENTION]',h('FUTURE_RETENTION'))]
# a filled placeholder loses its gold "ph" highlight; mailto: hrefs get the bare address
for k,v in rep:
    s=s.replace('<span class="ph">%s</span>'%k,v).replace(k,v)
s=s.replace('<span class="ph">%s %s</span>'%(h('YEAR'),h('LEGAL_NAME')),h('YEAR')+' '+h('LEGAL_NAME'))
s=s.replace('version 1.0.x','version %s.x'%E['VERX'])
if E['NOINDEX']=='remove':s=s.replace('<meta name="robots" content="noindex">','')
if E['DRAFT_BANNER']=='remove':s=re.sub(r'<div class="draft">.*?</div>\s*','',s,count=1,flags=re.S)
left=sorted(set(re.findall(r'\[[^\]\n<>]{2,80}\]',s)))+(['example.com'] if 'example.com' in s else [])+(['class="ph" span'] if re.search(r'class="ph">(?!gold<)',s) else [])
if left:raise SystemExit('privacy.html still has placeholders: '+', '.join(left))
open(E['OUT']+'/privacy.html','w',encoding='utf-8').write(s)
PY
esc=$(printf '%s' "$FEEDBACK_EMAIL" | sed 's/[&/\]/\\&/g')
sed "s/^const FEEDBACK_EMAIL='[^']*';.*/const FEEDBACK_EMAIL='$esc';\/\/ the one public feedback \/ privacy \/ Play-listing contact: set it in tools\/release-contact.env, written by tools\/release-contact.sh/" index.html > "$out/index.html"
[[ $(grep -c "^const FEEDBACK_EMAIL='$esc';" "$out/index.html") == 1 ]] || { echo "FEEDBACK_EMAIL line not found in index.html" >&2; exit 1; }
rg -q 'example\.com' "$out/index.html" && { echo "index.html still mentions example.com" >&2; exit 1; }
if [[ ${1:-} == --apply ]]; then cp "$out/index.html" index.html; cp "$out/privacy.html" privacy.html; git --no-pager diff --stat -- index.html privacy.html
  echo "written. Next: review privacy.html, run /workspace/pw/regall.sh wc, commit, then tools/stage.sh -> QA -> tools/promote.sh <sha>"
else (diff -u index.html "$out/index.html" || true) | rg '^[-+]const FEEDBACK_EMAIL' || true; echo "privacy.html changed lines: $( (diff -u privacy.html "$out/privacy.html" || true) | rg -c '^[-+][^-+]' || true)"; echo "dry run OK (nothing written). Re-run with --apply."; fi

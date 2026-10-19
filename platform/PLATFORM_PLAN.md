# Deadhead to Diesel King — Platform Plan
*Platform Engineer · Sat Oct 17, 2026 (America/Chicago) · repo `andersonjacob2012/deadhead-to-diesel-king`*

> **Update Oct 17, 2026: map licensing RESOLVED.** The Esri basemap (§1 item 2, §9, checklist "ArcGIS" row) has been removed on `main` and replaced by Art Director's self-hosted custom basemap in `/map/`. No Esri key or account is needed. The rest of this plan is unchanged. See `map-tiles.md`.

**Summary.** The game saves one JSON blob to `localStorage` and has no backend, analytics or accounts yet. Recommended backend: **Supabase** (Postgres + row-level security, anonymous-then-link auth, free for up to 50k MAU, $25/mo Pro after that). Mobile path: **Capacitor 8** wrapping the existing static files, no bundler. Ads: **AdMob first**, with mediation/AppLovin MAX later. IAP: **RevenueCat**. A working save-sync layer and Capacitor scaffold are on branch `platform/save-sync` (local commits only). Jacob's first sign-ups: **Supabase (free)**, then **Google Play Console ($25)**, then **Apple Developer ($99/yr)**. Start Play early because of the 12-tester / 14-day rule.

---

## 1. Audit of the current code (`main` @ `8b5c372`)

### Repo / git
- Branch `main` only, remote `origin` = `https://github.com/andersonjacob2012/deadhead-to-diesel-king.git`, served by GitHub Pages from the repo root.
- The working tree at `/workspace/idle-trucking` has **uncommitted Dev Lead work**: `index.html` (+16/-5, map-rig articulation/zoom around L585–620), `assets/ui/README.md`, deleted `tools/__pycache__/*.pyc`, plus many untracked art files. The platform work did not touch any of it. It lives in a separate worktree (see §8).
- Files: `index.html` (747 lines, ~171 KB, all CSS, JS and an inline SVG sprite in one file), `routes.js` (229 KB, generated city/route data from OSRM by `tools/build_routes.py`), `assets/ui/map-rigs/chicken.js`, `manifest.webmanifest`, `assets/**` (art, fonts, icons).
- **No build tooling**: no package.json, no bundler, no tests. **No service worker.** No auth, backend, analytics, or network calls (`fetch` isn't used anywhere).

### Save system (line numbers are `main`/HEAD)
| What | Where | Notes |
|---|---|---|
| State object | global `let S` L259, `newState()` L260 | `{v:2, v6:1, v8:1, v9:1, lanes, heat, safety, cash:37000, trucks, jobs, earned, last:Date.now(), fuel, clock}` |
| Load | `function load()` **L515–522**, called once at L543 | `S=JSON.parse(localStorage.getItem('idletruck'))`. Runs every migration inline, then the offline-progress calc. |
| Save | `const save=()=>{S.last=Date.now();localStorage.setItem('idletruck',JSON.stringify(S))}` **L524** | Called by the loop every 3 s (L734), on `visibilitychange` and `pagehide` (L735), and in `setChicken` L583 / `setFx` L626 / `startGame` L549 / `setSpd` L720. |
| Key | single key **`idletruck`** | Whole state as one JSON string. |
| Reset | `localStorage.removeItem('idletruck');location.reload()` in Settings L547 and Fleet L713 | **Bug on main:** the `pagehide` → `save()` during reload writes the old state back, so **Reset save does nothing**. Reproduced headless: cash stays $123,456 after Reset. Fixed on the branch through `DKSave.clear()`. |
| Versioning | `S.v` (1→2→4) plus one-shot flags `v5…v10`, `v7`, `sm` migration, all inside `load()` | Works, but it's ad hoc. The cloud row stores `schema_ver` so a future server-side migration has a hook. |
| Offline progress | end of `load()` L522, constants `OFF_EFF=.07, OFF_CAP=8*3600` L523, `LANE_OFF=.6` L302 | `away=min(Date.now()-S.last, 8h)`. If >10 s: the first 90 s is simulated with `tick(1)`. The rest is computed: lane trucks earn `laneEst().perHr*0.6`, auto-drivers earn `laneEst('DAL','MEM').perHr*0.9*0.07`, XP `rest/180`, heat decays, safety recovers, and the result goes into `S.pendingAway`. |
| Time sources | `Date.now()` everywhere: offline calc, hot-load expiry, `dayKey()/dayNum()` L422–423 for daily contracts/streaks | **Fully trusts the device clock.** Moving it forward gives up to 8 h of earnings plus new daily contracts and streaks. Moving it back makes `away` negative, then `S.last` resets earlier, so the next forward jump pays again. This is the anti-cheat surface (§3.4). |
| Save size | measured **~5.7 KB** for a fresh game | Grows with trucks (`t.lt` stats per truck), `S.st.days` (capped at 8) and `S.sm` (monthly stats, **unbounded**). Late-game estimate is 50–200 KB, well under the 5 MB localStorage limit and fine as one cloud row. |

### Things that matter inside a Capacitor WebView
1. **Leaflet comes from the unpkg CDN with SRI** (L11–12). The app breaks offline or if unpkg is down. → The branch's `build:www` vendors Leaflet 1.9.4 from npm into `www/vendor/leaflet` and rewrites the tags. Verified with unpkg blocked.
2. **Basemap tiles come from Esri ArcGIS Online** (the legacy Esri *World Dark Gray Base* tile service, L545). The app needs a network connection for the map (it plays without one, the map is just blank). **Licensing risk:** commercial or ad-supported use of Esri basemaps generally requires an ArcGIS Location Platform account with an API key and attribution. Get a key (there's a free tier) or switch providers before store launch. This is gameplay/art territory, so I've flagged it to Dev Lead.
3. **No `viewport-fit=cover`** in the viewport meta (L1), but the CSS uses `env(safe-area-inset-*)`. On a notched iPhone those insets resolve to 0, so the HUD sits under the status bar. Fix is one meta attribute (Dev Lead's file; I'm flagging it, not changing it).
4. **Origin changes:** web is `https://andersonjacob2012.github.io`, Android is `https://localhost`, iOS is `capacitor://localhost`. Each has its own localStorage, so web saves don't carry into the app. Cloud saves solve this.
5. **iOS WKWebView localStorage can be evicted** under storage pressure. Phase 2: mirror the save into `@capacitor/preferences` (native storage) through the same `SaveStore` interface.
6. The font preload is gated on `/^http/` (L6), so it's skipped on iOS `capacitor://`. Harmless.
7. All asset paths are relative with `?v=` cache-busting. Fine in the WebView. No service worker to conflict with.
8. Android hardware back button: handle with `@capacitor/app` (close sheet/modal, otherwise background the app).

---

## 2. Backend comparison

| | **Supabase** | **Firebase** (Auth + Firestore) | **PlayFab** (Microsoft) |
|---|---|---|---|
| Free tier | 50k MAU, 500 MB DB, 5 GB egress, 2 projects. **Free projects pause after ~7 days of inactivity.** | Spark: Auth free (50k MAU with Identity Platform), Firestore 1 GiB, 50k reads / 20k writes per day | Dev Mode: **1,000 lifetime players per title**, then you must go live on Pay-as-you-go. (Foundation Mode is free but requires Xbox shipping.) |
| Cost at scale | Pro $25/mo: 100k MAU incl., then $0.00325/MAU, 8 GB DB. ~250k MAU ≈ $25 + $490 ≈ **$515/mo** | Pay-per-op. Saves every 30–60 s × many players adds up. Writes $0.18/100k, reads $0.06/100k, Identity Platform MAU >50k ~$0.0055 | Meters per profile read/write/storage. Cheap for small games, but opaque and Microsoft-centric |
| Sign in with Apple / Google | Yes / Yes (native ID-token flow works in Capacitor) | Yes / Yes | Yes / Yes (plus device-ID login) |
| Email magic link | Yes (built in) | Yes (email link) | No (custom/email-password) |
| Anonymous → link later | **Yes**: `signInAnonymously()` then `linkIdentity()`/`updateUser({email})`, same `user_id` | Yes: anonymous + `linkWithCredential` | Yes: CustomID/DeviceID, then link Apple/Google |
| From static GitHub Pages + Capacitor | Yes. supabase-js over HTTPS, anon key is public by design | Yes. Firebase JS SDK; native plugins are optional | Yes. REST/JS SDK, title ID public |
| Security model | **Postgres RLS** + SQL functions (atomic compare-and-swap, server time, sanity checks) | Firestore security rules; server logic needs Cloud Functions (Blaze plan, card on file) | CloudScript (Azure Functions) for server logic |
| Lock-in / portability | Low (plain Postgres, exportable) | High | High |
| Fit for one-blob-per-user idle save | Excellent | Good | Good, but the 1k-player dev cap is a problem for soft launch |

**Pick: Supabase.**
- The whole design (single-row save, compare-and-swap revision, server-trusted clock, soft cheat flags, account deletion) is ~100 lines of SQL with RLS and needs no extra server.
- The free tier covers soft launch.
- Pricing is predictable per MAU, not per write. Idle games write often, so Firestore's per-write billing would hurt.
- No credit card is needed until Pro.
- Mitigate the free-tier pause by upgrading to Pro ($25/mo) **at public launch**. Until then, testing traffic keeps the project active.

PlayFab is the runner-up only if we later want built-in economy, leaderboards and LiveOps. Its 1k-player dev cap and Azure billing make it worse for us now.

**Apple rule (Guideline 4.8, "Login Services"):** if the iOS app offers any third-party/social login (e.g. Google), it must also offer an equivalent privacy-focused option. In practice that's **Sign in with Apple**: it limits data to name and email, allows hiding the email, and has no ad tracking. Plan: ship Guest (anonymous) + Sign in with Apple + Google + email magic link on iOS. Android/web get Google + magic link (Apple is optional there).

---

## 3. Accounts and save-sync design

### 3.1 Identity flow
1. **First launch = guest.** `supabase.auth.signInAnonymously()` happens silently. The player gets a real `user_id`, and saves sync to the cloud right away. No UI friction.
2. **"Save your progress" prompt** after a milestone (e.g. level 5 or first lane), and always available in Settings → Account. Linking via Apple, Google or email magic link calls `linkIdentity` / `updateUser`. **Same `user_id`, so the same save row**; nothing moves.
3. **Signing in on a second device:** that device's anonymous session is replaced by the real account. The sync resolver then decides between the local and cloud saves (§3.3). A fresh device takes the cloud save automatically.
4. **Sign out** keeps the local copy but stops syncing. **Delete account** (required in-app on iOS and Play) calls the `delete_my_account()` RPC, which cascades to the saves and history.
5. Enable "Manual linking" and anonymous sign-ins in the Supabase Auth settings, plus CAPTCHA/rate limits on anonymous sign-ins to limit abuse.

### 3.2 Storage model (one JSON blob per user)
- `public.saves(user_id PK, rev, schema_ver, data jsonb, client_saved_at, device_id, updated_at = server now(), cash/earned generated columns, flags[])`.
- `public.save_history` keeps the last 5 accepted revisions for recovery.
- Local side: key `idletruck` is **unchanged** (same bytes as today, so it's backward compatible). A sidecar key `dk.save.meta` holds `{rev, baseRev, savedAt, maxNow, device, dirty, rollback}`.

### 3.3 Sync strategy: offline-first with optimistic concurrency
- **Every save()** writes localStorage synchronously, exactly as today, marks the save dirty and bumps the local rev.
- **Cloud push** is debounced (30 s), runs on `visibilitychange→hidden`, and runs on boot (+1.5 s). It calls the `put_save(data, base_rev, ...)` RPC, which succeeds **only if the server rev still equals `base_rev`**, so the write is atomic.
- **Resolver** (`DKSave.resolve`, pure and unit-tested):
  - remote rev = our baseRev → push if dirty, otherwise nothing
  - remote rev > baseRev and we're clean → **pull** (write locally, then `location.reload()` so `load()` runs migrations and offline progress normally)
  - remote moved **and** we're dirty → **conflict**
- **Conflict:**
  - If this device never synced and has `earned == 0` (fresh install), take the cloud save automatically.
  - Otherwise call `DKSave.onConflict({local, remote})`. It shows both summaries ("This device: $1.2M · 6 trucks · 2 min ago" vs "Cloud: $3.4M · 9 trucks · yesterday") and the player picks.
  - With no handler, nothing gets overwritten (`pending`).
  - Default highlight: higher lifetime `earned`, not newest timestamp. Device clocks are untrusted, and progress is what players care about.
- Without network, everything keeps working locally. Dirty saves push when the connection returns.

### 3.4 Offline-progress anti-cheat basics (soft: flag, don't ban)
1. **Server timestamps:** `updated_at = now()` on the server per write, and the `server_now()` RPC. On resume, use `elapsed = min(device_elapsed, server_now − last_server_updated_at)` (when online). This needs a small change to the offline calc at L522 (Dev Lead's code, Phase 2).
2. **Cap offline time:** already 8 h (`OFF_CAP`, L523). Keep it, and enforce the same cap server-side in the sanity check.
3. **Clock-rollback detection:** done on the branch. `dk.save.meta.maxNow` is a high-water mark; when `Date.now()` drops more than 5 min below it, `rollback++` and `status().rollback` reports it. Phase 2: when rollback is set, grant no offline earnings until the clock passes `maxNow` again, and don't refresh daily contracts on a backwards day change.
4. **Sanity checks on currency deltas** (in `put_save`): `earned_spike` (lifetime earnings grew far faster than the elapsed server time allows), `cash_gt_earned` (cash exceeds lifetime earnings by >$1M), `client_clock_ahead`, `last_in_future`. These only set flags. Later, flagged players can be excluded from leaderboards and IAP-granted currency can be checked against RevenueCat receipts.
5. **IAP entitlements are never trusted from the save blob.** RevenueCat (server-validated) is the source of truth, synced through its webhook into a `purchases` table later.

### 3.5 JS API (implemented on the branch: `platform/save-store.js`)
```js
DKSave.read()        // -> raw JSON string | null (sync)       — used by load() L515
DKSave.write(S)      // local write now + debounced cloud push  — used by save() L524
DKSave.clear()       // wipe local save, suspend further writes — used by Reset (L547, L713)
DKSave.sync({onConflict}) // Promise<{action:'inert'|'none'|'push'|'pull'|'conflict'|'error'}>
DKSave.status()      // {backend, cloud, dirty, rev, baseRev, savedAt, device, rollback, bytes}
DKSave.resolve(localMeta, remoteMeta) // pure decision (tests)
DKSave.onConflict = ({local, remote, localSavedAt, remoteSavedAt}) => 'local'|'remote'|Promise
```
- `LocalStore` is used now. `CloudStore` (Supabase adapter) stays **inert** unless `window.DK_CONFIG = {supabaseUrl, supabaseAnonKey}` is set **and** supabase-js is loaded.
- Config goes in `platform/config.local.js` (git-ignored), and `build:www` injects it.
- **The anon/publishable key is safe to ship. The service_role/secret key must never go in the client.**
- SQL schema, RLS, `put_save`, `server_now` and `delete_my_account` are in `platform/supabase/schema.sql`. They were validated in PGlite: owner-only reads, direct writes denied, stale-rev writes rejected, spike flagged, cascade delete works.

---

## 4. Capacitor plan (iOS + Android)

- **Layout** (branch): `package.json`, `capacitor.config.json` (`webDir: "www"`, appId placeholder `com.deadheaddieselking.app`; **Jacob must confirm, it's permanent once published**), `platform/build-www.mjs`, `android/`, `ios/` (native projects committed, build outputs git-ignored).
- **No bundler needed.** `npm run build:www` copies `index.html`, `routes.js`, `manifest`, runtime assets (it skips source, preview and mockup art: `www` is ~3.7 MB) and `platform/`, then vendors Leaflet. `npx cap sync` copies `www` into the native projects. The web build on GitHub Pages stays exactly as it is.
- **Toolchain:** Capacitor **8.5.x** (current stable; needs Node ≥ 22, Xcode 26+, Android Studio 2025.2.1+). The box has Node 20, so the CLI was run through `npx -p node@22`. Capacitor 9 is still alpha, so skip it.
- **Plugins:** `@capacitor/app` (back button, resume → sync), `@capacitor/preferences` (durable save mirror), `@capacitor/status-bar`/`splash-screen`, `@capgo/capacitor-social-login` or native Apple/Google sign-in → `supabase.auth.signInWithIdToken`, `@capacitor-community/admob`, `@revenuecat/purchases-capacitor`, and an ATT plugin (`@capacitor-community/app-tracking-transparency`, or AdMob's built-in UMP/ATT flow).
- **Needs a Mac + Xcode:** building, signing and uploading the iOS app (or a cloud Mac CI: Codemagic, GitHub macOS runners, Ionic Appflow). Android builds anywhere with JDK 21 + the Android SDK (neither is on the box today, so no APK was built).
- **Store fees:** Apple Developer Program **$99/yr**. Google Play Console **$25 one-time**.

## 5. Ads and IAP plumbing
- **Ads: AdMob first** (`@capacitor-community/admob`, well maintained, rewarded + interstitial + banner, UMP consent built in). For an idle game the main format is **rewarded video** ("2× earnings for 4 h", "skip repair timer"); interstitials should be rare.
  - **AppLovin MAX** usually earns more through mediation/bidding but has no first-party Capacitor plugin (community or custom bridge only). Revisit once DAU is over ~5k. AdMob mediation can add AppLovin as a network in the meantime.
  - The web build has no ads at first (AdSense for games isn't a fit). Ads are mobile-only.
- **IAP: RevenueCat** (`@revenuecat/purchases-capacitor`) wraps StoreKit 2 and Play Billing, validates receipts server-side, and handles entitlements and restore. Free until $2.5k monthly tracked revenue, then 1%.
  - Use `appUserID = supabase user_id`, so purchases follow the account across devices.
  - Products to start: "Remove forced ads" (non-consumable), "Diesel bucks" packs (consumable), maybe a "Fleet Pass" subscription later.
  - Web: no IAP at first (Stripe via RevenueCat Web Billing later if wanted).
- Apple requires a "Restore Purchases" button and real-money IAP through StoreKit (no external links for digital goods outside the allowed US exceptions).

## 6. Store requirements checklist
- **Privacy policy URL:** host it on GitHub Pages (`/privacy.html`). It must cover Supabase (account/email, save data), AdMob (advertising ID, device data), RevenueCat (purchase history) and the deletion process. A **support URL** is required too.
- **In-app account deletion** (App Store 5.1.1(v); Google Play account-deletion policy also requires a **web deletion link** in the Play listing): Settings → Account → Delete → `delete_my_account()` RPC, plus a web page/email route for Play.
- **Google Play Data safety form:** declare email (account), app activity/game progress, device or other IDs (AdMob ad ID), purchase history (RevenueCat), and crash data if added. Data is encrypted in transit, and users can request deletion.
- **Apple privacy nutrition labels:** Contact Info (email, linked), Identifiers (User ID linked; Device ID for ads → "Used to Track You" if ads are personalized), Purchases, Gameplay Content, Usage Data.
- **ATT prompt** (iOS) before personalized ads. Without consent, AdMob serves non-personalized ads. Also add the UMP/GDPR consent form for EEA/UK users.
- **Google Play closed test:** new **personal** developer accounts (created after Nov 13, 2023) must run a closed test with **≥12 testers opted in for 14 consecutive days** before applying for production. Organization accounts are exempt but need a **D-U-N-S number** (free, takes days to weeks). Recruit 12+ testers early.
- **Age rating questionnaires** (IARC on Play, Apple's age rating). Ads and IAP must be declared. Target audience is not children, to avoid Families policy.
- **Apple:** Sign in with Apple capability, IAP agreements + tax/banking forms in App Store Connect (required before IAP works), TestFlight for beta.

## 7. Phases
| Phase | Scope | Needs from Jacob |
|---|---|---|
| **0 (done, branch)** | `DKSave` layer, Reset bug fix, inert Supabase adapter, SQL schema, Capacitor scaffold + vendored Leaflet, tests | none |
| **1: Cloud saves on web** (~1 wk) | Run schema.sql; vendor supabase-js; guest anonymous auth + boot/background sync; conflict modal; Settings → Account (link Apple/Google/magic link, sign out, delete); privacy page | Supabase project URL + anon key; Google OAuth client; Apple Services ID (after Apple enrollment) |
| **2: Hardening** | Server-time offline cap + rollback handling in the offline calc (with Dev Lead); Preferences mirror; `S.sm` pruning; Esri key/provider decision; `viewport-fit=cover` | — |
| **3: Android closed test** | JDK + SDK build, signing key (Play App Signing), AdMob test ads, RevenueCat sandbox, 12 testers × 14 days | Play Console ($25), AdMob, RevenueCat, 12+ tester emails |
| **4: iOS TestFlight** | Mac/cloud-Mac build, SIWA, ATT, StoreKit sandbox | Apple Developer ($99/yr), App Store Connect agreements/tax/bank |
| **5: Launch** | Store listings, data safety/labels, Supabase Pro | Supabase Pro $25/mo at launch |

## 8. What was built (branch `platform/save-sync`, worktree `/workspace/idle-trucking-platform`)
- `platform/save-store.js`: DKSave layer (LocalStore + inert Supabase CloudStore, resolver, rollback detection).
- `index.html`: **3 one-line edits** (see §9).
- `platform/supabase/schema.sql`, `platform/config.example.js`.
- `package.json`, `package-lock.json`, `capacitor.config.json`, `platform/build-www.mjs`, `android/`, `ios/`, `.gitignore` (+node_modules, www, config.local.js).
- `platform/tests/*`: `npm test` (Node ≥22) runs the unit resolver/legacy/rollback tests, headless fresh-game + legacy-save smoke tests, a two-device cloud mock (push, auto-pull on a fresh device, stale-rev rejection, conflict prompt), the PGlite SQL/RLS test, and the www build with the unpkg CDN blocked.

## 9. Overlap with Dev Lead (merge coordination)
*Updated after merging main @ 6ac8a6c.* Dev Lead's `NOSAVE` Reset fix is on main, so the save-layer PR keeps their Reset lines unchanged. It touches only **3 one-liners** in `index.html`:
1. Script tags (L13): append `<script src="platform/save-store.js?v=1"></script>` after `routes.js`
2. `load()`: `localStorage.getItem('idletruck')` → `DKSave.read()`
3. `save`: `localStorage.setItem('idletruck',JSON.stringify(S))` → `DKSave.write(S)` (the `if(NOSAVE)return;` guard stays first)

Phase 2 items that touch gameplay code, to agree with Dev Lead first: the offline calc at L522 (server time, rollback), `dayKey()`/contracts at L422–436, `S.sm` growth, the viewport meta at L1, and the Esri tile layer at L545.

## 10. Jacob's sign-up checklist (only steps that need his identity), in order
| # | When | Sign up | Cost | Hand back to Platform | Never hand back |
|---|---|---|---|---|---|
| 1 | **Now** | **Supabase** (supabase.com, GitHub login is fine) → New project "diesel-king", region US-Central/East, save the DB password in a password manager. Auth → Providers: enable Anonymous, Email (magic link) | Free | **Project URL** (`https://xxxx.supabase.co`) + **anon / publishable key** (safe to ship) | `service_role` / secret key, DB password |
| 2 | **Now** (the 14-day test clock is the long pole) | **Google Play Console** as Personal (or Organization with a D-U-N-S number to skip the 12-tester rule). ID verification takes days | **$25 one-time** | Developer account name; later invite the platform email as a user with app-release permissions (no payments) | Google password, payment info |
| 3 | **Now / soon** | **Apple Developer Program** (Individual, or Organization with D-U-N-S). Needs an Apple ID with 2FA | **$99/yr** | Team ID; later add the platform email as an App Store Connect "App Manager"/"Developer" | Apple ID password, signing certs' private keys (generated in Xcode/CI) |
| 4 | Phase 1 | **Google Cloud OAuth client** (Google sign-in): console.cloud.google.com → OAuth consent screen + Web client ID (+ Android/iOS client IDs later) | Free | Web Client ID (+ secret goes **into the Supabase dashboard by Jacob**, not to us) | Client secret in chat |
| 5 | Phase 1 (after #3) | **Sign in with Apple**: Services ID + key in the Apple Developer portal | Included | Services ID, Key ID, Team ID (the .p8 key is pasted into Supabase by Jacob) | .p8 private key |
| 6 | Phase 3 | **AdMob** (admob.google.com; needs tax/payment profile for payouts) | Free | AdMob App IDs (Android/iOS) + ad unit IDs | Payment/tax info |
| 7 | Phase 3 | **RevenueCat** (free tier) | Free → 1% over $2.5k/mo | Public SDK keys (Android `goog_…`, iOS `appl_…`) | Secret API keys |
| 8 | Phase 4 | App Store Connect **Paid Apps agreement + tax + banking**; Play **payments profile** | Free | "done" | Bank details |
| 9 | Phase 3 | **12+ closed testers** (Google accounts/emails of friends/family) | Free | Tester email list | — |
| 10 | Launch | **Supabase Pro** (no pausing, backups) | **$25/mo** | — | Card details |
| opt | Phase 2 | **ArcGIS Location Platform** API key (if we keep Esri tiles) | Free tier | API key (referrer-restricted) | — |

**Total to reach both stores:** $25 (once) + $99/yr. Plus $25/mo Supabase from public launch.

## 11. Versioning (web + apps share one number)
- `index.html` holds `const VERSION='X.Y.Z'`; the title screen (bottom-right) and Settings show `vX.Y.Z (sha)`. `CHANGELOG.md` is newest first.
- Release: commit the code, then `tools/bump-version.sh patch|minor "player-facing note" ...` (fixes = patch, features = minor). It bumps VERSION, `package.json`, Android `versionName` / `versionCode`+1, iOS `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`+1, prepends the changelog and commits `Release vX.Y.Z`.
- **Build hash = the deployed source SHA (Oct 18; before this, staging 856e245 showed its parent 5a34c3a because a commit can't hold its own SHA).** The hash is not in the source. The game reads `version.json` (`{"version","build","sha"}`) at start (`fetch('version.json',{cache:'no-store'})`, http(s) only) and shows `vX.Y.Z (build)` only when its `version` equals VERSION and `build` is a hex SHA. Offline, `file://`, a fetch error or the source tree's empty placeholder show `vX.Y.Z` only, with no console error and no 404 (the placeholder is committed).
- **Deploy commit** (`tools/deploy-commit.sh [<src>]`, used by stage.sh): `<src>`'s tree + `version.json` stamped with `<src>`'s version and SHA, first parent `<src>`. If live (`origin/main`) is an earlier deploy commit that `<src>` doesn't contain, it's the second parent, so promoting stays a fast-forward and source branches never need the deploy commits. It refuses if live has source commits `<src>` lacks (merge origin/main first). It creates no branch and doesn't touch the working tree (temporary index + `git commit-tree`). The last staged one is kept as `refs/deploy/staging`.
- `tools/stage.sh [<src>]` force-pushes the deploy commit to the staging repo and waits until staging serves its index.html and `version.json`, so QA sees `STAGING · vX.Y.Z (<src short>)`. `tools/promote.sh <src short>` (the deploy SHA also works) refuses unless staging main is the deploy commit of exactly that source (first parent + version.json sha) and staging serves it. It then fast-forward pushes **the same deploy commit** to origin main, so live serves the identical tree and shows the same `vX.Y.Z (<src short>)`, and waits for live's index.html + version.json. origin main's first parent is always the source SHA QA passed.
- App: `platform/build-www.mjs` copies `version.json` into `www/` (so the hash shows offline in the app). From a deploy commit the file is already stamped; from a clean source checkout it stamps `git rev-parse HEAD`; a dirty tree gets no hash.
- `tools/bump-version.sh hook` installs `tools/pre-push`, which only lets deploy commits onto main (version.json `sha` = the pushed commit's first parent, `version` = VERSION). The copy currently installed in `.git/hooks` is the older BUILD-line check. It passes deploy commits (no BUILD line), but re-run the hook install to get the new guard.
- **Starting point (Oct 18):** v1.0.2 (856e245) was promoted by hand as a fast-forward from 00d3171, before this flow existed. So live `origin/main` = staging `main` = 856e245, a plain source commit, not a deploy commit, and it shows `v1.0.2 (5a34c3a)` from its old stamped BUILD line. That is fine for the next release:
  - Any source that contains 856e245 gets a single-parent deploy commit, which is a fast-forward of 856e245.
  - stage.sh force-pushes it over staging's plain 856e245.
  - promote.sh only checks that staging (the deploy commit it just got) is one; it never requires live to be one.
  - From then on, live is a deploy commit, and the second-parent rule keeps later promotes fast-forwards.
  - Dry-run on local bare copies of both remotes (feature/feedback 763fea3 over 856e245): the deploy commit is a fast-forward, the hook accepts the deploy commit and refuses the plain source, and the next deploy gets live as its second parent and is still a fast-forward.
  - The next release needs a VERSION bump (1.0.2 is taken).
- Tests: `/workspace/pw/reg-version.js` checks the shown string against the served version.json (staging/live) and, on the working copy, the stamped, placeholder, wrong-version and fetch-failure cases.
- 1.0.1 = first Android build (versionCode 2); 1.0.2 = versionCode 3.

## 12. Staging (Jacob, Oct 18: nothing goes live until QA passes it on staging)
- Staging site: https://andersonjacob2012.github.io/deadhead-to-diesel-king-staging/ (repo `andersonjacob2012/deadhead-to-diesel-king-staging`, Pages from main /, git remote `staging`).
- Same origin as live, so under a `-staging/` path index.html sets `DK_SAVE_KEY='idletruck_staging'` (meta: `dk.save.meta.idletruck_staging`), used by save-store.js, the fallback shim and both Reset buttons; it also shows a STAGING badge (hidden while a sheet/tab, the showroom, the Feedback form or menu, or a modal such as Settings is open, so it never covers sheet content: QA Oct 18, `reg-stagebadge.js`) and adds robots noindex. Live keys are untouched (`/workspace/pw/reg-stagekeys.js staging`).
- Flow: commit → `tools/bump-version.sh patch|minor "note"` → `tools/stage.sh` (deploy commit = HEAD + stamped version.json, pushed to staging; waits until it serves it; prints the SHA QA will see) → QA: `/workspace/pw/regall.sh staging` (`WANT_SHA=<sha>` makes reg-version check the shown hash) → `tools/promote.sh <sha>` (refuses unless staging has and serves the deploy commit of exactly that source SHA; fast-forward pushes that same deploy commit to origin main; waits for live). See section 11.

## 13. Domain move: deadheadtodieselking.com (feature/domain)
- **New site:** repo `andersonjacob2012/deadheadtodieselking-web` (deploy-only, Pages from `main` /), git remote `web`. `tools/deploy-commit.sh --web <src>` = the same deploy tree + `CNAME` (deadheadtodieselking.com), parent `<src>` only; the github.io targets never get a CNAME.
- **promote.sh:** a build that contains the move redirect (`dkmove=` in index.html) goes to `web` FIRST (force-with-lease against what `ls-remote` saw, since GitHub may commit its own CNAME there) and must be served at https://deadheadtodieselking.com/ with the right version.json, else promote refuses and live stays put (otherwise the old site would send everyone to a dead domain). Other builds: origin first, then `web` (skipped with a warning if the remote/repo is missing or unreachable). The pre-push rules are unchanged (deploy commits only on `main`, both repos).
- **Handoff (index.html, inline script before save-store.js):** only at exactly https://andersonjacob2012.github.io/deadhead-to-diesel-king/ (or `index.html`; not staging, not privacy.html, not the app) the page redirects to the new site, carrying `#dkmove=z.<base64url(gzip(JSON))>` (`b.` = plain base64url when CompressionStream is missing). JSON = `{v:1,t:<meta savedAt>,sum:<FNV-1a of JSON(data)>,data:{save,meta,fbq}}`. No save = plain redirect. The old save is never deleted; `dk.moved` = `{at,t,sent}`; later visits redirect without a payload unless the save's savedAt moved past `t`. Loop guard: `sessionStorage dk.move.at` (no second redirect from the same tab within 60 s). While moving or importing `DK_MOVE_HOLD` stops `save()` (pagehide/visibilitychange), and a full-screen "Moving to deadheadtodieselking.com…" link shows if the redirect is blocked.
- **Import (any origin, when `#dkmove` is present):** decode, check v/sum, import only if there's no local save, the local save was never started, or the incoming savedAt is newer; then reload without the hash and toast "Save transferred". Anything else: strip the hash with `history.replaceState`, `console.warn`, carry on.
- **QA hooks:** `?dkmovetest=<url>` runs the redirect on any origin (e.g. staging) toward `<url>`; `localStorage dk.nomove=1` disables the real old-URL redirect (the Playwright harness sets it, since it serves the working copy under the live URL). Test: `pw/reg-domain.js` (two local origins + the real URLs routed). A late-game save (40 rigs, 12 lanes, ~69 KB) makes a ~25 KB hash.

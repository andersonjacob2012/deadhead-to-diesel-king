# platform/ads — ad + IAP plumbing (branch `platform/ads`)

Source of truth: `/workspace/business/ad-unlock-spec.md` (v1). Shipped **OFF**: native `ADS_ENABLED = adsEnabled`; web `ADS_ENABLED = webAdsEnabled && location.hostname === webAdHost` (all false/empty by default, so github.io, staging and localhost never gate).

**Final spec (Jacob, Oct 18):** 8 boost-min per ad at 5x = 5 min at 10x (`burn {5:1, 10:1.6}`), tank 24 min at 5x, 10 boost ads/day (own counter, separate from the 6 interstitials). Medal fuel 16/8 per badge once ever (`medalFuel`, ceiling 48 min, not counted as ads); a pre-gating save that already met a fuelled badge gets one 16-min retro grant. The old free tank is gone. Colors: ads, `lightBar` or `adFree` only; on the first gated launch the player keeps the color already equipped. Web ad blocker: boost + colors stay **locked** with the spec §8 notice and no Watch button (not fail-open); re-checked on each Fuel-up open. **Outage vs blocker:** when the AdSense tag fails (onerror or empty stub) a bait div (`adsbox ad-banner …`) is checked: hidden by a cosmetic filter → blocker (locked); visible → outage (fail-open, free). Remote `adsDown: true` (cached `dk.remote`, applies next boot) turns ads off everywhere = unlock all, never shown as a blocker. Equipped color kept for pre-gating saves only (no toast). `dk.remote` and `dk.ads.ok` get the `DK_SAVE_KEY` suffix on staging (`DKConfig.skey`, same rule as `dk.save.meta`). With the flag OFF the game behaves exactly as before (verified by `tests/ads-browser.js` against the save-sync baseline).

## Modules (all logic lives here, not in index.html)
| File | What |
|---|---|
| `dk-config.js` | `DK_PLATFORM`, `DK_CFG` (every spec number, remote-tunable: defaults ← cached `dk.remote` ← `window.DK_REMOTE`; type-checked merge), `ADS_ENABLED`, `DKConfig.fetchRemote()` (short timeout, caches for next boot) |
| `ads.js` (web) | `adapters.adsense`: AdSense H5 Ad Placement API stub (`adBreak` reward; grant only in `adViewed`; `notReady`/`frequencyCapped` → no_fill). Inactive: needs `DK_CFG.adsense.client` (empty) + `webAdHost`; CMP must load first (not wired). Tag load failure → `{code:'blocked'}` |
| `ads.js` | `DKAds.create()` → `Ads.init/healthy/canShow/showRewarded/grantFree/grant`. Reward only from the SDK reward event, nonce de-dupe (last 20), one request in flight (`busy`), 10 s load timeout → `no_fill`, minAdGap 20 s + per-placement gaps/caps, pity rule, fail-open health (init fail or ≥5 errors/30 min). Adapters: `admob` (`@capacitor-community/admob`, Google test ids), `mock` (tests / web QA), `none` |
| `entitlements.js` | RevenueCat wrapper (`@revenuecat/purchases-capacitor`): `adFree`, `noForced`, `lightBar`; RC is truth; `S.ent` cache trusted only offline on the device RC last confirmed; inert without a key and on web |
| `boost.js` | pure speed tank: canSpd, canAdd (tank max + daily cap), add, allocation-free drain (5x 1/s, 10x 1.6/s, only gated+visible+no ad, dt ≤ 0.5), medal fuel (medalTick, firstGate retro), labels |
| `lights.js` | pure chicken unlocks: cost (rigs.json `cost` → `ckCost` → 2), owned, progress, applyAd, keepEquipped (equipped non-amber color only, once) |
| `mon-state.js` | `migrate(S)` defaults `S.boost, S.ckOwn, S.ckProg, S.ads, S.ent, S.gate` (backward compatible); `rollDay` (forward-only, clock-rollback guard) |
| `monetize.js` | `DKMon` glue: hooks below, Fuel-up sheet, chicken offer sheet (live preview), tank readout under `#spd`, lock badges, first-gate grants, empty-tank drop (waits for finger release ≤ 3 s), Ad-Free auto-refuel, pause/mute during ads, analytics → `window.DK_EVENTS` / `window.DK_ANALYTICS` |

## index.html touchpoints (one isolated commit; 7 one-line edits, no markup changes)
1. **Script tags** after `platform/save-store.js`: `dk-config, ads, entitlements, boost, lights, mon-state, monetize` (order matters).
2. **`CK_ALL_FREE`**: `const CK_ALL_FREE=true` → `const CK_ALL_FREE=()=>DKMon.ckFree();`
3. **`ckOk`**: `CK_ALL_FREE` → `CK_ALL_FREE()` and `||DKMon.ckEnt()` appended.
4. **`setChicken`**: `if(!ckOk(id))return;` → `if(!ckOk(id))return DKMon.ckOffer(id);`
5. **`settings()` chicken picker `<option>`**: locked branch `'disabled'` → `DKMon.ckAttr(p.id)`, `' (locked)'` → `DKMon.ckTag(p.id)` (only reached when a color is locked, i.e. gated).
6. **`load()`**: after `if(!S)S=newState();` add `DKMon.migrate(S,isNew);`
7. **Speed — the single speed hook**: first statement of `setSpd(m)`: `m=DKMon.spd(m);` (returns the allowed speed; opens Fuel-up when a locked tier is tapped; on boot restore it clamps to 1x when gated with an empty tank).
8. **Loop — the single frame hook**: in `loop(now)` right after `lastT=now;`: `if(DKMon.frame(dt))return requestAnimationFrame(loop);` (drains the tank with the loop's clamped real dt; returns true while an ad plays so the frame is skipped).

No timer code is touched. The speed-change timer stretch fix and the 1x offline catch-up are Dev Lead's (spec §4.2 Fix 1/Fix 2) and **must land before gating is switched on**.

On rebase: if Dev Lead renames `setSpd`/`loop`, re-attach hooks 7 and 8 at the new entry points; nothing else depends on timer internals.

## Native
- Plugins added to `package.json` (`@capacitor-community/admob@^8.2.1`, `@revenuecat/purchases-capacitor@^13.7.4`). **`npx cap sync` not run** (no native build in this branch).
- AndroidManifest `com.google.android.gms.ads.APPLICATION_ID` and iOS `GADApplicationIdentifier` set to Google's **public test app ids**; iOS `NSUserTrackingUsageDescription` added. Before release: real AdMob app/unit ids, `SKAdNetworkItems` list (iOS), RevenueCat public keys in `DK_CFG.revenuecat`.

## Testing
`npm test` (Node 22) includes `npm run test:ads`: `tests/ads-unit.js` (32 tests mapped to spec §11 QA cases) and `tests/ads-browser.js` (Playwright: flag OFF unchanged; flag ON with `window.DK_ADS_ADAPTER='mock:<script>'` + `DK_REMOTE={adsEnabled:true,webAdsEnabled:true}`). Compare with a baseline: `node platform/tests/ads-browser.js . 8731 <baseline-dir>`.

/* Deadhead to Diesel King — platform + remote-tunable monetization config (platform/ads).
 * Classic script, load BEFORE ads.js / entitlements.js / monetize.js and before the game <script>.
 *
 *   DK_PLATFORM   'web' | 'ios' | 'android'
 *   DK_CFG        defaults <- last good cached remote copy (localStorage 'dk.remote') <- window.DK_REMOTE
 *   ADS_ENABLED   DK_CFG.adsEnabled && (DK_PLATFORM !== 'web' || DK_CFG.webAdsEnabled)   (shipped OFF)
 *   DKConfig.fetchRemote(url?, timeoutMs?) -> Promise<bool>  fetch remote JSON with a short timeout and cache it
 *                                            for the NEXT boot (ADS_ENABLED is fixed for this session).
 * Every number from ad-unlock-spec.md lives in DEFAULTS so it can be tuned remotely.
 */
(function (root) {
  'use strict';
  var DEFAULTS = {
    adsEnabled: false,          // master switch, shipped false
    webAdsEnabled: false,       // stays false until a web rewarded provider (AdSense H5) is approved
    // speed boost tank (spec §4)
    boostMinPerAd: 30,          // boost-minutes added per ad (5x-equivalent; 10x burns 2/s)
    boostTankMax: 90,           // max banked boost-minutes
    boostAdsPerDay: 6,          // speed_boost ads (and Ad-Free auto-refuels) per local day
    burn: { 5: 1, 10: 2 },      // boost-seconds burned per real second at each tier
    firstGateFuelMin: 30,       // one free tank for pre-gating saves, once
    warnSec: 60,                // pulse the tank readout below this
    emptyHoldMaxSec: 3,         // wait for finger release before dropping to 1x
    // chicken lights (spec §5)
    ckCost: { red: 1, blue: 1, green: 1, white: 1, purple: 2, chase: 3 },
    ckCostDefault: 2,           // future palettes without a cost
    // rewarded ads (spec §3, §8, §9; per-placement caps from monetization-plan §5)
    minAdGapSec: 20,
    loadTimeoutSec: 10,
    showTimeoutSec: 180,        // safety net if the SDK never sends Dismissed
    dismissGraceMs: 600,        // wait this long after Dismissed for a late Rewarded event
    pityPerDay: 1,
    pityWindowMin: 10,
    unhealthyErrors: 5,         // >= this many consecutive errors (not no-fill) ...
    unhealthyWindowMin: 30,     // ... within this window => Ads.healthy() false => fail-open
    nonceKeep: 20,
    clockSlackMin: 5,
    caps: { speed_boost: null /* = boostAdsPerDay */, offline_x2: 4, hot_refresh: 3, contract_x2: 3,
            roadside_repair: 2, oos_lawyer: 1, dispatch_tip: 3, chicken_unlock: 0 /* 0 = uncapped */ },
    gaps: { hot_refresh: 1200 }, // per-placement extra cooldown (s)
    // SDK ids — Google's PUBLIC TEST ids only. Replace with real ids from AdMob before release.
    admob: {
      testing: true,
      rewarded: { android: 'ca-app-pub-3940256099942544/5224354917', ios: 'ca-app-pub-3940256099942544/1712485313' }
    },
    revenuecat: { android: '', ios: '' },   // public SDK keys (goog_… / appl_…); empty => entitlements inert
    remoteUrl: '',
    remoteTimeoutMs: 2500
  };
  var CACHE = 'dk.remote';

  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  // Merge only known keys with matching types, so a bad remote file can't break the game.
  function merge(base, over) {
    var out = {}, k;
    for (k in base) out[k] = isObj(base[k]) ? merge(base[k], {}) : base[k];
    if (!isObj(over)) return out;
    for (k in over) {
      if (!(k in base)) continue;   // unknown top-level keys are ignored
      var b = base[k], v = over[k];
      if (isObj(b)) out[k] = mergeOpen(b, v);
      else if (b === null || typeof b === typeof v) {
        if (typeof v === 'number' && !(isFinite(v) && v >= 0)) continue;
        out[k] = v;
      }
    }
    return out;
  }
  // nested maps (caps, ckCost, burn, gaps…): allow new keys with number values
  function mergeOpen(b, v) {
    var o = merge(b, {}), k;
    if (!isObj(v)) return o;
    for (k in v) {
      if (isObj(b[k])) o[k] = mergeOpen(b[k], v[k]);
      else if ((typeof v[k] === 'number' && isFinite(v[k]) && v[k] >= 0) || (typeof v[k] === 'string' && typeof b[k] === 'string') || (v[k] === null && b[k] === null) || typeof v[k] === typeof b[k]) o[k] = v[k];
    }
    return o;
  }
  function readCache(ls) { try { var s = ls && ls.getItem(CACHE); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function detectPlatform(w) {
    var C = w && w.Capacitor;
    try { return (C && C.isNativePlatform && C.isNativePlatform()) ? C.getPlatform() : 'web'; } catch (e) { return 'web'; }
  }
  function build(w) {
    var ls = null; try { ls = w.localStorage; } catch (e) {}
    var cfg = merge(merge(DEFAULTS, readCache(ls)), w.DK_REMOTE || {});
    var platform = detectPlatform(w);
    return { cfg: cfg, platform: platform, adsEnabled: !!(cfg.adsEnabled && (platform !== 'web' || cfg.webAdsEnabled)) };
  }
  function fetchRemote(url, timeoutMs) {
    url = url || (root.DK_CFG && root.DK_CFG.remoteUrl);
    if (!url || typeof fetch !== 'function') return Promise.resolve(false);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { ctl && ctl.abort(); }, timeoutMs || (root.DK_CFG && root.DK_CFG.remoteTimeoutMs) || 2500);
    return fetch(url, { cache: 'no-store', signal: ctl && ctl.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { clearTimeout(t); if (!isObj(j)) return false; try { root.localStorage.setItem(CACHE, JSON.stringify(j)); } catch (e) {} return true; })
      .catch(function () { clearTimeout(t); return false; });   // timeout/offline: keep last good cache
  }
  var api = { DEFAULTS: DEFAULTS, merge: merge, build: build, fetchRemote: fetchRemote, CACHE: CACHE };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  var b = build(root);
  root.DKConfig = api; root.DK_CFG = b.cfg; root.DK_PLATFORM = b.platform; root.ADS_ENABLED = b.adsEnabled;
})(typeof window !== 'undefined' ? window : this);

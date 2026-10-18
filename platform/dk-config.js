/* Deadhead to Diesel King — platform + remote-tunable monetization config (platform/ads).
 * Classic script, load BEFORE ads.js / entitlements.js / monetize.js and before the game <script>.
 *
 *   DK_PLATFORM   'web' | 'ios' | 'android'
 *   DK_CFG        defaults <- last good cached remote copy (localStorage 'dk.remote', suffixed on staging) <- window.DK_REMOTE
 *   ADS_ENABLED   native: DK_CFG.adsEnabled; web: DK_CFG.webAdsEnabled && location.hostname === DK_CFG.webAdHost (shipped OFF)
 *   DKConfig.skey(base)  per-build localStorage key: base on live, base + '.' + DK_SAVE_KEY on staging (same rule as dk.save.meta)
 *   DKConfig.fetchRemote(url?, timeoutMs?) -> Promise<bool>  fetch remote JSON with a short timeout and cache it
 *                                            for the NEXT boot (ADS_ENABLED is fixed for this session).
 * Every number from ad-unlock-spec.md lives in DEFAULTS so it can be tuned remotely.
 */
(function (root) {
  'use strict';
  var DEFAULTS = {
    adsEnabled: false,          // master switch, shipped false
    webAdsEnabled: false,       // flip on once AdSense H5 Games Ads is approved AND the CMP + ads.txt are live
    webAdHost: '',              // the approved custom domain; github.io, localhost and staging never gate
    webAdapter: 'adsense',      // 'adsense' | 'none'
    adsense: { client: '', test: false },   // ca-pub-… from Jacob's AdSense account (none yet); test => data-adbreak-test
    // speed boost tank (spec §4)
    boostMinPerAd: 8,           // boost-minutes per ad, measured at 5x: 8 min at 5x or 5 min at 10x (Jacob, Oct 18)
    boostTankMax: 24,           // max banked boost-minutes from ads (measured at 5x)
    boostAdsPerDay: 10,         // speed_boost ads (and Ad-Free auto-refuels) per game day; separate from interstitials
    burn: { 5: 1, 10: 1.6 },    // boost-seconds burned per real second at each tier (8 / 1.6 = 5 min at 10x)
    // medal boost fuel (spec §4.3): badge id -> boost-minutes, paid once ever, only while gated
    medalFuel: { 'miles-100k': 16, 'miles-1m': 16, t10: 16, 'fleet-25': 16, 'fleet-100': 16, 'cash-100m': 16, 'cash-1b': 16,
                 'contract-gold': 16, 'contract-diamond': 16, 'region-west-coast': 16,
                 'miles-10k': 8, 'fleet-5': 8, 'cash-1m': 8, 'contract-silver': 8, 'region-midwest': 8, 'region-southeast': 8,
                 'region-mountain-west': 8, 'region-northeast': 8, 'scale-clean': 8, 'safety-5star': 8 },
    medalRetroMin: 16,          // one-time grant for a pre-gating save that already met a fuelled badge (replaces the free tank)
    medalCeilMin: 48,           // medal fuel may lift the bank above boostTankMax, never above this
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
  function skey(base, saveKey) { saveKey = saveKey || 'idletruck'; return saveKey === 'idletruck' ? base : base + '.' + saveKey; }

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
  function readCache(ls, key) { try { var s = ls && ls.getItem(key || CACHE); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function detectPlatform(w) {
    var C = w && w.Capacitor;
    try { return (C && C.isNativePlatform && C.isNativePlatform()) ? C.getPlatform() : 'web'; } catch (e) { return 'web'; }
  }
  function build(w) {
    var ls = null; try { ls = w.localStorage; } catch (e) {}
    var cache = skey(CACHE, w.DK_SAVE_KEY);
    var cfg = merge(merge(DEFAULTS, readCache(ls, cache)), w.DK_REMOTE || {});
    var platform = detectPlatform(w), host = (w.location && w.location.hostname) || '';
    var on = platform === 'web' ? !!(cfg.webAdsEnabled && cfg.webAdHost && host === cfg.webAdHost) : !!cfg.adsEnabled;
    return { cfg: cfg, platform: platform, adsEnabled: on, cache: cache };
  }
  function fetchRemote(url, timeoutMs) {
    url = url || (root.DK_CFG && root.DK_CFG.remoteUrl);
    if (!url || typeof fetch !== 'function') return Promise.resolve(false);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { ctl && ctl.abort(); }, timeoutMs || (root.DK_CFG && root.DK_CFG.remoteTimeoutMs) || 2500);
    return fetch(url, { cache: 'no-store', signal: ctl && ctl.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { clearTimeout(t); if (!isObj(j)) return false; try { root.localStorage.setItem(api.cacheKey || CACHE, JSON.stringify(j)); } catch (e) {} return true; })
      .catch(function () { clearTimeout(t); return false; });   // timeout/offline: keep last good cache
  }
  var api = { DEFAULTS: DEFAULTS, merge: merge, build: build, fetchRemote: fetchRemote, CACHE: CACHE, skey: function (base, k) { return skey(base, k || root.DK_SAVE_KEY); } };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  var b = build(root); api.cacheKey = b.cache;
  root.DKConfig = api; root.DK_CFG = b.cfg; root.DK_PLATFORM = b.platform; root.ADS_ENABLED = b.adsEnabled;
})(typeof window !== 'undefined' ? window : this);

/* Monetization save fields + daily rollover — pure (ad-unlock-spec §7, §9). UMD: window.DKMonState / require().
 * migrate(S, {isNew, adsEnabled, cfg}) defaults S.boost, S.ckOwn, S.ckProg, S.ads, S.ent, S.gate without touching
 * existing values. With ADS_ENABLED off these fields are written but never read, so the game behaves as before.
 */
(function (root, f) { var m = f(); if (typeof module === 'object' && module.exports) module.exports = m; else root.DKMonState = m; })(this, function () {
  'use strict';
  var PLACEMENTS = ['speed_boost', 'offline_x2', 'hot_refresh', 'contract_x2', 'roadside_repair', 'oos_lawyer', 'dispatch_tip'];
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function num(v, d) { v = +v; return isFinite(v) && v >= 0 ? v : d; }
  function zeroCnt() { var c = {}; for (var i = 0; i < PLACEMENTS.length; i++) c[PLACEMENTS[i]] = 0; return c; }
  function migrate(S, o) {
    o = o || {}; var cfg = o.cfg || {}, max = (cfg.medalCeilMin || 48) * 60;
    var b = obj(S.boost) || {};
    S.boost = { bank: Math.min(max, num(b.bank, 0)), tier: b.tier == 10 ? 10 : 5, medalPaid: Array.isArray(b.medalPaid) ? b.medalPaid.filter(function (x) { return typeof x === 'string'; }) : [] };
    if (!Array.isArray(S.ckOwn)) S.ckOwn = ['amber'];
    if (!obj(S.ckProg)) S.ckProg = {};
    var a = obj(S.ads) || {}, cnt = zeroCnt(), k;
    if (obj(a.cnt)) for (k in a.cnt) cnt[k] = num(a.cnt[k], 0);
    S.ads = { v: 1, day: num(a.day, 0), cnt: cnt, pity: num(a.pity, 0), maxTs: num(a.maxTs, 0), lastAdTs: num(a.lastAdTs, 0),
              lastP: obj(a.lastP) || {}, nonces: Array.isArray(a.nonces) ? a.nonces.slice(-(cfg.nonceKeep || 20)) : [] };
    var e = obj(S.ent) || {};
    S.ent = { adFree: !!e.adFree, noForced: !!e.noForced, lightBar: !!e.lightBar, ts: num(e.ts, 0), dev: e.dev || '' };
    var g = obj(S.gate) || {};
    S.gate = { since: num(g.since, 0), retro: g.retro ? 1 : 0, ck: g.ck ? 1 : 0 };   // old free-tank flag (fuel) dropped
    // A save created while ads were already on is not "pre-gating": no retro medal grant.
    if (g.fresh || (o.isNew && o.adsEnabled)) S.gate.fresh = 1;
    return S;
  }
  // Daily counts reset only when the local day moves FORWARD and the clock is not behind the max seen (- slack).
  function rollDay(ads, day, now, cfg) {
    var slack = ((cfg && cfg.clockSlackMin) || 5) * 60e3, reset = false;
    if (!ads.day) ads.day = day;
    else if (day > ads.day && now >= ads.maxTs - slack) { ads.day = day; ads.cnt = zeroCnt(); ads.pity = 0; reset = true; }
    if (now > ads.maxTs) ads.maxTs = now;
    return reset;
  }
  return { PLACEMENTS: PLACEMENTS, migrate: migrate, rollDay: rollDay };
});

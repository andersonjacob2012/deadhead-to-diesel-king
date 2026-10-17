/* Speed-boost tank — pure logic, no DOM (ad-unlock-spec §4). UMD: window.DKBoost / require().
 * bank is in boost-seconds (5x-equivalent). 5x burns 1/s, 10x burns 2/s (cfg.burn).
 */
(function (root, f) { var m = f(); if (typeof module === 'object' && module.exports) module.exports = m; else root.DKBoost = m; })(this, function () {
  'use strict';
  function perAd(cfg) { return cfg.boostMinPerAd * 60; }
  function tankMax(cfg) { return cfg.boostTankMax * 60; }
  function dailyCap(cfg) { return cfg.caps && cfg.caps.speed_boost != null ? cfg.caps.speed_boost : cfg.boostAdsPerDay; }
  function burnRate(spd, cfg) { spd = +spd || 1; if (spd <= 1) return 0; var b = cfg.burn && cfg.burn[spd]; return b != null ? b : spd / 5; }
  // canSpd(m): m==1 || !gated || bank>0 || adFree
  function canSpd(m, o) { return +m <= 1 || !o.gated || (o.bank > 0) || !!o.adFree; }
  // Can the player add one ad's worth of fuel right now? (checked before BOTH showRewarded and grantFree)
  function canAdd(boost, ads, cfg) {
    if ((boost.bank || 0) + perAd(cfg) > tankMax(cfg) + 1e-6) return { ok: false, reason: 'full' };
    if (((ads && ads.cnt && ads.cnt.speed_boost) || 0) >= dailyCap(cfg)) return { ok: false, reason: 'capped' };
    return { ok: true };
  }
  function add(boost, cfg, sec) { boost.bank = Math.min(tankMax(cfg), (boost.bank || 0) + (sec == null ? perAd(cfg) : sec)); return boost.bank; }
  // Drain only while spd>1 AND gated AND visible AND loop running AND no ad. dt is the loop's real dt, clamped <= 0.5 s.
  // Returns boost-seconds burned (number; no per-frame allocation). Empty <=> boost.bank <= 0 afterwards.
  function drain(boost, dt, c, cfg) {
    if (!c.gated || !(c.spd > 1) || c.hidden || c.adPlaying || c.paused) return 0;
    dt = Math.min(0.5, Math.max(0, +dt || 0));
    var b = boost.bank || 0, nb = Math.max(0, b - dt * burnRate(c.spd, cfg));
    boost.bank = nb;
    return b - nb;
  }
  // First gated session for a save: one free tank, once, only for saves that existed before gating.
  function firstGate(S, cfg, now) {
    var g = S.gate, out = { first: false, fuel: 0 };
    if (!g.since) { g.since = now || Date.now(); out.first = true; }
    if (!g.fuel) { g.fuel = 1; if (!g.fresh) { add(S.boost, cfg, cfg.firstGateFuelMin * 60); out.fuel = cfg.firstGateFuelMin * 60; } }
    return out;
  }
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  // Real time left at a tier: "24:10 @5x"
  function label(bank, spd, cfg) { var t = spd > 1 ? spd : 5; return fmt(bank / (burnRate(t, cfg) || 1)) + ' @' + t + 'x'; }
  return { perAd: perAd, tankMax: tankMax, dailyCap: dailyCap, burnRate: burnRate, canSpd: canSpd, canAdd: canAdd, add: add, drain: drain, firstGate: firstGate, fmt: fmt, label: label };
});

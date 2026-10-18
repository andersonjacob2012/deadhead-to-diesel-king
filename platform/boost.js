/* Speed-boost tank — pure logic, no DOM (ad-unlock-spec §4). UMD: window.DKBoost / require().
 * bank is in boost-seconds (5x-equivalent). 5x burns 1/s, 10x burns 1.6/s (cfg.burn): 8 min/ad at 5x = 5 min at 10x.
 * Medal fuel (spec §4.3) pays once per badge while gated and may exceed the ad tank max up to cfg.medalCeilMin.
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
  function add(boost, cfg, sec, ceil) { var b = boost.bank || 0, m = Math.max(b, ceil || tankMax(cfg)); boost.bank = Math.min(m, b + (sec == null ? perAd(cfg) : sec)); return boost.bank; }
  function ceil(cfg) { return cfg.medalCeilMin * 60; }
  function medalMin(id, cfg) { var v = cfg.medalFuel && cfg.medalFuel[id]; return v > 0 ? v : 0; }
  // Live medal fuel. list = game medals(): [[id, name, ok], ...]. Pays each fuelled badge once ever; returns new grants.
  function medalTick(S, list, cfg) {
    var paid = S.boost.medalPaid, out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var id = list[i][0], m = medalMin(id, cfg);
      if (!list[i][2] || !m || paid.indexOf(id) >= 0) continue;
      paid.push(id); add(S.boost, cfg, m * 60, ceil(cfg)); out.push({ id: id, name: list[i][1], min: m });
    }
    return out;
  }
  // First gated launch: mark every badge already met as paid; a pre-gating save that met >= 1 fuelled badge gets
  // cfg.medalRetroMin once (this replaces the old free tank). A save created while gated (S.gate.fresh) gets nothing here.
  function firstGate(S, cfg, now, list) {
    var g = S.gate, out = { first: false, fuel: 0 };
    if (!g.since) { g.since = now || Date.now(); out.first = true; }
    if (g.retro) return out;
    g.retro = 1; if (g.fresh) return out;
    var paid = S.boost.medalPaid, any = false;
    for (var i = 0; i < (list || []).length; i++) {
      if (!list[i][2]) continue;
      if (paid.indexOf(list[i][0]) < 0) paid.push(list[i][0]);
      if (medalMin(list[i][0], cfg)) any = true;
    }
    if (any) { out.fuel = cfg.medalRetroMin * 60; add(S.boost, cfg, out.fuel, ceil(cfg)); }
    return out;
  }
  // Drain only while spd>1 AND gated AND visible AND loop running AND no ad. dt is the loop's real dt, clamped <= 0.5 s.
  // Returns boost-seconds burned (number; no per-frame allocation). Empty <=> boost.bank <= 0 afterwards.
  function drain(boost, dt, c, cfg) {
    if (!c.gated || !(c.spd > 1) || c.hidden || c.adPlaying || c.paused) return 0;
    dt = Math.min(0.5, Math.max(0, +dt || 0));
    var b = boost.bank || 0, nb = Math.max(0, b - dt * burnRate(c.spd, cfg));
    boost.bank = nb;
    return b - nb;
  }
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  // Real time left at a tier: "24:10 @5x"
  function label(bank, spd, cfg) { var t = spd > 1 ? spd : 5; return fmt(bank / (burnRate(t, cfg) || 1)) + ' @' + t + 'x'; }
  return { perAd: perAd, tankMax: tankMax, dailyCap: dailyCap, burnRate: burnRate, canSpd: canSpd, canAdd: canAdd, add: add, drain: drain, firstGate: firstGate, medalTick: medalTick, medalMin: medalMin, fmt: fmt, label: label };
});

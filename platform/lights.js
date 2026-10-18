/* Chicken-light unlocks — pure logic (ad-unlock-spec §5). UMD: window.DKLights / require().
 * palettes: [{id, unlock?, cost?}] from rigs.json chicken.palettes.
 */
(function (root, f) { var m = f(); if (typeof module === 'object' && module.exports) module.exports = m; else root.DKLights = m; })(this, function () {
  'use strict';
  function isFree(p) { return !!p && (p.unlock === 'default' || p.id === 'amber'); }
  function cost(p, cfg) {
    if (!p || isFree(p)) return 0;
    if (typeof p.cost === 'number' && p.cost >= 0) return p.cost;
    var c = cfg.ckCost && cfg.ckCost[p.id];
    return typeof c === 'number' ? c : cfg.ckCostDefault;
  }
  // ckOk(id) = !gated || default || ckOwn || adFree || lightBar
  function owned(id, palettes, o) {
    var p = find(palettes, id); if (!p) return false;
    return !o.gated || isFree(p) || (o.ckOwn || []).indexOf(id) >= 0 || !!o.adFree || !!o.lightBar;   // ad-only: no medal or zero-cost unlocks
  }
  function find(palettes, id) { for (var i = 0; i < (palettes || []).length; i++) if (palettes[i].id === id) return palettes[i]; return null; }
  function progress(S, p, cfg) { return { have: (S.ckProg && S.ckProg[p.id]) | 0, need: cost(p, cfg) }; }
  // One completed ad toward color p. Progress never decays; reaching the cost moves it to S.ckOwn.
  function applyAd(S, p, cfg) {
    S.ckOwn = S.ckOwn || ['amber']; S.ckProg = S.ckProg || {};
    if (S.ckOwn.indexOf(p.id) >= 0 || isFree(p)) return { unlocked: false, already: true, have: 0, need: 0 };
    var need = cost(p, cfg), have = (S.ckProg[p.id] | 0) + 1;
    if (have >= need) { S.ckOwn.push(p.id); delete S.ckProg[p.id]; return { unlocked: true, have: need, need: need }; }
    S.ckProg[p.id] = have; return { unlocked: false, have: have, need: need };
  }
  // Runs once per save on the first gated session (S.gate.ck): the player keeps the color already equipped (Jacob, Oct 18).
  // Grants at most that ONE color; nothing else is free.
  // Pre-gating saves only: a save created while gated (S.gate.fresh) never gets this. No toast, no amber reset.
  function keepEquipped(S) {
    if (S.gate.ck) return null;
    S.gate.ck = 1; S.ckOwn = Array.isArray(S.ckOwn) ? S.ckOwn : ['amber'];
    if (S.gate.fresh) return null;
    var c = S.chicken;
    if (c && c !== 'amber' && S.ckOwn.indexOf(c) < 0) { S.ckOwn.push(c); return c; }
    return null;
  }
  return { isFree: isFree, cost: cost, owned: owned, find: find, progress: progress, applyAd: applyAd, keepEquipped: keepEquipped };
});

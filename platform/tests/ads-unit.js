// Unit tests for platform/ads: boost tank, light unlocks, save migration, day rollover, reward de-dupe, fail-open,
// no-fill/pity, entitlements cache. "QA n" = ad-unlock-spec.md §11 case n.
const assert = require('assert'), P = require('path').join(__dirname, '..');
const C = require(P + '/dk-config.js'), B = require(P + '/boost.js'), LT = require(P + '/lights.js'), MS = require(P + '/mon-state.js'), A = require(P + '/ads.js'), E = require(P + '/entitlements.js');
const CS = require(P + '/consent.js');
const cfg = C.build({}).cfg; let n = 0; const ok = (name) => { n++; };
const T = []; const test = (name, fn) => T.push([name, fn]);
const freshS = (o = {}) => MS.migrate(Object.assign({ spd: 1 }, o), { cfg, isNew: !!o._new, adsEnabled: !!o._on });

// ---------- flag / config ----------
test('QA1/2 flag: ADS_ENABLED off by default on web and native; web needs webAdsEnabled', () => {
  const nat = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
  assert.equal(C.build({}).adsEnabled, false);
  assert.equal(C.build(nat).adsEnabled, false);
  assert.equal(C.build(Object.assign({ DK_REMOTE: { adsEnabled: true } }, nat)).adsEnabled, true);
  assert.equal(C.build({ DK_REMOTE: { adsEnabled: true } }).adsEnabled, false, 'web stays free');
  assert.equal(C.build({ DK_REMOTE: { adsEnabled: true, webAdsEnabled: true } }).adsEnabled, false, 'web also needs webAdHost');
  assert.equal(C.build({ location: { hostname: 'h' }, DK_REMOTE: { webAdsEnabled: true, webAdHost: 'h' } }).adsEnabled, true);
});
test('QA4 remote: cached copy used, bad values rejected, defaults without cache', () => {
  const ls = { getItem: () => JSON.stringify({ boostTankMax: 120, boostAdsPerDay: -3, minAdGapSec: 'x', caps: { oos_lawyer: 2 }, evil: 1 }) };
  const c = C.build({ localStorage: ls }).cfg;
  assert.equal(c.boostTankMax, 120); assert.equal(c.boostAdsPerDay, 10); assert.equal(c.minAdGapSec, 20); assert.equal(c.caps.oos_lawyer, 2); assert.equal(c.evil, undefined);
  assert.equal(C.build({ localStorage: { getItem: () => null } }).cfg.adsEnabled, false);
  assert.equal(C.build({ localStorage: { getItem: () => '{bad json' } }).cfg.boostTankMax, 24);
});
test('final spec numbers: 8 min/ad at 5x = 5 min at 10x, tank 24 min at 5x, 10 boost ads/day, medal 16/8', () => {
  assert.equal(cfg.boostMinPerAd, 8); assert.equal(cfg.boostTankMax, 24); assert.equal(cfg.boostAdsPerDay, 10); assert.equal(B.dailyCap(cfg), 10);
  assert.equal(B.perAd(cfg) / B.burnRate(5, cfg), 8 * 60); assert.equal(B.perAd(cfg) / B.burnRate(10, cfg), 5 * 60);
  assert.equal(B.tankMax(cfg), 24 * 60); assert.equal(cfg.firstGateFuelMin, undefined, 'free tank removed');
  assert.deepEqual(C.DEFAULTS.burn, { 5: 1, 10: 1.6 }); assert.equal(C.DEFAULTS.boostTankMax, 24); assert.equal(C.DEFAULTS.boostAdsPerDay, 10); assert.equal(C.DEFAULTS.boostMinPerAd, 8);
  assert.equal(C.DEFAULTS.adsEnabled, false); assert.equal(C.DEFAULTS.webAdsEnabled, false); assert.equal(C.DEFAULTS.adsDown, false);
  assert.equal(B.medalMin('t10', cfg), 16); assert.equal(B.medalMin('fleet-5', cfg), 8); assert.equal(B.medalMin('first-load', cfg), 0);
  assert.equal(Object.values(cfg.medalFuel).reduce((a, b) => a + b, 0), 240);
});
test('storage keys: dk.remote + dk.ads.ok suffixed with DK_SAVE_KEY on staging, unchanged on live', () => {
  assert.equal(C.skey('dk.ads.ok', 'idletruck'), 'dk.ads.ok'); assert.equal(C.skey('dk.ads.ok'), 'dk.ads.ok');
  assert.equal(C.skey('dk.ads.ok', 'idletruck_staging'), 'dk.ads.ok.idletruck_staging');
  let asked = []; const ls = { getItem: k => { asked.push(k); return k === 'dk.remote.idletruck_staging' ? '{"boostTankMax":30}' : '{"boostTankMax":40}'; } };
  const st = C.build({ DK_SAVE_KEY: 'idletruck_staging', localStorage: ls }); assert.equal(st.cache, 'dk.remote.idletruck_staging'); assert.equal(st.cfg.boostTankMax, 30);
  const lv = C.build({ DK_SAVE_KEY: 'idletruck', localStorage: ls }); assert.equal(lv.cache, 'dk.remote'); assert.equal(lv.cfg.boostTankMax, 40);
  assert.deepEqual(asked, ['dk.remote.idletruck_staging', 'dk.remote']);
  const src = require('fs').readFileSync(P + '/monetize.js', 'utf8'); assert.ok(/skey\('dk\.ads\.ok'\)/.test(src) && !/'dk\.ads\.ok',/.test(src), 'monetize.js uses the suffixed key');
});
test('adsDown remote switch: unlocks all (ADS_ENABLED false) on native and web, from DK_REMOTE or the cached copy', () => {
  const nat = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
  assert.equal(C.build(Object.assign({ DK_REMOTE: { adsEnabled: true } }, nat)).adsEnabled, true);
  assert.equal(C.build(Object.assign({ DK_REMOTE: { adsEnabled: true, adsDown: true } }, nat)).adsEnabled, false);
  assert.equal(C.build({ location: { hostname: 'h' }, DK_REMOTE: { webAdsEnabled: true, webAdHost: 'h', adsDown: true } }).adsEnabled, false);
  assert.equal(C.build(Object.assign({ localStorage: { getItem: () => '{"adsEnabled":true,"adsDown":true}' } }, nat)).adsEnabled, false);
});
test('QA18c burn: 480 s at 10x empties after 300 real s; 5x<->10x mid-boost drains 1 / 1.6 with no rounding loss', () => {
  const c = (spd) => ({ gated: true, spd, hidden: false, adPlaying: false }); let b = { bank: 480 }, t = 0;
  while (b.bank > 0) { B.drain(b, 0.5, c(10), cfg); t += 0.5; } assert.ok(Math.abs(t - 300) <= 1, t);
  b = { bank: 480 }; for (let i = 0; i < 200; i++) B.drain(b, 0.5, c(5), cfg); for (let i = 0; i < 200; i++) B.drain(b, 0.5, c(10), cfg);
  assert.ok(Math.abs(b.bank - (480 - 100 - 160)) < 1e-6, b.bank);
});
test('web ads: only on the approved webAdHost; github.io/staging/localhost never gate; shipped off', () => {
  const at = (h, r) => C.build({ location: { hostname: h }, DK_REMOTE: r }).adsEnabled;
  assert.equal(at('play.example.com', {}), false);
  assert.equal(at('play.example.com', { webAdsEnabled: true }), false, 'no host configured');
  assert.equal(at('play.example.com', { webAdsEnabled: true, webAdHost: 'play.example.com' }), true);
  assert.equal(at('andersonjacob2012.github.io', { webAdsEnabled: true, webAdHost: 'play.example.com' }), false);
  assert.equal(at('localhost', { adsEnabled: true, webAdsEnabled: true, webAdHost: 'play.example.com' }), false);
  assert.equal(cfg.adsense.client, 'ca-pub-7551782011512719', 'Jacob\'s publisher id'); assert.equal(cfg.webAdsEnabled, false, 'web ads still off'); assert.equal(cfg.webAdHost, '');
});

// ---------- migration ----------
test('save migration: backward-compatible defaults, existing values kept', () => {
  const s = freshS(); assert.deepEqual(s.boost, { bank: 0, tier: 5, medalPaid: [] }); assert.deepEqual(s.ckOwn, ['amber']); assert.deepEqual(s.ckProg, {});
  assert.equal(s.ads.v, 1); assert.equal(s.ads.cnt.speed_boost, 0); assert.deepEqual(s.ads.nonces, []);
  assert.deepEqual(s.ent, { adFree: false, noForced: false, lightBar: false, ts: 0, dev: '' }); assert.deepEqual(s.gate, { since: 0, retro: 0, ck: 0 });
  const k = MS.migrate({ boost: { bank: 99999, tier: 10 }, ckOwn: ['red'], ckProg: { chase: 2 }, ads: { cnt: { speed_boost: 4 }, nonces: Array(30).fill('x') }, gate: { since: 5, fuel: 1, ck: 1 } }, { cfg });
  assert.equal(k.boost.bank, 48 * 60, 'clamped to the medal ceiling'); assert.equal(k.boost.tier, 10); assert.deepEqual(k.ckOwn, ['red']); assert.equal(k.ckProg.chase, 2);
  assert.equal(k.ads.cnt.speed_boost, 4); assert.equal(k.ads.nonces.length, 20); assert.deepEqual(k.gate, { since: 5, retro: 0, ck: 1 }, 'old free-tank flag dropped');
  assert.equal(MS.migrate({}, { cfg, isNew: true, adsEnabled: true }).gate.fresh, 1);
  assert.equal(MS.migrate({}, { cfg, isNew: true, adsEnabled: false }).gate.fresh, undefined);
});

// ---------- speed tank ----------
test('QA5 canSpd: 1x always; 5x/10x need bank when gated; free when not gated; adFree', () => {
  assert.ok(B.canSpd(1, { gated: true, bank: 0 })); assert.ok(!B.canSpd(5, { gated: true, bank: 0 })); assert.ok(!B.canSpd(10, { gated: true, bank: 0 }));
  assert.ok(B.canSpd(10, { gated: false, bank: 0 })); assert.ok(B.canSpd(10, { gated: true, bank: 1 })); assert.ok(B.canSpd(10, { gated: true, bank: 0, adFree: true }));
  const s = freshS(); B.add(s.boost, cfg); assert.equal(s.boost.bank, 480);
});
test('QA6/7/26 drain: 1/s at 5x, 1.6/s at 10x, 0 at 1x, 0 hidden, 0 during ad, 0 ungated, dt clamped', () => {
  const b = { bank: 1000 }, c = (o) => Object.assign({ gated: true, spd: 5, hidden: false, adPlaying: false }, o);
  B.drain(b, 0.5, c(), cfg); assert.equal(b.bank, 999.5);
  B.drain(b, 0.5, c({ spd: 10 }), cfg); assert.equal(b.bank, 998.7);
  B.drain(b, 0.5, c({ spd: 1 }), cfg); B.drain(b, 0.5, c({ hidden: true, spd: 10 }), cfg); B.drain(b, 0.5, c({ adPlaying: true, spd: 10 }), cfg); B.drain(b, 0.5, c({ gated: false, spd: 10 }), cfg);
  assert.equal(b.bank, 998.7);
  B.drain(b, 600, c({ spd: 10 }), cfg); assert.equal(+b.bank.toFixed(6), 997.9, 'a 10-minute background gap only burns the 0.5 s clamp');
  const e = { bank: 0.3 }; B.drain(e, 0.5, c({ spd: 10 }), cfg); assert.equal(e.bank, 0);
});
test('QA10 tank max 24 and 10/day: Watch hidden when bank+8>24, 11th capped; other placements do not count', () => {
  const s = freshS(); for (let i = 0; i < 3; i++) { assert.ok(B.canAdd(s.boost, s.ads, cfg).ok); B.add(s.boost, cfg); }
  assert.equal(s.boost.bank, 1440); assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'full');
  s.boost.bank = 961; assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'full'); s.boost.bank = 960; assert.ok(B.canAdd(s.boost, s.ads, cfg).ok);
  s.boost.bank = 0; s.ads.cnt.speed_boost = 9; s.ads.cnt.offline_x2 = 4; s.ads.cnt.hot_refresh = 3; assert.ok(B.canAdd(s.boost, s.ads, cfg).ok);
  s.ads.cnt.speed_boost = 10; assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'capped');
});
const MED = (ids) => ['first-load', 'miles-10k', 'fleet-5', 't10', 'fleet-25', 'cash-100k'].map(id => [id, id, ids.includes(id)]);
test('QA13 retro: pre-gating save with fuelled badges => one 16-min grant, all met marked paid, once; free tank gone', () => {
  const s = freshS({ spd: 10 }); let r = B.firstGate(s, cfg, 1, MED(['first-load', 'miles-10k', 'fleet-5', 't10']));
  assert.equal(r.fuel, 16 * 60); assert.equal(s.boost.bank, 960); assert.deepEqual(s.boost.medalPaid, ['first-load', 'miles-10k', 'fleet-5', 't10']);
  s.gate.since = 0; r = B.firstGate(s, cfg, 2, MED(['first-load', 'miles-10k', 'fleet-5', 't10', 'fleet-25'])); assert.equal(r.fuel, 0); assert.equal(s.boost.bank, 960, 'relaunch: no second grant');
  assert.equal(B.medalTick(s, MED(['first-load', 'miles-10k', 'fleet-5', 't10']), cfg).length, 0, 'retro-marked badges never pay again');
  const z = freshS(); assert.equal(B.firstGate(z, cfg, 1, MED(['first-load', 'cash-100k'])).fuel, 0, 'no fuelled badge => no grant'); assert.equal(z.boost.bank, 0);
  const f = freshS({ _new: 1, _on: 1 }); B.firstGate(f, cfg, 1, MED(['fleet-5'])); assert.equal(f.boost.bank, 0, 'save created while gated: no retro');
  assert.deepEqual(f.boost.medalPaid, []); assert.equal(B.medalTick(f, MED(['fleet-5']), cfg)[0].min, 8, '...it earns medal fuel live instead');
});
test('QA13 live medal fuel: 16 big / 8 small, once ever, may exceed 24 up to 48, never touches the ad count', () => {
  const s = freshS(); let g = B.medalTick(s, MED(['fleet-5']), cfg); assert.equal(g.length, 1); assert.equal(s.boost.bank, 480);
  assert.equal(B.medalTick(s, MED([]), cfg).length, 0); assert.equal(B.medalTick(s, MED(['fleet-5']), cfg).length, 0, 'sell down and back up: no re-pay');
  s.boost.bank = 1440; g = B.medalTick(s, MED(['fleet-5', 't10']), cfg); assert.equal(g[0].min, 16); assert.equal(s.boost.bank, 1440 + 960, 'above the 24-min ad max');
  B.medalTick(s, MED(['fleet-5', 't10', 'fleet-25']), cfg); assert.equal(s.boost.bank, 48 * 60, 'hard ceiling 48'); assert.equal(s.ads.cnt.speed_boost, 0);
  assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'full', 'Watch still hidden when bank + 8 > 24');
});
test('label "24:10 @5x"', () => { assert.equal(B.label(1450, 5, cfg), '24:10 @5x'); assert.equal(B.label(1440, 10, cfg), '15:00 @10x'); assert.equal(B.label(1450, 1, cfg), '24:10 @5x'); });

// ---------- day rollover / clock ----------
test('QA25 daily counts: clock back keeps counts, forward resets', () => {
  const s = freshS(), D = 20000, day = 864e5, t0 = D * day + 12 * 3600e3; MS.rollDay(s.ads, D, t0, cfg); s.ads.cnt.speed_boost = 6; s.ads.pity = 1;
  assert.equal(MS.rollDay(s.ads, D - 1, t0 - day, cfg), false); assert.equal(s.ads.cnt.speed_boost, 6);
  assert.equal(MS.rollDay(s.ads, D + 1, t0 + day, cfg), true); assert.equal(s.ads.cnt.speed_boost, 0); assert.equal(s.ads.pity, 0);
  const k = freshS(); MS.rollDay(k.ads, D, t0, cfg); k.ads.maxTs = t0 + 5 * day; k.ads.cnt.speed_boost = 6;   // clock was far ahead, then set back
  assert.equal(MS.rollDay(k.ads, D + 1, t0 + day, cfg), false); assert.equal(k.ads.cnt.speed_boost, 6);
});

// ---------- chicken lights ----------
const PAL = [{ id: 'amber', unlock: 'default' }, { id: 'red' }, { id: 'blue' }, { id: 'green' }, { id: 'white' }, { id: 'purple' }, { id: 'chase' }, { id: 'neon' }, { id: 'gold', cost: 5 }];
test('light costs 1/1/1/1/2/3, amber 0, future default 2, rigs.json cost wins', () => {
  assert.deepEqual(PAL.map(p => LT.cost(p, cfg)), [0, 1, 1, 1, 1, 2, 3, 2, 5]);
});
test('QA16 fresh gated: only amber owned; red after 1 ad', () => {
  const s = freshS(), o = () => ({ gated: true, ckOwn: s.ckOwn, cfg });
  assert.deepEqual(PAL.filter(p => LT.owned(p.id, PAL, o())).map(p => p.id), ['amber']);
  assert.ok(LT.applyAd(s, PAL[1], cfg).unlocked); assert.ok(LT.owned('red', PAL, o()));
  assert.ok(LT.owned('chase', PAL, { gated: false, ckOwn: [] }), 'ungated: everything free');
});
test('QA17 chase progress 1/3, 2/3 persists across reload, 3rd unlocks and clears progress', () => {
  const s = freshS(), chase = PAL[6]; LT.applyAd(s, chase, cfg); LT.applyAd(s, chase, cfg);
  const re = MS.migrate(JSON.parse(JSON.stringify(s)), { cfg }); assert.deepEqual(LT.progress(re, chase, cfg), { have: 2, need: 3 });
  const r = LT.applyAd(re, chase, cfg); assert.ok(r.unlocked); assert.ok(re.ckOwn.includes('chase')); assert.equal(re.ckProg.chase, undefined);
  assert.ok(LT.applyAd(re, chase, cfg).already);
});
test('QA18/19 keep equipped color: only the equipped non-amber color, once; nothing else free; no medal unlocks', () => {
  const s = freshS({ chicken: 'purple' }); assert.equal(LT.keepEquipped(s), 'purple'); assert.deepEqual(s.ckOwn, ['amber', 'purple']);
  s.chicken = 'chase'; assert.equal(LT.keepEquipped(s), null, 'runs once'); assert.deepEqual(s.ckOwn, ['amber', 'purple']);
  assert.ok(LT.owned('purple', PAL, { gated: true, ckOwn: s.ckOwn })); assert.ok(!LT.owned('chase', PAL, { gated: true, ckOwn: s.ckOwn }));
  const a = freshS({ chicken: 'amber' }); assert.equal(LT.keepEquipped(a), null); assert.deepEqual(a.ckOwn, ['amber']);
  const f = freshS({ chicken: 'purple', _new: 1, _on: 1 }); assert.equal(LT.keepEquipped(f), null, 'a save created while gated never gets it'); assert.deepEqual(f.ckOwn, ['amber']);
  const pre = freshS({ chicken: 'chase', ckProg: { red: 0 } }); LT.keepEquipped(pre); assert.deepEqual(pre.ckOwn, ['amber', 'chase'], 'exactly the equipped color, nothing else');
  assert.ok(!LT.owned('red', [{ id: 'red', cost: 0, unlock: 'medal' }], { gated: true, ckOwn: [] }), 'zero-cost/medal palettes are not free');
  assert.equal(typeof LT.grandfather, 'undefined');
});
test('QA20 lightBar / adFree: every color', () => {
  assert.ok(PAL.every(p => LT.owned(p.id, PAL, { gated: true, ckOwn: [], lightBar: true })));
  assert.ok(PAL.every(p => LT.owned(p.id, PAL, { gated: true, ckOwn: [], adFree: true })));
});

// ---------- rewarded ads ----------
function rig(script, o = {}) {
  const s = freshS(), clock = { t: 20000 * 864e5 + 10 * 3600e3 }, ev = [], ad = A.adapters.mock(script), st = { pause: 0, resume: 0, save: 0 };
  const ads = A.create(Object.assign({ adapter: ad, cfg: Object.assign({}, cfg, { dismissGraceMs: 20, loadTimeoutSec: 0.05 }), enabled: true, state: () => s.ads, now: () => clock.t,
    day: () => Math.floor(clock.t / 864e5), rollDay: MS.rollDay, online: () => !o.offline, track: (e, p) => ev.push([e, p]),
    pause: () => st.pause++, resume: () => st.resume++, save: () => st.save++ }, o));
  return { s, clock, ev, ad, ads, st };
}
const adv = (r, sec) => { r.clock.t += sec * 1000; };
test('QA3 fail-open: init failure => unhealthy; disabled => unhealthy; no SDK calls when disabled', async () => {
  const r = rig('initfail'); await r.ads.init(); assert.equal(r.ads.healthy(), false); assert.ok(r.ev.some(e => e[0] === 'ads_unhealthy'));
  const off = rig('reward', { enabled: false }); await off.ads.init(); assert.equal(off.ads.healthy(), false); assert.equal(off.ad.calls.init, 0);
  const res = await off.ads.showRewarded('speed_boost', { reward: () => assert.fail() }); assert.equal(res.status, 'error'); assert.equal(off.ad.calls.load, 0);
  const pend = rig('reward'); assert.equal(pend.ads.healthy(), false, 'not healthy before init on first ever run');
  const pend2 = rig('reward', { lastInitOk: true }); assert.equal(pend2.ads.healthy(), true, 'optimistic while re-initializing after a good session');
});
test('fail-open: 5 consecutive errors in 30 min => unhealthy; no-fill does not count', async () => {
  const r = rig(Array(10).fill('error')); await r.ads.init();
  for (let i = 0; i < 4; i++) { await r.ads.showRewarded('chicken_unlock'); adv(r, 30); } assert.equal(r.ads.healthy(), true);
  await r.ads.showRewarded('chicken_unlock'); assert.equal(r.ads.healthy(), false);
  adv(r, 31 * 60); assert.equal(r.ads.healthy(), true, 'window expires');
  const nf = rig(Array(10).fill('no_fill')); await nf.ads.init(); for (let i = 0; i < 6; i++) { await nf.ads.showRewarded('chicken_unlock'); adv(nf, 30); } assert.equal(nf.ads.healthy(), true);
});
test('QA5 reward: grant only on reward event, once, then save; pause+resume around the ad', async () => {
  const r = rig('reward'); await r.ads.init(); let g = 0;
  const res = await r.ads.showRewarded('speed_boost', { reward: () => g++ });
  assert.equal(res.status, 'rewarded'); assert.ok(res.granted); assert.equal(g, 1); assert.ok(r.st.save >= 1); assert.equal(r.st.pause, 1); assert.equal(r.st.resume, 1);
  assert.equal(r.s.ads.cnt.speed_boost, 1); assert.equal(r.s.ads.nonces.length, 1); assert.equal(r.s.ads.lastAdTs, r.clock.t);
  assert.ok(['ad_request', 'ad_result', 'ad_reward_granted'].every(e => r.ev.some(x => x[0] === e)));
});
test('QA23 dismissed early: no grant, interstitial clock not reset, button stays available', async () => {
  const r = rig('dismiss'); await r.ads.init(); const res = await r.ads.showRewarded('speed_boost', { reward: () => assert.fail('granted') });
  assert.equal(res.status, 'dismissed'); assert.equal(res.granted, false); assert.equal(r.s.ads.lastAdTs, 0); assert.equal(r.s.ads.cnt.speed_boost, 0);
  assert.ok(r.ads.canShow('speed_boost').ok);
});
test('QA24 double-tap => busy; duplicate reward callback (same nonce) => one grant; late reward after Dismissed still grants once', async () => {
  const r = rig('double'); await r.ads.init(); let g = 0;
  const p1 = r.ads.showRewarded('chicken_unlock', { reward: () => g++ }), p2 = await r.ads.showRewarded('chicken_unlock', { reward: () => g++ });
  assert.equal(p2.status, 'busy'); const res = await p1; assert.equal(res.status, 'rewarded'); await new Promise(z => setTimeout(z, 30)); assert.equal(g, 1); assert.equal(r.ad.calls.show, 1, 'one request only');
  assert.equal(r.ads.grant(res.nonce, 'chicken_unlock', () => g++, 'ad'), false); assert.equal(g, 1);
  const l = rig('late'); await l.ads.init(); let h = 0; const lr = await l.ads.showRewarded('chicken_unlock', { reward: () => h++ });
  // 'late' fires Rewarded 50 ms after Dismissed; grace is 20 ms in this rig, so it settles dismissed and the late event is ignored
  assert.equal(lr.status, 'dismissed'); await new Promise(z => setTimeout(z, 80)); assert.equal(h, 0);
  const l2 = rig('late', { cfg: Object.assign({}, cfg, { dismissGraceMs: 200, loadTimeoutSec: 0.05 }) }); await l2.ads.init(); let h2 = 0;
  const lr2 = await l2.ads.showRewarded('chicken_unlock', { reward: () => h2++ }); assert.equal(lr2.status, 'rewarded'); assert.equal(h2, 1);
});
test('nonce ring keeps last 20', () => { const r = rig('reward'); for (let i = 0; i < 25; i++) r.ads.grant('n' + i, 'chicken_unlock', null, 'ad'); assert.equal(r.s.ads.nonces.length, 20); assert.equal(r.s.ads.nonces[0], 'n5'); assert.equal(r.ads.grant('n24', 'chicken_unlock', null, 'ad'), false); });
test('minAdGapSec 20 s and hot_refresh 20-min gap; daily cap => capped', async () => {
  const r = rig('reward'); await r.ads.init(); await r.ads.showRewarded('chicken_unlock', { reward() {} });
  assert.equal((await r.ads.showRewarded('chicken_unlock')).status, 'capped'); adv(r, 21); assert.equal((await r.ads.showRewarded('chicken_unlock', { reward() {} })).status, 'rewarded');
  adv(r, 21); await r.ads.showRewarded('hot_refresh', { reward() {} }); adv(r, 60); assert.equal(r.ads.canShow('hot_refresh').reason, 'gap'); adv(r, 20 * 60); assert.ok(r.ads.canShow('hot_refresh').ok);
  r.s.ads.cnt.speed_boost = 9; adv(r, 21); assert.ok(r.ads.canShow('speed_boost').ok, '9 of 10');
  r.s.ads.cnt.speed_boost = 10; assert.equal(r.ads.canShow('speed_boost').reason, 'capped'); assert.equal((await r.ads.showRewarded('speed_boost')).status, 'capped');
});
test('QA21 no-fill: apology; 2nd within 10 min => one pity grant; 3rd same day => apology only', async () => {
  const r = rig(Array(10).fill('no_fill')); await r.ads.init(); let g = 0; const f = () => g++;
  let x = await r.ads.showRewarded('speed_boost', { reward: f }); assert.equal(x.status, 'no_fill'); assert.equal(x.granted, false);
  adv(r, 60); x = await r.ads.showRewarded('speed_boost', { reward: f }); assert.equal(x.granted, true); assert.equal(x.via, 'pity'); assert.equal(g, 1); assert.equal(r.s.ads.pity, 1); assert.equal(r.s.ads.cnt.speed_boost, 1, 'counts toward cap');
  adv(r, 60); x = await r.ads.showRewarded('speed_boost', { reward: f }); adv(r, 60); x = await r.ads.showRewarded('speed_boost', { reward: f }); assert.equal(x.granted, false); assert.equal(g, 1);
  const w = rig(Array(4).fill('no_fill')); await w.ads.init(); await w.ads.showRewarded('speed_boost'); adv(w, 11 * 60); assert.equal((await w.ads.showRewarded('speed_boost', { reward: () => assert.fail() })).granted, false, 'outside 10 min');
  const e = rig(['error', 'showfail']); await e.ads.init(); await e.ads.showRewarded('chicken_unlock'); adv(e, 30); assert.equal((await e.ads.showRewarded('chicken_unlock', { reward() {} })).via, 'pity', 'SDK show error follows the same pity rule');
});
test('QA22 offline: needs-connection, never pity, no SDK request', async () => {
  const r = rig('no_fill', { offline: true }); await r.ads.init(); const l0 = r.ad.calls.load;
  for (let i = 0; i < 3; i++) { const x = await r.ads.showRewarded('speed_boost', { reward: () => assert.fail() }); assert.equal(x.status, 'offline'); adv(r, 60); }
  assert.equal(r.ad.calls.load, l0); assert.equal(r.s.ads.pity, 0);
});
test('load timeout (hang) resolves no_fill and frees the slot', async () => {
  const r = rig(['hang', 'reward']); await r.ads.init(); const x = await r.ads.showRewarded('chicken_unlock'); assert.equal(x.status, 'no_fill'); assert.equal(r.ads.busy(), false);
});
test('QA14 grantFree (Ad-Free): same caps and grant path, via free_ent', () => {
  const r = rig('reward'); let g = 0; for (let i = 0; i < 10; i++) assert.equal(r.ads.grantFree('speed_boost', { reward: () => g++ }).granted, true);
  assert.equal(r.ads.grantFree('speed_boost', { reward: () => g++ }).status, 'capped'); assert.equal(g, 10); assert.ok(r.ev.some(e => e[0] === 'ad_reward_granted' && e[1].via === 'free_ent'));
});

// ---------- web: AdSense H5 adapter stub + ad blocker ----------
function fakeWin(mode) {
  const w = { DK_STAGE: true, DKConsent: { active: true, ready: () => Promise.resolve('gdpr') }, adsbygoogle: undefined, pushed: [], getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }, head = { appendChild: (el) => { w.tag = el; setTimeout(() => {
    if (/error/.test(mode)) return el.onerror();
    if (mode === 'ok') { const q = w.adsbygoogle || []; w.adsbygoogle = { loaded: true, push: (o) => { w.pushed.push(o); if (o.type === 'reward') w.onBreak(o); } }; q.forEach(o => w.adsbygoogle.push(o)); }
    el.onload(); }, 0); } };
  const hide = /hidden/.test(mode); w.document = { head, body: { appendChild: (el) => { el.offsetParent = hide ? null : {}; el.offsetHeight = hide ? 0 : 250; el.remove = () => {}; } }, createElement: () => { const el = { attrs: {}, style: {}, setAttribute: (k, v) => { el.attrs[k] = v; } }; return el; } };
  return w;
}
test('AdSense stub: inactive without a client id (fail-open); tag failure => bait check: blocked vs outage', async () => {
  const none = A.adapters.adsense(Object.assign({}, cfg, { adsense: { client: '' } }), fakeWin('ok')); await assert.rejects(none.init(), e => e.code !== 'blocked');
  const c = Object.assign({}, cfg, { adsense: { client: 'ca-pub-TEST', test: false } });
  await assert.rejects(A.adapters.adsense(c, fakeWin('error-hidden')).init(), { code: 'blocked' }, 'tag failed + bait hidden = blocker');
  await assert.rejects(A.adapters.adsense(c, fakeWin('stub-hidden')).init(), { code: 'blocked' }, 'empty stub script + bait hidden');
  await assert.rejects(A.adapters.adsense(c, fakeWin('error')).init(), { code: 'outage' }, 'tag failed + bait visible = outage (fail-open)');
  await assert.rejects(A.adapters.adsense(c, fakeWin('stub')).init(), { code: 'outage' });
  const w = fakeWin('ok'), ad = A.adapters.adsense(c, w); await ad.init();
  assert.equal(w.tag.attrs['data-ad-client'], 'ca-pub-TEST'); assert.equal(w.tag.attrs['data-adbreak-test'], 'on', 'test ads on staging'); assert.equal(w.pushed[0].preloadAdBreaks, 'on');
});
test('AdSense stub: grant only on adViewed; dismissed / notReady never grant', async () => {
  const c = Object.assign({}, cfg, { adsense: { client: 'ca-pub-TEST' } });
  const run = async (fire) => { const w = fakeWin('ok'); w.onBreak = (o) => setTimeout(() => fire(o), 0); const s = freshS();
    const ads = A.create({ adapter: A.adapters.adsense(c, w), cfg: Object.assign({}, c, { dismissGraceMs: 10 }), enabled: true, state: () => s.ads, rollDay: MS.rollDay });
    await ads.init(); let g = 0; const r = await ads.showRewarded('speed_boost', { reward: () => g++ }); return [r, g, w]; };
  let [r, g, w] = await run(o => { o.beforeReward(() => { o.adViewed(); o.adBreakDone({ breakStatus: 'viewed' }); }); });
  assert.equal(r.status, 'rewarded'); assert.equal(g, 1); assert.equal(w.pushed[1].name, 'speed_boost');
  [r, g] = await run(o => { o.beforeReward(() => o.adBreakDone({ breakStatus: 'dismissed' })); }); assert.equal(r.status, 'dismissed'); assert.equal(g, 0);
  [r, g] = await run(o => o.adBreakDone({ breakStatus: 'notReady' })); assert.equal(r.status, 'no_fill'); assert.equal(g, 0);
});

// ---------- web: EU consent (platform/consent.js, Google Privacy & messaging CMP) ----------
function cmpWin(o = {}) {
  return Object.assign({ DK_PLATFORM: 'web', ADS_ENABLED: true, DK_CFG: Object.assign({}, cfg, { webAdapter: 'adsense', adsense: { client: 'ca-pub-TEST' }, consentTimeoutSec: 0.05 }) }, o);
}
// simulate Google's CMP arriving: drain googlefc.callbackQueue, define __tcfapi, emit TCF events
function cmpLoad(w, events) {
  if (!w._q) { w._q = w.googlefc.callbackQueue; w.googlefc.callbackQueue = { push: (x) => { if (x.CONSENT_API_READY) x.CONSENT_API_READY(); } };
    w.__tcfapi = (cmd, v, cb) => { assert.equal(cmd, 'addEventListener'); assert.equal(v, 2.2); w._L = cb; };
    w.googlefc.showRevocationMessage = () => { w.revoked = (w.revoked || 0) + 1; };
    w._q.forEach(x => x.CONSENT_API_READY && x.CONSENT_API_READY()); }
  (events || []).forEach(e => w._L(e, true));
  if ((events || []).some(e => e.eventStatus === 'useractioncomplete' || e.eventStatus === 'tcloaded')) w._q.forEach(x => x.CONSENT_DATA_READY && x.CONSENT_DATA_READY());
}
test('consent: inert when ads are off, without a publisher id, and in the Capacitor app (UMP there)', async () => {
  for (const w of [cmpWin({ ADS_ENABLED: false }), cmpWin({ DK_CFG: Object.assign({}, cfg, { webAdapter: 'adsense', adsense: { client: '' } }) }), cmpWin({ DK_PLATFORM: 'android' }), { DK_CFG: cfg, DK_PLATFORM: 'web', ADS_ENABLED: false }]) {
    const c = CS.create(w); assert.equal(c.active, false); assert.equal(w.dataLayer, undefined, 'no consent defaults'); assert.equal(w.googlefc, undefined);
    assert.equal(c.row(), '', 'no Settings row'); assert.equal(c.revoke(), false); await assert.rejects(c.ready(), { code: 'off' });
  }
  assert.equal(C.DEFAULTS.consentTimeoutSec, 10);
});
test('consent: Consent Mode v2 defaults denied for EEA/UK/CH, set at script load (before the ad tag)', () => {
  const w = cmpWin(), c = CS.create(w); assert.equal(c.active, true);
  const d = [...w.dataLayer[0]]; assert.equal(d[0], 'consent'); assert.equal(d[1], 'default');
  for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) assert.equal(d[2][k], 'denied', k);
  for (const r of ['DE', 'FR', 'IE', 'NO', 'IS', 'LI', 'GB', 'CH']) assert.ok(d[2].region.includes(r), r);
  assert.equal(d[2].region.length, 32); assert.ok(Array.isArray(w.googlefc.callbackQueue) && w.googlefc.callbackQueue.length === 2);
});
test('consent: AdSense adapter configures/requests nothing until the CMP decides; declined still resolves (no-fill path)', async () => {
  const c0 = Object.assign({}, cfg, { adsense: { client: 'ca-pub-TEST' } });
  const w = fakeWin('ok'); Object.assign(w, cmpWin()); w.DKConsent = CS.create(w);
  let done = false; const p = A.adapters.adsense(c0, w).init().then(() => { done = true; });
  await new Promise(r => setTimeout(r, 20)); assert.equal(done, false, 'waits for consent'); assert.equal(w.pushed.length, 0, 'no adConfig/preload before consent');
  cmpLoad(w, [{ gdprApplies: true, eventStatus: 'cmpuishown' }]); await new Promise(r => setTimeout(r, 120)); assert.equal(done, false, 'message on screen: no timeout');
  assert.ok(w.DKConsent.canRevoke(), 'Privacy choices row once the CMP is up and GDPR applies'); assert.ok(/Privacy choices/.test(w.DKConsent.row()));
  // decline: TCF reports useractioncomplete with no purpose consents
  cmpLoad(w, [{ gdprApplies: true, eventStatus: 'useractioncomplete', purpose: { consents: {} } }]); await p;
  assert.equal(done, true); assert.equal(w.pushed[0].preloadAdBreaks, 'on', 'adConfig only after consent');
  w.DKConsent.revoke(); assert.equal(w.revoked, 1, 'showRevocationMessage via callbackQueue');
});
test('consent: GDPR not applicable resolves, no Privacy choices row; CMP never loads => outage (fail-open, not blocked)', async () => {
  const w = cmpWin(), c = CS.create(w); const p = c.ready(); cmpLoad(w, [{ gdprApplies: false, eventStatus: 'tcloaded' }]);
  assert.equal(await p, 'none'); assert.equal(c.canRevoke(), false); assert.equal(c.row(), '');
  const c0 = Object.assign({}, cfg, { adsense: { client: 'ca-pub-TEST' } });
  const w2 = fakeWin('ok'); Object.assign(w2, cmpWin()); w2.DKConsent = CS.create(w2);
  await assert.rejects(A.adapters.adsense(c0, w2).init(), { code: 'outage' }); assert.equal(w2.pushed.length, 0);
  const w3 = fakeWin('ok'); delete w3.DKConsent; await assert.rejects(A.adapters.adsense(c0, w3).init(), { code: 'outage' }, 'no consent module => never request');
  const w4 = fakeWin('ok'); Object.assign(w4, cmpWin()); w4.DKConsent = CS.create(w4);
  const s = freshS(); let failed = null; const ads = A.create({ adapter: A.adapters.adsense(c0, w4), cfg: c0, enabled: true, state: () => s.ads, rollDay: MS.rollDay, onInitFail: e => { failed = e; } });
  await ads.init(); assert.equal(failed.code, 'outage'); assert.equal(ads.healthy(), false, 'unhealthy => gated() false => everything free');
});

test('verification tag: adapter reuses the literal adsbygoogle.js tag (never a second copy); consent row follows the tag with ads OFF', async () => {
  const c0 = Object.assign({}, cfg, { adsense: { client: 'ca-pub-TEST' } });
  const mkTagWin = (loadedBefore) => { const w = fakeWin('ok'); Object.assign(w, cmpWin()); const L = {}; let appended = 0;
    const tag = { addEventListener: (e, f) => { L[e] = f; } }; w.tagL = L;
    w.document.querySelector = (q) => /adsbygoogle\.js/.test(q) ? tag : null; w.document.head.appendChild = () => { appended++; }; w.appended = () => appended;
    if (loadedBefore) w.adsbygoogle = { loaded: true, push: (o) => w.pushed.push(o) };
    w.DKConsent = CS.create(w); return w; };
  let w = mkTagWin(true); assert.equal(w.DKConsent.cmp, true); const p = A.adapters.adsense(c0, w).init(); cmpLoad(w, [{ gdprApplies: true, eventStatus: 'tcloaded' }]); await p;
  assert.equal(w.appended(), 0, 'no second adsbygoogle.js'); assert.equal(w.pushed[0].preloadAdBreaks, 'on');
  w = mkTagWin(false); const p2 = A.adapters.adsense(c0, w).init(); w.adsbygoogle = { loaded: true, push: (o) => w.pushed.push(o) }; w.tagL.load(); cmpLoad(w, [{ gdprApplies: false, eventStatus: 'tcloaded' }]); await p2;
  assert.equal(w.appended(), 0); assert.equal(w.pushed.length, 1, 'adConfig after load event + consent');
  w = mkTagWin(false); const p3 = A.adapters.adsense(c0, w).init(); w.tagL.error(); await assert.rejects(p3, { code: 'outage' }, 'tag error + bait visible = outage');
  // ads OFF but tag present (verification): no gating, but consent listening + Privacy choices row work; defaults only once
  const wo = cmpWin({ ADS_ENABLED: false, DK_CONSENT_DEFAULTS: 1, dataLayer: [['consent', 'default', {}]] }); wo.document = { querySelector: (q) => /adsbygoogle\.js/.test(q) ? {} : null };
  const co = CS.create(wo); assert.equal(co.active, false); assert.equal(co.cmp, true); assert.equal(wo.dataLayer.length, 1, 'inline snippet defaults not duplicated');
  await assert.rejects(co.ready(), { code: 'off' }); assert.equal(co.row(), ''); cmpLoad(wo, [{ gdprApplies: true, eventStatus: 'tcloaded' }]);
  assert.ok(/Privacy choices/.test(co.row())); co.revoke(); assert.equal(wo.revoked, 1);
});

// ---------- entitlements ----------
test('entitlements: inert without key or on web; RC is truth; cache only on the same device', async () => {
  const s = freshS(); const mk = (o) => E.create(Object.assign({ platform: 'ios', keys: { ios: 'appl_test' }, state: () => s.ent, device: () => 'devA' }, o));
  const inert = mk({ keys: {} }); assert.equal(await inert.init(), false); assert.equal(inert.has('adFree'), false); assert.equal((await inert.purchase('x')).status, 'unavailable');
  assert.equal(mk({ platform: 'web', keys: { web: 'k' } }).inert(), true);
  let active = { lightBar: {} }; const plug = { configure: async () => {}, addCustomerInfoUpdateListener: () => {}, getCustomerInfo: async () => ({ customerInfo: { entitlements: { active } } }), restorePurchases: async () => ({ customerInfo: { entitlements: { active: { adFree: {} } } } }) };
  const e1 = mk({ plugin: plug }); await e1.init(); assert.equal(e1.has('lightBar'), true); assert.equal(e1.has('adFree'), false); assert.equal(s.ent.lightBar, true); assert.equal(s.ent.dev, 'devA');
  const off = mk({ plugin: Object.assign({}, plug, { getCustomerInfo: async () => { throw new Error('offline'); } }) }); await off.init(); assert.equal(off.has('lightBar'), true, 'offline launch uses cache');
  const other = mk({ device: () => 'devB', plugin: Object.assign({}, plug, { getCustomerInfo: async () => { throw new Error('offline'); } }) }); await other.init(); assert.equal(other.has('lightBar'), false, 'fresh install: cache not trusted');
  active = {}; const e2 = mk({ plugin: plug }); await e2.init(); assert.equal(e2.has('lightBar'), false, 'RC overwrites cache'); assert.equal(s.ent.lightBar, false);
  await e2.restore(); assert.equal(e2.has('adFree'), true);
});

(async () => { for (const [name, fn] of T) { try { await fn(); console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n', e); process.exitCode = 1; } }
  console.log(`ads-unit: ${T.length} tests, ${process.exitCode ? 'FAILURES' : 'all passed'}`); })();

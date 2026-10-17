// Unit tests for platform/ads: boost tank, light unlocks, save migration, day rollover, reward de-dupe, fail-open,
// no-fill/pity, entitlements cache. "QA n" = ad-unlock-spec.md §11 case n.
const assert = require('assert'), P = require('path').join(__dirname, '..');
const C = require(P + '/dk-config.js'), B = require(P + '/boost.js'), LT = require(P + '/lights.js'), MS = require(P + '/mon-state.js'), A = require(P + '/ads.js'), E = require(P + '/entitlements.js');
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
  assert.equal(C.build({ DK_REMOTE: { adsEnabled: true, webAdsEnabled: true } }).adsEnabled, true);
});
test('QA4 remote: cached copy used, bad values rejected, defaults without cache', () => {
  const ls = { getItem: () => JSON.stringify({ boostTankMax: 120, boostAdsPerDay: -3, minAdGapSec: 'x', caps: { oos_lawyer: 2 }, evil: 1 }) };
  const c = C.build({ localStorage: ls }).cfg;
  assert.equal(c.boostTankMax, 120); assert.equal(c.boostAdsPerDay, 6); assert.equal(c.minAdGapSec, 20); assert.equal(c.caps.oos_lawyer, 2); assert.equal(c.evil, undefined);
  assert.equal(C.build({ localStorage: { getItem: () => null } }).cfg.adsEnabled, false);
  assert.equal(C.build({ localStorage: { getItem: () => '{bad json' } }).cfg.boostTankMax, 90);
});

// ---------- migration ----------
test('save migration: backward-compatible defaults, existing values kept', () => {
  const s = freshS(); assert.deepEqual(s.boost, { bank: 0, tier: 5 }); assert.deepEqual(s.ckOwn, ['amber']); assert.deepEqual(s.ckProg, {});
  assert.equal(s.ads.v, 1); assert.equal(s.ads.cnt.speed_boost, 0); assert.deepEqual(s.ads.nonces, []);
  assert.deepEqual(s.ent, { adFree: false, noForced: false, lightBar: false, ts: 0, dev: '' }); assert.deepEqual(s.gate, { since: 0, fuel: 0, ck: 0 });
  const k = MS.migrate({ boost: { bank: 99999, tier: 10 }, ckOwn: ['red'], ckProg: { chase: 2 }, ads: { cnt: { speed_boost: 4 }, nonces: Array(30).fill('x') }, gate: { since: 5, fuel: 1, ck: 1 } }, { cfg });
  assert.equal(k.boost.bank, 5400, 'clamped to tank max'); assert.equal(k.boost.tier, 10); assert.deepEqual(k.ckOwn, ['red']); assert.equal(k.ckProg.chase, 2);
  assert.equal(k.ads.cnt.speed_boost, 4); assert.equal(k.ads.nonces.length, 20); assert.deepEqual(k.gate, { since: 5, fuel: 1, ck: 1 });
  assert.equal(MS.migrate({}, { cfg, isNew: true, adsEnabled: true }).gate.fresh, 1);
  assert.equal(MS.migrate({}, { cfg, isNew: true, adsEnabled: false }).gate.fresh, undefined);
});

// ---------- speed tank ----------
test('QA5 canSpd: 1x always; 5x/10x need bank when gated; free when not gated; adFree', () => {
  assert.ok(B.canSpd(1, { gated: true, bank: 0 })); assert.ok(!B.canSpd(5, { gated: true, bank: 0 })); assert.ok(!B.canSpd(10, { gated: true, bank: 0 }));
  assert.ok(B.canSpd(10, { gated: false, bank: 0 })); assert.ok(B.canSpd(10, { gated: true, bank: 1 })); assert.ok(B.canSpd(10, { gated: true, bank: 0, adFree: true }));
  const s = freshS(); B.add(s.boost, cfg); assert.equal(s.boost.bank, 1800);
});
test('QA6/7/26 drain: 1/s at 5x, 2/s at 10x, 0 at 1x, 0 hidden, 0 during ad, 0 ungated, dt clamped', () => {
  const b = { bank: 1000 }, c = (o) => Object.assign({ gated: true, spd: 5, hidden: false, adPlaying: false }, o);
  B.drain(b, 0.5, c(), cfg); assert.equal(b.bank, 999.5);
  B.drain(b, 0.5, c({ spd: 10 }), cfg); assert.equal(b.bank, 998.5);
  B.drain(b, 0.5, c({ spd: 1 }), cfg); B.drain(b, 0.5, c({ hidden: true, spd: 10 }), cfg); B.drain(b, 0.5, c({ adPlaying: true, spd: 10 }), cfg); B.drain(b, 0.5, c({ gated: false, spd: 10 }), cfg);
  assert.equal(b.bank, 998.5);
  B.drain(b, 600, c({ spd: 10 }), cfg); assert.equal(b.bank, 997.5, 'a 10-minute background gap only burns the 0.5 s clamp');
  const e = { bank: 0.3 }; B.drain(e, 0.5, c({ spd: 10 }), cfg); assert.equal(e.bank, 0);
});
test('QA10 tank max 90 and 6/day: Watch hidden when bank+30>90, 7th capped', () => {
  const s = freshS(); for (let i = 0; i < 3; i++) { assert.ok(B.canAdd(s.boost, s.ads, cfg).ok); B.add(s.boost, cfg); }
  assert.equal(s.boost.bank, 5400); assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'full');
  s.boost.bank = 3601; assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'full'); s.boost.bank = 3600; assert.ok(B.canAdd(s.boost, s.ads, cfg).ok);
  s.boost.bank = 0; s.ads.cnt.speed_boost = 6; assert.equal(B.canAdd(s.boost, s.ads, cfg).reason, 'capped');
});
test('QA13 first gated launch: one 30-min tank for a pre-gating save, exactly once; none for a fresh gated save', () => {
  const s = freshS({ spd: 10 }); let r = B.firstGate(s, cfg, 1); assert.equal(r.fuel, 1800); assert.equal(s.boost.bank, 1800);
  s.gate.since = 0; r = B.firstGate(s, cfg, 2); assert.equal(r.fuel, 0); assert.equal(s.boost.bank, 1800, 'relaunch: no second grant');
  const f = freshS({ _new: 1, _on: 1 }); B.firstGate(f, cfg, 1); assert.equal(f.boost.bank, 0);
});
test('label "24:10 @5x"', () => { assert.equal(B.label(1450, 5, cfg), '24:10 @5x'); assert.equal(B.label(1450, 10, cfg), '12:05 @10x'); assert.equal(B.label(1450, 1, cfg), '24:10 @5x'); });

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
test('QA18/19 grandfather: equipped non-amber color only, once; amber grants nothing', () => {
  const s = freshS({ chicken: 'purple' }); assert.equal(LT.grandfather(s), 'purple'); assert.deepEqual(s.ckOwn, ['amber', 'purple']);
  s.chicken = 'chase'; assert.equal(LT.grandfather(s), null, 'runs once'); assert.deepEqual(s.ckOwn, ['amber', 'purple']);
  const a = freshS({ chicken: 'amber' }); assert.equal(LT.grandfather(a), null); assert.deepEqual(a.ckOwn, ['amber']);
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
  r.s.ads.cnt.speed_boost = 6; assert.equal(r.ads.canShow('speed_boost').reason, 'capped'); assert.equal((await r.ads.showRewarded('speed_boost')).status, 'capped');
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
  const r = rig('reward'); let g = 0; for (let i = 0; i < 6; i++) assert.equal(r.ads.grantFree('speed_boost', { reward: () => g++ }).granted, true);
  assert.equal(r.ads.grantFree('speed_boost', { reward: () => g++ }).status, 'capped'); assert.equal(g, 6); assert.ok(r.ev.some(e => e[0] === 'ad_reward_granted' && e[1].via === 'free_ent'));
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

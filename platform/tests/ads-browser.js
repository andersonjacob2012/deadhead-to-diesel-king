// Headless check for platform/ads wiring. usage: node ads-browser.js <dir> <port> [baselineDir]
//  A) flag OFF (default config): behaves like the baseline build — free 5x/10x, every color selectable, no ad calls,
//     no ad UI; same signals as the baseline index.html when baselineDir is given.
//  B) flag ON with the web mock adapter: fresh save locked -> watch -> tank -> drain 2/s at 10x -> empty drops to 1x;
//     chicken unlock via ad; game paused during the ad; pre-gating save gets one tank + its equipped color; init failure
//     => fail-open.
const { chromium } = require('playwright'), { spawn } = require('child_process'), assert = require('assert');
const path = require('path'), [dir0, port, base0] = process.argv.slice(2), dir = path.resolve(dir0), base = base0 && path.resolve(base0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(b, root, init, seed) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errs.push('console: ' + m.text()) });
  await p.route(/basemaps|\/tile\//i, r => r.abort());   // no third-party tiles since main moved to the self-hosted /map/ basemap
  if (init) await p.addInitScript(init);
  if (seed) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); localStorage.setItem('idletruck', s) } }, seed);
  await p.goto(`http://127.0.0.1:${port}/${root}index.html`, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  if (!seed) await p.click('.tgo'); else await p.click('.tgo').catch(() => {});
  await p.waitForTimeout(800); return { p, errs, ctx };
}
async function offSignals(b, root) {
  const { p, errs, ctx } = await page(b, root);
  const r = await p.evaluate(async () => {
    const out = {}; const w = ms => new Promise(z => setTimeout(z, ms));
    document.querySelector('#spd button[data-s="10"]').click(); out.spd10 = S.spd; await w(300);
    document.querySelector('#spd button[data-s="5"]').click(); out.spd5 = S.spd;
    document.querySelector('#spd button[data-s="1"]').click(); out.spd1 = S.spd;
    out.ckAll = (typeof CKP !== 'undefined' ? CKP : []).map(x => x.id).join();
    out.ckOkAll = CKP.every(x => ckOk(x.id)); setChicken('chase'); out.chicken = S.chicken; setChicken('amber');
    openShowroom(); await w(300); out.disabledOpts = document.querySelectorAll('.dk-sr__lock').length; out.lockedLabels = document.querySelectorAll('.dk-sr .is-locked').length > 0; closeShowroom(); /* main moved the chicken picker from Settings into the Showroom */
    out.locks = document.querySelectorAll('#spd .dk-lock').length; out.fuelUi = !!document.getElementById('dkfuel'); out.sheet = !!document.getElementById('dksheet');
    out.started = !!S.started; out.trucks = S.trucks.length;
    out.adsState = window.Ads ? Ads.state() : 'none'; out.events = (window.DK_EVENTS || []).length; out.ADS_ENABLED = window.ADS_ENABLED;
    const t0 = S.clock; await w(1500); out.clockRuns = S.clock !== t0;
    return out;
  });
  r.errors = errs; await ctx.close(); return r;
}
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', port, '-d', '/'], { stdio: 'ignore' }); await sleep(800);
  const b = await chromium.launch(); const res = { ok: true, checks: [] };
  const check = (name, cond, info) => { res.checks.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || info === undefined ? '' : ' :: ' + JSON.stringify(info))); if (!cond) res.ok = false; };
  const R = d => d.replace(/^\//, '') + '/';
  try {
    // ---------- A) flag OFF ----------
    const off = await offSignals(b, R(dir));
    check('OFF: ADS_ENABLED false, Ads never initialized, no ad events', off.ADS_ENABLED === false && off.adsState === 'idle' && off.events === 0, off);
    check('OFF: 5x/10x free (QA1)', off.spd10 === 10 && off.spd5 === 5 && off.spd1 === 1, off);
    check('OFF: every color selectable, none locked', off.ckOkAll && off.chicken === 'chase' && off.disabledOpts === 0 && !off.lockedLabels, off);
    check('OFF: no ad UI', off.locks === 0 && !off.fuelUi && !off.sheet, off);
    check('OFF: no page errors', off.errors.length === 0, off.errors);
    if (base) {
      const bl = await offSignals(b, R(base));
      const keys = ['spd10', 'spd5', 'spd1', 'ckAll', 'ckOkAll', 'chicken', 'disabledOpts', 'lockedLabels', 'started', 'trucks', 'clockRuns'];
      const diff = keys.filter(k => JSON.stringify(bl[k]) !== JSON.stringify(off[k]));
      check('OFF: identical to baseline build on ' + keys.length + ' behaviour signals', diff.length === 0, { diff, base: bl, ours: off });
    }
    // ---------- B) flag ON, mock adapter ----------
    const ON = a => `window.DK_REMOTE={adsEnabled:true,webAdsEnabled:true,webAdHost:location.hostname};window.DK_ADS_ADAPTER='mock:${a}';`;
    {
      const { p, errs, ctx } = await page(b, R(dir), ON('reward'));
      const r = await p.evaluate(async () => {
        const w = ms => new Promise(z => setTimeout(z, ms)), o = {};
        for (let i = 0; i < 20 && !DKMon.gated(); i++) await w(100);
        o.gated = DKMon.gated(); o.fresh = S.gate.fresh; o.bank0 = S.boost.bank; await w(700);
        o.lock10 = document.querySelector('#spd button[data-s="10"]').classList.contains('dk-lock'); o.fuelTxt = (document.getElementById('dkfuel') || {}).textContent;
        document.querySelector('#spd button[data-s="10"]').click(); o.spdAfterLockedTap = S.spd; o.sheet = !!document.getElementById('dksheet');
        o.ckOkRed = ckOk('red'); o.ckOkAmber = ckOk('amber');
        const clk = S.clock; document.querySelector('#dksheet button[data-k="watch"]').click(); await w(150);
        o.pausedDuringAd = DKMon.adPlaying; await w(100); o.clockFrozen = S.clock === clk;
        for (let i = 0; i < 30 && document.getElementById('dksheet'); i++) await w(100);
        o.bankAfterAd = S.boost.bank; o.spdAfterAd = S.spd; o.adCount = S.ads.cnt.speed_boost; o.nonces = S.ads.nonces.length;
        o.saved = JSON.parse(localStorage.getItem('idletruck')).boost.bank > 0;
        const b1 = S.boost.bank; await w(2000); o.burned2s = +(b1 - S.boost.bank).toFixed(2);
        S.boost.bank = 0.4; await w(1500); o.spdAfterEmpty = S.spd; o.toast = document.getElementById('toast').textContent;
        // chicken unlock (reset minAdGap for the test)
        S.ads.lastAdTs = 0; setChicken('red'); o.ckSheet = !!document.getElementById('dksheet'); o.previewChicken = S.chicken;
        document.querySelector('#dksheet button[data-k="watch"]').click(); for (let i = 0; i < 30 && document.getElementById('dksheet'); i++) await w(100);
        o.redOwned = S.ckOwn.includes('red'); o.chicken = S.chicken;
        S.ads.lastAdTs = 0; setChicken('purple'); document.querySelector('#dksheet button[data-k="watch"]').click(); for (let i = 0; i < 30 && document.querySelector('#dksheet button[disabled]'); i++) await w(100); await w(200);
        o.purpleProg = S.ckProg.purple; o.purpleOwned = S.ckOwn.includes('purple'); const sh = document.getElementById('dksheet'); sh && sh._close(); o.chickenAfterClose = S.chicken;
        o.pickerTag = 'Purple' + DKMon.ckTag('purple'); o.srGated = !CK_ALL_FREE;
        o.okKey = localStorage.getItem('dk.ads.ok');
        // live medal fuel: 100K miles (16) + 10K miles (8) pay once on the next 5 s tick, above the 24-min ad max is fine
        S.spd = 1; const mb = S.boost.bank; S.lt = S.lt || {}; S.lt.miL = (S.lt.miL || 0) + 2e5; await w(6000);
        o.medalGain = Math.round(S.boost.bank - mb); o.medalPaid = S.boost.medalPaid.join(); o.medalAdCount = S.ads.cnt.speed_boost;
        await w(5500); o.medalGain2 = Math.round(S.boost.bank - mb);
        o.events = [...new Set(DK_EVENTS.map(e => e.ev))].sort().join();
        return o;
      });
      check('ON: gated after mock init; fresh save gets no free tank (QA5)', r.gated && r.fresh === 1 && r.bank0 === 0, r);
      check('ON: 10x locked with badge, tap opens Fuel-up sheet, speed stays 1x', r.lock10 && r.sheet && r.spdAfterLockedTap === 1 && /refuel/.test(r.fuelTxt || ''), r);
      check('ON: only amber owned on a fresh gated save (QA16)', !r.ckOkRed && r.ckOkAmber, r);
      check('ON: game paused during the ad (QA26)', r.pausedDuringAd && r.clockFrozen, r);
      check('ON: completed ad => bank 480 s (8 min @5x / 5 min @10x), switches to 10x, counted once, saved (QA5)', r.bankAfterAd > 475 && r.bankAfterAd <= 480 && r.spdAfterAd === 10 && r.adCount === 1 && r.nonces === 1 && r.saved, r);
      check('ON: 10x burns ~1.6 s per real s (QA6)', r.burned2s >= 2.4 && r.burned2s <= 3.7, r);
      check('ON: live medal fuel +24 min once, not counted as an ad (QA13)', r.medalGain === 1440 && r.medalGain2 === 1440 && /miles-10k/.test(r.medalPaid) && /miles-100k/.test(r.medalPaid) && r.medalAdCount === 1, r);
      check('ON: SDK-ok flag on the live key dk.ads.ok', r.okKey === '1', r);
      check('ON: empty tank drops to 1x with toast (QA8)', r.spdAfterEmpty === 1 && /tank empty/i.test(r.toast), r);
      check('ON: red unlock after 1 ad, equipped (QA16)', r.ckSheet && r.redOwned && r.chicken === 'red', r);
      check('ON: purple 1/2 progress, preview reverts on close', r.purpleProg === 1 && !r.purpleOwned && r.chickenAfterClose === 'red' && /Purple 🔒 📺 1\/2/.test(r.pickerTag) && r.srGated, r);
      check('ON: analytics events fired', ['ad_offer_shown', 'ad_request', 'ad_result', 'ad_reward_granted', 'boost_empty', 'ck_progress', 'ck_unlock', 'medal_fuel_grant'].every(e => r.events.includes(e)), r.events);
      check('ON: no page errors', errs.length === 0, errs); await ctx.close();
    }
    {
      // pre-gating save: created with flag OFF at 10x with purple equipped and the 10K-miles badge met
      const { p, ctx } = await page(b, R(dir)); await p.evaluate(() => { setSpd(10); setChicken('purple'); S.lt = S.lt || {}; S.lt.miL = 2e4; save(); });
      const seed = await p.evaluate(() => localStorage.getItem('idletruck')); await ctx.close();
      const g = await page(b, R(dir), ON('reward'), seed);
      const r = await g.p.evaluate(async () => { const w = ms => new Promise(z => setTimeout(z, ms)); for (let i = 0; i < 20 && !S.gate.since; i++) await w(100); await w(300);
        return { since: !!S.gate.since, retro: S.gate.retro, paid: S.boost.medalPaid.join(), bank: S.boost.bank, spd: S.spd, own: S.ckOwn.join(), chicken: ckCur(), redOk: ckOk('red'), toast: document.getElementById('toast').textContent }; });
      check('ON: pre-gating save at 10x with a fuelled badge gets one 16-min retro grant, keeps 10x (QA13)', r.since && r.retro === 1 && /miles-10k/.test(r.paid) && r.bank > 950 && r.bank <= 960 && r.spd === 10 && /past badges/.test(r.toast), r);
      check('ON: keeps only the equipped color (QA18)', r.own === 'amber,purple' && r.chicken === 'purple' && !r.redOk, r);
      await g.p.reload({ waitUntil: 'load' }); await g.p.waitForTimeout(1500);
      const r2 = await g.p.evaluate(() => ({ bank: S.boost.bank, retro: S.gate.retro }));
      check('ON: relaunch does not grant a second time (QA13)', r2.bank <= r.bank && r2.retro === 1, r2); await g.ctx.close();
    }
    {
      // web ad blocker: boost + colors stay LOCKED with a friendly notice (not fail-open); no video is requested
      const { p, errs, ctx } = await page(b, R(dir), ON('blocked'));
      const r = await p.evaluate(async () => { const w = ms => new Promise(z => setTimeout(z, ms)); await w(900); const o = {};
        o.gated = DKMon.gated(); o.blocked = DKMon.blocked; o.toast = document.getElementById('toast').textContent; o.ckRed = ckOk('red');
        document.querySelector('#spd button[data-s="10"]').click(); o.spd = S.spd; const sh = document.getElementById('dksheet'); o.sheetNotice = !!sh && /ad blocker/i.test(sh.textContent);
        sh.querySelector('button[data-k="watch"]').click(); await w(300); o.watchToast = document.getElementById('toast').textContent; o.shows = DK_EVENTS.filter(e => e.ev === 'ad_request').length; sh._close();
        setChicken('red'); o.ckSheet = /ad blocker/i.test((document.getElementById('dksheet') || {}).textContent || ''); document.getElementById('dksheet')._close(); o.chicken = ckCur();
        o.okKey = localStorage.getItem('dk.ads.ok'); return o; });
      check('ON + ad blocker: locked, not fail-open; friendly notice in toast + sheets; no ad request', r.gated && r.blocked && !r.ckRed && r.spd === 1 && /ad blocker/i.test(r.toast) && r.sheetNotice && /ad blocker/i.test(r.watchToast) && r.shows === 0 && r.ckSheet && r.chicken === 'amber' && r.okKey === null, r);
      check('ON + ad blocker: no page errors', errs.length === 0, errs); await ctx.close();
    }
    {
      const { p, errs, ctx } = await page(b, R(dir), ON('initfail'));
      const r = await p.evaluate(async () => { await new Promise(z => setTimeout(z, 800)); document.querySelector('#spd button[data-s="10"]').click();
        return { gated: DKMon.gated(), spd: S.spd, ckRed: ckOk('red'), fuel: !!(document.getElementById('dkfuel') && document.getElementById('dkfuel').style.display !== 'none'), locks: document.querySelectorAll('#spd .dk-lock').length, unhealthy: DK_EVENTS.some(e => e.ev === 'ads_unhealthy') }; });
      check('ON + SDK init failure: fail-open, everything free, no ad UI, ads_unhealthy logged (QA3)', !r.gated && r.spd === 10 && r.ckRed && !r.fuel && r.locks === 0 && r.unhealthy, r);
      check('ON + init failure: no page errors', errs.length === 0, errs); await ctx.close();
    }
  } catch (e) { res.ok = false; res.checks.push('FAIL exception: ' + e.stack); }
  console.log(res.checks.join('\n')); console.log('ads-browser: ' + (res.ok ? 'all passed' : 'FAILURES'));
  await b.close(); srv.kill(); process.exit(res.ok ? 0 : 1);
})();

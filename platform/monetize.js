/* DKMon — glue between the game (index.html) and the platform/ads modules. Load after dk-config, ads, entitlements,
 * boost, lights, mon-state and BEFORE the game <script>. Everything is inert while ADS_ENABLED is false:
 * gated() is false, spd(m) returns m, frame() returns false after one boolean check, no SDK is touched.
 *
 * index.html hooks (the only game call sites — see platform/ADS_WIRING.md):
 *   DKMon.migrate(S, isNew)   in load(), right after newState()
 *   DKMon.ckFree()            CK_ALL_FREE()  -> !gated()
 *   DKMon.ckEnt()             adFree || lightBar, OR-ed into ckOk
 *   DKMon.ckOffer(id)         setChicken(id) on a locked color
 *   DKMon.ckAttr(id)/ckTag(id) settings chicken picker <option> attrs/label for locked colors
 *   DKMon.spd(m)              first statement of setSpd(m): returns the speed actually allowed
 *   DKMon.frame(dt)           first statement of loop(now): drains the tank; true => an ad is playing, skip the frame
 */
(function (w) {
  'use strict';
  var cfg = w.DK_CFG, PLAT = w.DK_PLATFORM, ON = !!w.ADS_ENABLED, B = w.DKBoost, LT = w.DKLights, MS = w.DKMonState;
  var OKKEY = 'dk.ads.ok', EV = w.DK_EVENTS = w.DK_EVENTS || [];
  // Game globals by name, including top-level let/const (S, AC, save…), which are not on window. Compiled once per name.
  var GET = {};
  function g(n) { var f = GET[n] || (GET[n] = new Function('return typeof ' + n + '!=="undefined"?' + n + ':undefined')); try { return f(); } catch (e) { return undefined; } }
  function S() { return g('S'); }
  function lsGet(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v == null ? w.localStorage.removeItem(k) : w.localStorage.setItem(k, v); } catch (e) {} }
  function devId() { try { return w.DKSave.status().device || ''; } catch (e) { return ''; } }
  function dayNow() { var f = g('dayNum'); if (typeof f === 'function') return f(); var d = new Date(); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5); }
  function toast(m, ms) { var f = g('toast'); if (typeof f === 'function') f(m, ms || 3500); }
  function save() { var f = g('save'); if (typeof f === 'function') f(); }

  function track(ev, p) {
    var s = S() || {}, o = { ev: ev, platform: PLAT, app_ver: w.DK_APP_VER || '0', gated: M.gated(), ent_adFree: M.ent('adFree'), ent_noForced: M.ent('noForced') };
    try { var lv = g('level'); if (typeof lv === 'function') o.level = lv(); } catch (e) {}
    for (var k in p) o[k] = p[k];
    EV.push(o); if (EV.length > 200) EV.splice(0, EV.length - 200);
    if (typeof w.DK_ANALYTICS === 'function') { try { w.DK_ANALYTICS(ev, o); } catch (e) {} }
  }

  function pickAdapter() {
    if (!ON) return null;
    var a = w.DK_ADS_ADAPTER;   // tests / web QA can inject an adapter (or 'mock:<script>')
    if (a && typeof a === 'object') return a;
    if (typeof a === 'string' && a.indexOf('mock') === 0) return w.DKAds.adapters.mock(a.split(':')[1] || 'reward', { delay: 300 });
    if (PLAT !== 'web') return w.DKAds.adapters.admob(cfg, PLAT, w);
    return w.DKAds.adapters.none();   // web rewarded provider not built yet => init fails => fail-open
  }

  var M = { adPlaying: false, previewing: false, booted: false };
  var ads = w.DKAds.create({
    adapter: pickAdapter(), cfg: cfg, enabled: ON, lastInitOk: lsGet(OKKEY) === '1',
    state: function () { return S().ads; }, save: save, day: dayNow, rollDay: MS.rollDay, track: track,
    pause: function () { M.adPlaying = true; var A = g('AC'); try { A && A.state === 'running' && A.suspend(); } catch (e) {} },
    resume: function () { M.adPlaying = false; var A = g('AC'), s = S(); try { A && A.state === 'suspended' && !(s && s.mute) && A.resume(); } catch (e) {} },
    onInitOk: function () { lsSet(OKKEY, '1'); }, onInitFail: function () { lsSet(OKKEY, null); }
  });
  var ent = w.DKEnt.create({ platform: PLAT, keys: cfg.revenuecat, state: function () { return S().ent; }, device: devId, save: save, track: track });
  M.ads = ads; M.entitlements = ent; w.Ads = ads;

  M.gated = function () { return ON && ads.healthy(); };          // GATED(): fail-open when unhealthy
  M.ent = function (id) { return ON && ent.has(id); };
  M.migrate = function (s, isNew) { return MS.migrate(s, { isNew: isNew, adsEnabled: ON, cfg: cfg }); };

  // ---------- chicken lights ----------
  M.ckFree = function () { return !M.gated() || M.previewing; };
  M.ckEnt = function () { return M.ent('adFree') || M.ent('lightBar'); };
  function pal(id) { return LT.find(g('CKP') || [], id); }
  function nm(id) { return id ? id[0].toUpperCase() + id.slice(1) : ''; }
  M.ckAttr = function () { return M.gated() ? '' : 'disabled'; };
  M.ckTag = function (id) { var p = pal(id); if (!p || !M.gated()) return ' (locked)'; var pr = LT.progress(S(), p, cfg); return ' 🔒 📺 ' + pr.have + '/' + pr.need; };
  M.ckOffer = function (id) {
    var p = pal(id), s = S(); if (!p || !M.gated()) return;
    var prev = s.chicken, pr = LT.progress(s, p, cfg);
    M.previewing = true; s.chicken = id; ck();   // live preview on the rigs
    track('ad_offer_shown', { placement: 'chicken_unlock', color: id, daily_count: s.ads.cnt.chicken_unlock || 0 });
    sheet('🔒 ' + nm(id) + ' chicken lights', '<div class="sm">Preview on your rigs. Watch ' + pr.need + ' video' + (pr.need > 1 ? 's' : '') + ' to keep it forever · 📺 ' + pr.have + '/' + pr.need + '</div>',
      [{ t: '📺 Watch ad (' + (pr.have + 1) + ' of ' + pr.need + ')', k: 'watch' }, { t: 'Get all colors: $2.99', k: 'buy', alt: 1 }, { t: 'Not now', k: 'no', alt: 1 }],
      function (k, close, btn) {
        if (k === 'no') return close();
        if (k === 'buy') return ent.purchase('lightBar').then(function (r) { if (r.status === 'ok') { close(); toast('🎉 Every chicken light color unlocked'); } else toast(r.status === 'cancelled' ? 'Purchase cancelled' : '🛒 Store not available yet'); });
        busy(btn, true);
        watch('chicken_unlock', function () {
          var r = LT.applyAd(S(), p, cfg); track('ck_progress', { color: id, step: r.have, cost: r.need });
          if (r.unlocked) { track('ck_unlock', { color: id, step: r.have, cost: r.need }); prev = id; }
        }).then(function (res) {
          busy(btn, false);
          if (res && res.granted) { close(); if (prev === id) { var sc = g('setChicken'); sc && sc(id); track('ck_equip', { color: id }); toast('🎉 ' + nm(id) + ' chicken lights unlocked!', 4000); } else { var q = LT.progress(S(), p, cfg); toast('📺 ' + nm(id) + ': ' + q.have + '/' + q.need); } }
        });
      }, function () { var s2 = S(); M.previewing = false; s2.chicken = prev; ck(); var sel = document.querySelector('[aria-label="Chicken lights"]'); var cc = g('ckCur'); if (sel && cc) sel.value = cc(); });
  };
  function ck() { var f = g('ckApply'); try { f && f(); } catch (e) {} }

  // ---------- speed ----------
  function canSpd(m) { var s = S(); return B.canSpd(m, { gated: M.gated(), bank: s && s.boost ? s.boost.bank : 0, adFree: M.ent('adFree') }); }
  M.canSpd = canSpd;
  M.spd = function (m) {
    m = +m || 1; if (!ON || canSpd(m)) return m;
    var cur = S().spd || 1;
    if (!M.booted || m === cur) return 1;   // boot/restore clamp: if(GATED()&&!canSpd(S.spd))S.spd=1
    M.fuelUp(m); return cur;
  };
  M.fuelUp = function (m) {
    var s = S(), c = B.canAdd(s.boost, s.ads, cfg), af = M.ent('adFree');
    track('ad_offer_shown', { placement: 'speed_boost', daily_count: s.ads.cnt.speed_boost || 0, bank_s: Math.round(s.boost.bank) });
    var btns = [];
    if (c.ok) btns.push({ t: af ? '⛽ Refuel (Ad-Free)' : '📺 Watch → +' + cfg.boostMinPerAd + ' min at 5x / ' + Math.round(cfg.boostMinPerAd / ((cfg.burn && cfg.burn[10]) || 2)) + ' min at 10x', k: 'watch' });
    else btns.push({ t: c.reason === 'capped' ? '⏳ Back at midnight' : '⛽ Tank is full', k: 'x', dis: 1 });
    btns.push({ t: 'No thanks', k: 'no', alt: 1 });
    sheet('⛽ Fuel up for ' + m + 'x', '<div class="sm">Tank: ' + B.label(s.boost.bank, m, cfg) + ' · max ' + cfg.boostTankMax + ' min · ' + (s.ads.cnt.speed_boost || 0) + '/' + B.dailyCap(cfg) + ' today</div><div class="sm">Faster cash, slower XP.</div>' + (af ? '' : '<div class="sm">Ad-Free Dispatch auto-refuels.</div>'), btns,
      function (k, close, btn) {
        if (k !== 'watch') return k === 'no' && close();
        busy(btn, true);
        watch('speed_boost', function () { B.add(S().boost, cfg); S().boost.tier = m; }).then(function (r) {
          busy(btn, false);
          if (r && r.granted) { close(); var f = g('setSpd'); f && f(m); toast('⛽ +' + cfg.boostMinPerAd + ' boost-min · ' + B.label(S().boost.bank, m, cfg)); }
        });
      });
  };
  // Rewarded flow shared by every placement. Ad-Free owners get grantFree (same caps). Handles §8 messages.
  function watch(p, reward) {
    var s = S();
    if (p === 'speed_boost') { var c = B.canAdd(s.boost, s.ads, cfg); if (!c.ok) { toast(c.reason === 'capped' ? '⏳ Daily fuel cap reached. Back at midnight' : '⛽ Tank is full'); return Promise.resolve(null); } }
    if (M.ent('adFree')) return Promise.resolve(ads.grantFree(p, { reward: reward })).then(msg);
    return ads.showRewarded(p, { reward: reward }).then(msg);
  }
  M.watch = watch;
  function msg(r) {
    if (!r) return r;
    if (r.via === 'pity' && r.granted) toast('On the house this time 🚚');
    else if (r.status === 'no_fill' || r.status === 'error') toast('📺 No video available right now. Sorry! Try again in a minute.');
    else if (r.status === 'offline') toast('Ads need a connection. Your rigs keep rolling at 1x.');
    else if (r.status === 'capped') toast(r.reason === 'gap' ? '📺 One moment… next video in ' + Math.ceil((r.wait || 0) / 1000) + ' s' : '⏳ Back at midnight');
    return r;
  }

  // ---------- per-frame (hot path; must not allocate) ----------
  var ctx = { gated: false, spd: 1, hidden: false, adPlaying: false }, ui = 0, roll = 0, lastSpd = 0, emptyAt = 0, ses5 = 0, ses10 = 0;
  M.frame = function (dt) {
    if (!ON) return false;
    if (!M.booted) boot();
    if (M.adPlaying) return true;
    var s = S(); if (!s || !s.boost) return false;
    var gt = M.gated();
    if (gt && !s.gate.since) firstGate(s);
    if ((roll += dt) > 5) { roll = 0; MS.rollDay(s.ads, dayNow(), Date.now(), cfg); }
    var sp = s.spd || 1;
    if (sp !== lastSpd) { if (gt && sp > 1) track(lastSpd > 1 ? 'boost_tier_change' : 'boost_start', { tier: sp, bank_s: Math.round(s.boost.bank) }); if (sp > 1) s.boost.tier = sp; lastSpd = sp; }
    ctx.gated = gt; ctx.spd = sp; ctx.hidden = document.hidden; ctx.adPlaying = M.adPlaying;
    var burned = B.drain(s.boost, dt, ctx, cfg);
    if (burned) { if (sp >= 10) ses10 += dt; else ses5 += dt; }
    if (gt && sp > 1 && s.boost.bank <= 0) empty(s); else emptyAt = 0;
    if ((ui += dt) > 0.5) { ui = 0; paint(gt, s); }
    return false;
  };
  function empty(s) {
    if (M.ent('adFree')) {
      if (B.canAdd(s.boost, s.ads, cfg).ok) { var r = ads.grantFree('speed_boost', { reward: function () { B.add(s.boost, cfg); } }); if (r.granted) { toast('⛽ Refueled (Ad-Free)'); return; } }
    }
    var lh = g('listHeld'), now = performance.now();
    if (!emptyAt) emptyAt = now;
    if (typeof lh === 'function' && lh() && now - emptyAt < cfg.emptyHoldMaxSec * 1000) return;   // wait for finger release (<= 3 s)
    emptyAt = 0; track('boost_empty', { tier: s.spd, bank_s: 0 });
    var f = g('setSpd'); f && f(1);   // BATCH flushes on its own 3 s interval (one cash popup)
    toast(M.ent('adFree') ? '⛽ Daily fuel cap reached: back to 1x' : '⛽ Boost tank empty: 📺 refuel?', 3500);
  }
  function firstGate(s) {
    var r = B.firstGate(s, cfg, Date.now()), c = LT.grandfather(s);
    track('gating_first_seen', {});
    if (c || r.fuel) track('grandfather_grant', { color: c || '', fuel_granted: r.fuel });
    if (r.fuel) toast("Speed boosts now run on ad fuel. Here's a full tank on us.", 5000);
    save();
  }
  function boot() {
    M.booted = true;
    ads.init(); ent.init();
    if (w.DKConfig && cfg.remoteUrl) w.DKConfig.fetchRemote();
    w.addEventListener('pagehide', function () { if (ses5 || ses10) track('boost_drain_session', { seconds_5x: Math.round(ses5), seconds_10x: Math.round(ses10) }); ses5 = ses10 = 0; });
    css();
  }

  // ---------- UI (self-contained DOM; no game markup changes) ----------
  var fuelEl = null;
  function paint(gt, s) {
    var bar = document.getElementById('spd'); if (!bar) return;
    var bs = bar.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) { var m = +bs[i].dataset.s; bs[i].classList.toggle('dk-lock', gt && m > 1 && !canSpd(m)); }
    if (!gt) { if (fuelEl) fuelEl.style.display = 'none'; return; }
    if (!fuelEl) { fuelEl = document.createElement('div'); fuelEl.id = 'dkfuel'; fuelEl.onclick = function () { M.fuelUp(s.boost.tier || 5); }; document.body.appendChild(fuelEl); }
    var r = bar.getBoundingClientRect(), sp = s.spd || 1, left = s.boost.bank / (B.burnRate(sp > 1 ? sp : 5, cfg) || 1);
    fuelEl.style.display = ''; fuelEl.style.top = Math.round(r.bottom + 2) + 'px'; fuelEl.style.left = Math.round(r.left + r.width / 2) + 'px';
    var t = s.boost.bank > 0 ? '⛽ ' + B.label(s.boost.bank, sp, cfg) : '⛽ 📺 refuel';
    if (fuelEl.textContent !== t) fuelEl.textContent = t;
    fuelEl.classList.toggle('warn', sp > 1 && s.boost.bank > 0 && left <= cfg.warnSec);
  }
  function css() {
    var st = document.createElement('style');
    st.textContent = '#spd button.dk-lock{position:relative;opacity:.75}#spd button.dk-lock:after{content:"🔒⛽";position:absolute;top:-6px;right:-4px;font-size:9px}' +
      '#dkfuel{position:fixed;transform:translateX(-50%);z-index:1001;font:600 11px system-ui;color:#ffd84d;background:rgba(11,18,32,.8);padding:2px 8px;border-radius:8px;white-space:nowrap}' +
      '#dkfuel.warn{animation:dkp 1s infinite}@keyframes dkp{50%{opacity:.35}}' +
      '#dksheet{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}' +
      '#dksheet .c{background:#141f35;color:#e8eef8;border-radius:16px 16px 0 0;padding:16px;width:100%;max-width:420px;padding-bottom:calc(16px + env(safe-area-inset-bottom))}' +
      '#dksheet button{display:block;width:100%;min-height:44px;margin-top:8px;border:0;border-radius:10px;font-weight:700;background:#ffd84d;color:#1a1300}#dksheet button.alt{background:#24314d;color:#e8eef8}#dksheet button[disabled]{opacity:.5}';
    document.head.appendChild(st);
  }
  function busy(b, on) { if (!b) return; b.disabled = on; if (on) { b._t = b.textContent; b.textContent = '⏳ Loading video…'; } else if (b._t) b.textContent = b._t; }
  function sheet(title, html, btns, onBtn, onClose) {
    var old = document.getElementById('dksheet'); if (old) old._close();
    var d = document.createElement('div'); d.id = 'dksheet';
    d.innerHTML = '<div class="c"><b style="font-size:16px">' + title + '</b>' + html + btns.map(function (b) { return '<button data-k="' + b.k + '" class="' + (b.alt ? 'alt' : '') + '"' + (b.dis ? ' disabled' : '') + '>' + b.t + '</button>'; }).join('') + '</div>';
    var closed = false;
    d._close = function () { if (closed) return; closed = true; d.remove(); onClose && onClose(); };
    d.onclick = function (e) { if (e.target === d) return d._close(); var b = e.target.closest && e.target.closest('button'); if (b && !b.disabled) onBtn(b.dataset.k, d._close, b); };
    document.body.appendChild(d); return d;
  }
  M._cfg = cfg; M._on = ON;
  w.DKMon = M;
})(window);

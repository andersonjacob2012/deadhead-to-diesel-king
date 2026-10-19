/* Rewarded-ad wrapper (ad-unlock-spec §3, §8, §9). The ONLY ad API the game calls.
 *
 *   const ads = DKAds.create({ adapter, cfg, enabled, state:()=>S.ads, save, now, day, online, pause, resume, track })
 *   ads.init()                      -> Promise<void>  (never rejects; failure => healthy() false => fail-open)
 *   ads.healthy()                   -> bool  (false: init failed, or >= cfg.unhealthyErrors consecutive errors in window)
 *   ads.canShow(p)                  -> {ok, reason}   (healthy, in-flight, minAdGapSec, per-placement gap, daily cap)
 *   ads.showRewarded(p, {reward})   -> Promise<Result> {status, placement, nonce, network, ms, granted, via}
 *   ads.grantFree(p, {reward})      -> Result         (Ad-Free owners: same caps, same grant path, no video)
 *   ads.grant(nonce, p, fn, via)    -> bool           (idempotent; last cfg.nonceKeep nonces in S.ads.nonces)
 *
 * reward() runs only on the network's earned-reward event (AdMob RewardAdPluginEvents.Rewarded) or the §8 pity rule,
 * exactly once per nonce, followed by save(). Status 'busy' for a second call while one is in flight.
 * Adapters: DKAds.adapters.admob(cfg, platform) [native, UMP consent], DKAds.adapters.adsense(cfg) [web, inactive stub until Jacob's
 * domain + approval; waits for DKConsent.ready()], DKAds.adapters.mock(script) [tests/web QA], DKAds.adapters.none().
 */
(function (root, f) { var m = f(root); if (typeof module === 'object' && module.exports) module.exports = m; else root.DKAds = m; })(this, function (root) {
  'use strict';
  var seq = 0;
  function mkNonce(now) { return (now || Date.now()).toString(36) + '-' + (++seq).toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function noop() {}

  function create(o) {
    var cfg = o.cfg, A = o.adapter, enabled = !!o.enabled;
    var now = o.now || function () { return Date.now(); };
    var day = o.day || function () { var d = new Date(now()); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5); };
    var online = o.online || function () { return !(root && root.navigator && root.navigator.onLine === false); };
    var st = o.state, save = o.save || noop, track = o.track || noop, pause = o.pause || noop, resume = o.resume || noop;
    var initState = 'idle', initP = null, wasOk = !!o.lastInitOk, errs = [], inFlight = null, ready = false, loading = null, miss = {}, unhealthyLogged = false;

    function ads() { var a = st(); if (o.rollDay) o.rollDay(a, day(), now(), cfg); return a; }
    function healthy() {
      if (!enabled || !A) return false;
      if (initState === 'fail') return false;
      if (initState !== 'ok' && !wasOk) return false;   // optimistic only while (re)initializing after a good session
      var t = now(), w = cfg.unhealthyWindowMin * 60e3, n = 0;
      for (var i = 0; i < errs.length; i++) if (t - errs[i] <= w) n++;
      if (n >= cfg.unhealthyErrors) { if (!unhealthyLogged) { unhealthyLogged = true; track('ads_unhealthy', { reason: 'errors' }); } return false; }
      return true;
    }
    function reinit() { if (initState === 'fail') initP = null; return init(); }   // ad-blocker re-check (Fuel-up open)
    function init() {
      if (initP) return initP;
      if (!enabled || !A) { initState = 'off'; return (initP = Promise.resolve()); }
      initState = 'pending';
      initP = Promise.resolve().then(function () { return A.init(); })
        .then(function () { initState = 'ok'; if (o.onInitOk) o.onInitOk(); preload(); },
              function (e) { initState = 'fail'; track('ads_unhealthy', { reason: 'init:' + ((e && (e.code || e.message)) || e) }); if (o.onInitFail) o.onInitFail(e); });
      return initP;
    }
    function cap(p) { var c = cfg.caps && cfg.caps[p]; if (p === 'speed_boost' && c == null) c = cfg.boostAdsPerDay; return c || 0; }
    function canShow(p) {
      if (!healthy()) return { ok: false, reason: 'unhealthy' };
      if (inFlight) return { ok: false, reason: 'busy' };
      return capsOk(p);
    }
    function capsOk(p) {
      var a = ads(), t = now(), c = cap(p);
      if (c && (a.cnt[p] || 0) >= c) return { ok: false, reason: 'capped' };
      if (a.lastAdTs && t - a.lastAdTs < cfg.minAdGapSec * 1000 && t >= a.lastAdTs) return { ok: false, reason: 'gap', wait: cfg.minAdGapSec * 1000 - (t - a.lastAdTs) };
      var g = cfg.gaps && cfg.gaps[p], lp = a.lastP && a.lastP[p];
      if (g && lp && t - lp < g * 1000 && t >= lp) return { ok: false, reason: 'gap', wait: g * 1000 - (t - lp) };
      return { ok: true };
    }
    // Idempotent grant: a repeated nonce (duplicate SDK callback) never pays twice.
    function grant(nonce, p, fn, via) {
      var a = ads();
      if (a.nonces.indexOf(nonce) >= 0) return false;
      a.nonces.push(nonce); if (a.nonces.length > cfg.nonceKeep) a.nonces.splice(0, a.nonces.length - cfg.nonceKeep);
      a.cnt[p] = (a.cnt[p] || 0) + 1;
      var t = now(); a.lastP = a.lastP || {}; a.lastP[p] = t;
      if (via === 'ad') a.lastAdTs = t;   // completed rewarded ad: resets the interstitial clock + minAdGap
      try { fn && fn(); } finally { save(); }
      track('ad_reward_granted', { placement: p, nonce: nonce, via: via });
      if (c0(p) && a.cnt[p] >= cap(p)) track('ad_cap_reached', { placement: p });
      return true;
    }
    function c0(p) { return cap(p) > 0; }
    function preload() {
      if (ready || loading || initState !== 'ok') return loading;
      var tmo = cfg.loadTimeoutSec * 1000, timer;
      loading = new Promise(function (res) {
        timer = setTimeout(function () { res('no_fill'); }, tmo);
        Promise.resolve().then(function () { return A.load(); }).then(function () { res('ok'); }, function (e) { res(e && e.code === 'no_fill' ? 'no_fill' : 'error'); });
      }).then(function (r) { clearTimeout(timer); loading = null; if (r === 'ok') ready = true; return r; });
      return loading;
    }
    function result(status, p, nonce, t0, extra) {
      var r = { status: status, placement: p, nonce: nonce, network: (A && A.name) || 'none', ms: now() - t0, granted: false };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    }
    // §8 pity: 2nd no-fill/error in a row for this placement within pityWindowMin, < pityPerDay today, online.
    function onMiss(p, nonce, fn, status, t0) {
      var t = now(), m = miss[p], a = ads();
      if (m && t - m.ts <= cfg.pityWindowMin * 60e3 && a.pity < cfg.pityPerDay && online() && capsOk(p).reason !== 'capped') {
        miss[p] = null; a.pity++;
        var g = grant(nonce, p, fn, 'pity');
        return result(status, p, nonce, t0, { granted: g, via: 'pity', pity: true });
      }
      miss[p] = { ts: t };
      return result(status, p, nonce, t0);
    }
    function showRewarded(p, ctx) {
      ctx = ctx || {};
      var t0 = now(), nonce = mkNonce(t0), fn = ctx.reward;
      if (inFlight) return Promise.resolve(result('busy', p, nonce, t0));
      if (!healthy()) return Promise.resolve(result('error', p, nonce, t0, { reason: 'unhealthy' }));
      if (!online()) return Promise.resolve(result('offline', p, nonce, t0));
      var c = capsOk(p);
      if (!c.ok) return Promise.resolve(result('capped', p, nonce, t0, { reason: c.reason, wait: c.wait }));
      track('ad_request', { placement: p, nonce: nonce });
      inFlight = new Promise(function (resolve) {
        var settled = false, earned = false, granted = false, paused = false, showTimer = null, graceTimer = null;
        function done(r) {
          if (settled) return; settled = true; clearTimeout(showTimer); clearTimeout(graceTimer);
          if (paused) { paused = false; try { resume(); } catch (e) {} }
          inFlight = null; ready = false;
          if (r.status === 'error') errs.push(now()); else if (r.status !== 'no_fill') { errs.length = 0; unhealthyLogged = false; }
          if (r.status === 'rewarded' || r.status === 'dismissed') miss[p] = null;
          track('ad_result', { placement: p, status: r.status, network: r.network, ms: r.ms });
          setTimeout(preload, 0);   // preload the next one after each show
          resolve(r);
        }
        var loadP = ready ? Promise.resolve('ok') : preload() || Promise.resolve('error');
        loadP.then(function (lr) {
          if (lr !== 'ok') { done(onMiss(p, nonce, fn, lr === 'no_fill' ? 'no_fill' : 'error', t0)); return; }
          try { pause(); paused = true; } catch (e) {}
          showTimer = setTimeout(function () { done(result(earned ? 'rewarded' : 'dismissed', p, nonce, t0, { granted: granted, via: 'ad' })); }, cfg.showTimeoutSec * 1000);
          var h = {
            nonce: nonce, placement: p,
            onReward: function () {   // the ONLY path to a real-ad grant
              if (settled && !earned) return;   // late event after we already gave up: ignore
              earned = true; if (grant(nonce, p, fn, 'ad')) granted = true;
              if (graceTimer) done(result('rewarded', p, nonce, t0, { granted: granted, via: 'ad' }));
            },
            onDismiss: function () {
              if (earned) return done(result('rewarded', p, nonce, t0, { granted: granted, via: 'ad' }));
              graceTimer = setTimeout(function () { done(result(earned ? 'rewarded' : 'dismissed', p, nonce, t0, { granted: granted, via: earned ? 'ad' : undefined })); }, cfg.dismissGraceMs);
            },
            onShowFail: function () { done(onMiss(p, nonce, fn, 'error', t0)); },
            onNoFill: function () { done(onMiss(p, nonce, fn, 'no_fill', t0)); }   // web: no ad ready at show time
          };
          Promise.resolve().then(function () { return A.show(h); }).catch(function () { h.onShowFail(); });
        });
      });
      return inFlight;
    }
    function grantFree(p, ctx) {
      var t0 = now(), nonce = mkNonce(t0);
      var c = capsOk(p);   // minAdGap applies only to videos; free grants still share the daily caps
      if (c.reason === 'capped') return result('capped', p, nonce, t0);
      var g = grant(nonce, p, ctx && ctx.reward, 'free_ent');
      return result('rewarded', p, nonce, t0, { granted: g, via: 'free_ent', network: 'free' });
    }
    return { init: init, reinit: reinit, healthy: healthy, canShow: canShow, showRewarded: showRewarded, grantFree: grantFree, grant: grant,
             busy: function () { return !!inFlight; }, state: function () { return initState; }, _errs: errs, _miss: miss };
  }

  // ---------------- adapters ----------------
  function none() { return { name: 'none', init: function () { return Promise.reject(new Error('no ad adapter')); }, load: function () { return Promise.reject({ code: 'error' }); }, show: function (h) { h.onShowFail(); } }; }

  // Web: AdSense H5 Games Ads (Ad Placement API). INACTIVE STUB: needs cfg.adsense.client (none yet), and ADS_ENABLED only
  // turns on for web on cfg.webAdHost. A Google-certified CMP must load before this tag (not wired yet; Jacob's account).
  // When the tag can't load (onerror, or loaded without adsbygoogle.loaded = an empty stub) a bait check tells the two apart:
  // blockers' cosmetic filters hide an element classed like an ad; an outage (Google down / CDN error) leaves it visible.
  //   bait hidden  => reject {code:'blocked'}  => monetize.js keeps boost + colors locked with a notice
  //   bait visible => reject {code:'outage'}   => plain init failure => fail-open (features free)
  // Ad-blocker bait: resolves true when a cosmetic filter hid an ad-like element (blocker), false otherwise (outage).
  function bait(w) {
    return new Promise(function (res) {
      try { var d = w.document, b = d.createElement('div'); } catch (e) { return res(false); }
      b.className = 'adsbox ad-banner adsbygoogle pub_300x250'; b.setAttribute('aria-hidden', 'true');
      b.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:300px;height:250px;';
      d.body.appendChild(b);
      setTimeout(function () {
        var cs = w.getComputedStyle ? w.getComputedStyle(b) : {};
        var hidden = !b.offsetParent || b.offsetHeight === 0 || cs.display === 'none' || cs.visibility === 'hidden';
        b.remove(); res(hidden);
      }, 100);
    });
  }
  function adsense(cfg, w) {
    w = w || root; var A = cfg.adsense || {};
    function ab(o) { (w.adsbygoogle = w.adsbygoogle || []).push(o); }
    return {
      name: 'adsense',
      init: function () {
        if (!A.client) return Promise.reject(new Error('adsense: no client id'));
        return new Promise(function (res, rej) {
          var d = w.document, SRC = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', settled = false;
          function fail(why) { if (settled) return; settled = true; bait(w).then(function (hidden) { rej({ code: hidden ? 'blocked' : 'outage', message: 'ad tag ' + why }); }); }
          function ready() {   // some blockers answer with an empty stub: the real tag sets adsbygoogle.loaded
            if (settled) return;
            if (!(w.adsbygoogle && w.adsbygoogle.loaded)) return fail('stubbed');
            settled = true;
            // EU consent (platform/consent.js): the tag brings Google's CMP; nothing is configured, preloaded or requested
            // until it has a decision. CMP missing / never loads => {code:'outage'} => fail-open (free), never a blocker lock.
            var C = w.DKConsent;
            (C && C.active ? C.ready() : Promise.reject({ code: 'outage', message: 'consent module missing' }))
              .then(function () { ab({ preloadAdBreaks: 'on', sound: 'on' }); res(); }, function (e) { rej({ code: 'outage', message: (e && e.message) || 'consent' }); });
          }
          w.adsbygoogle = w.adsbygoogle || [];
          // Reuse the literal AdSense verification tag in <head> (index.html) if present: never load adsbygoogle.js twice.
          var s = d.querySelector ? d.querySelector('script[src*="' + SRC + '"]') : null;
          if (s) {
            if (w.adsbygoogle.loaded) return ready();
            s.addEventListener('load', ready); s.addEventListener('error', function () { fail('failed'); });
            // already finished before we looked (load event missed): give it loadTimeoutSec, then judge by adsbygoogle.loaded
            setTimeout(function () { if (w.adsbygoogle && w.adsbygoogle.loaded) ready(); else fail('not loaded'); }, ((cfg.loadTimeoutSec || 10) * 1000));
            return;
          }
          s = d.createElement('script');
          s.async = true; s.crossOrigin = 'anonymous'; s.setAttribute('data-ad-client', A.client);
          if (A.test || w.DK_STAGE) s.setAttribute('data-adbreak-test', 'on');
          s.src = 'https://' + SRC + '?client=' + encodeURIComponent(A.client);
          s.onerror = function () { fail('failed'); }; s.onload = ready;
          d.head.appendChild(s);
        });
      },
      load: function () { return Promise.resolve(); },   // the API preloads; availability is only known at adBreak time
      show: function (h) {
        ab({ type: 'reward', name: h.placement || 'reward',
             beforeReward: function (show) { show(); },
             adViewed: function () { h.onReward(); },     // the ONLY grant path
             adBreakDone: function (i) { var b = i && i.breakStatus;
               if (b === 'viewed' || b === 'dismissed') h.onDismiss();
               else if (b === 'notReady' || b === 'frequencyCapped' || b === 'noAdPreloaded' || b === 'timeout') h.onNoFill();
               else h.onShowFail(); } });
      }
    };
  }

  // Native AdMob via @capacitor-community/admob (no bundler: resolved from the Capacitor bridge at runtime).
  function admob(cfg, platform, w) {
    w = w || root; var P = null, cur = null, E = {
      Rewarded: 'onRewardedVideoAdReward', Dismissed: 'onRewardedVideoAdDismissed', FailedToShow: 'onRewardedVideoAdFailedToShow' };
    function plugin() {
      var C = w.Capacitor; if (!C) return null;
      return (C.Plugins && C.Plugins.AdMob) || (C.registerPlugin ? C.registerPlugin('AdMob') : null);
    }
    function adId() { return cfg.admob.rewarded[platform]; }
    return {
      name: 'admob',
      init: function () {
        P = plugin(); if (!P) return Promise.reject(new Error('AdMob plugin missing'));
        return P.initialize({ initializeForTesting: !!cfg.admob.testing })
          .then(function () { return P.requestConsentInfo ? P.requestConsentInfo() : { canRequestAds: true }; })   // UMP first
          .then(function (ci) { return ci && ci.isConsentFormAvailable && ci.status === 'REQUIRED' ? P.showConsentForm() : ci; })
          .then(function (ci) {
            if (platform !== 'ios' || !P.trackingAuthorizationStatus) return ci;   // then ATT on iOS
            return P.trackingAuthorizationStatus().then(function (s) { return s && s.status === 'notDetermined' ? P.requestTrackingAuthorization() : null; }).then(function () { return ci; }, function () { return ci; });
          })
          .then(function (ci) {
            if (ci && ci.canRequestAds === false) throw new Error('consent: cannot request ads');
            P.addListener(E.Rewarded, function () { cur && cur.onReward(); });
            P.addListener(E.Dismissed, function () { var h = cur; cur = null; h && h.onDismiss(); });
            P.addListener(E.FailedToShow, function () { var h = cur; cur = null; h && h.onShowFail(); });
          });
      },
      load: function () {
        return P.prepareRewardVideoAd({ adId: adId(), isTesting: !!cfg.admob.testing })
          .catch(function (e) { var c = e && (e.code != null ? e.code : e.errorCode); throw { code: (c === 3 || /no.?fill/i.test(String(e && e.message))) ? 'no_fill' : 'error', raw: e }; });
      },
      show: function (h) { cur = h; return P.showRewardVideoAd(); }   // reward granted ONLY from the Rewarded event
    };
  }

  // Scriptable mock for tests and web QA. script: 'reward' | 'dismiss' | 'no_fill' | 'error' | 'showfail' | 'double' | 'late'
  // | 'hang' | 'initfail' | 'blocked' (ad blocker) | 'outage' (tag down, not a blocker) (or an array consumed per request).
  function mock(script, opt) {
    opt = opt || {}; var q = Array.isArray(script) ? script.slice() : null, calls = { init: 0, load: 0, show: 0 }, cur = 'reward';
    function next() { return q ? (q.length ? q.shift() : 'reward') : script; }
    var d = opt.delay || 0;
    function later(f) { if (d) setTimeout(f, d); else Promise.resolve().then(f); }
    return {
      name: 'mock', calls: calls,
      init: function () { calls.init++; return script === 'initfail' ? Promise.reject(new Error('mock init fail')) : script === 'blocked' ? Promise.reject({ code: 'blocked' }) : script === 'outage' ? Promise.reject({ code: 'outage' }) : Promise.resolve(); },
      load: function () {
        calls.load++; cur = next();
        if (cur === 'hang') return new Promise(function () {});
        if (cur === 'no_fill') return Promise.reject({ code: 'no_fill' });
        if (cur === 'error') return Promise.reject({ code: 'error' });
        return Promise.resolve();
      },
      show: function (h) {
        calls.show++; var m = cur;
        later(function () {
          if (m === 'showfail') return h.onShowFail();
          if (m === 'dismiss') return h.onDismiss();
          if (m === 'late') { h.onDismiss(); return setTimeout(function () { h.onReward(); }, 50); }
          h.onReward(); if (m === 'double') h.onReward();
          h.onDismiss(); if (m === 'double') h.onReward();
        });
      }
    };
  }
  return { create: create, adapters: { admob: admob, adsense: adsense, mock: mock, none: none }, bait: bait, mkNonce: mkNonce };
});

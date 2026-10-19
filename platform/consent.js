/* DKConsent — EU consent for WEB ads (EEA, UK, Switzerland). Classic script: load right AFTER dk-config.js and BEFORE ads.js.
 * Uses Google's own certified CMP: the AdSense "Privacy & messaging" European regulations message (IAB TCF), which
 * Google serves through the AdSense tag itself (no extra CMP script). See platform/ADS_WIRING.md "Web consent".
 *
 * Ad gating (`active`) needs ALL of: DK_PLATFORM 'web', ADS_ENABLED (webAdsEnabled + webAdHost match + not adsDown),
 * webAdapter 'adsense' and DK_CFG.adsense.client. Shipped OFF. Consent listening + the Privacy choices row (`cmp`) also run
 * when the literal AdSense verification tag is on the page (it loads Google's CMP even with ads off). Otherwise inert.
 * The Capacitor app never uses this: native ads get consent from the AdMob UMP SDK inside DKAds.adapters.admob.
 *
 *   DKConsent.active                 bool, fixed for the session
 *   DKConsent.ready(timeoutMs?)      -> Promise<'gdpr'|'none'>  resolves once the TCF CMP has a decision (or GDPR doesn't apply);
 *                                       rejects {code:'outage'} if the CMP never shows up (fail-open, same as an ad-tag outage).
 *                                       Only after it resolves may the AdSense adapter configure / request ads.
 *   DKConsent.canRevoke()            true once the CMP is on the page AND GDPR applies to this visitor
 *   DKConsent.revoke()               googlefc.showRevocationMessage() via googlefc.callbackQueue (re-opens the message)
 *   DKConsent.row()                  Settings row HTML ('Privacy choices'), '' when canRevoke() is false
 */
(function (root, f) { var m = f(root); if (typeof module === 'object' && module.exports) module.exports = m; else root.DKConsent = m; })(this, function (root) {
  'use strict';
  var REGION = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
                'IS','LI','NO', 'GB', 'CH'];   // EU 27 + EEA (IS, LI, NO) + UK + Switzerland

  function create(w) {
    var cfg = w.DK_CFG || {}, A = cfg.adsense || {};
    var web = w.DK_PLATFORM === 'web', d = w.document;
    var active = web && !!w.ADS_ENABLED && cfg.webAdapter === 'adsense' && !!A.client;
    // Dev Lead's literal AdSense verification tag in <head> loads Google's CMP even while ads are OFF, so consent listening and the
    // Privacy choices row follow the tag (cmp); ad gating follows `active` only. Never in the Capacitor app (www build strips the tag).
    var hasTag = web && !!(d && d.querySelector && d.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]'));
    var cmp = active || hasTag;
    var api = { active: active, cmp: cmp, REGION: REGION, applies: null, apiReady: false };
    var waiters = [], decided = null;
    function decide(v) { if (decided) return; decided = v; api.applies = v === 'gdpr'; waiters.splice(0).forEach(function (f) { f(v); }); }
    if (cmp) {
      // 1) Google Consent Mode v2 defaults, before ANY Google tag. Normally set by the inline snippet ABOVE the verification tag in
      //    <head> (window.DK_CONSENT_DEFAULTS=1); this is the fallback for a page without it (tag added later by the adapter).
      //    Denied for EEA/UK/CH; Google's CMP updates them after the visitor chooses (enable "Consent mode" in Privacy & messaging).
      w.dataLayer = w.dataLayer || [];
      w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      if (!w.DK_CONSENT_DEFAULTS) { w.DK_CONSENT_DEFAULTS = 1; w.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
                                     region: REGION, wait_for_update: 500 }); }
      // 2) googlefc queue: the AdSense tag loads Google's CMP and drains this queue.
      var fc = w.googlefc = w.googlefc || {}; fc.callbackQueue = fc.callbackQueue || [];
      fc.callbackQueue.push({ CONSENT_API_READY: function () {
        api.apiReady = true;
        if (typeof w.__tcfapi !== 'function') return;
        w.__tcfapi('addEventListener', 2.2, function (d, ok) {
          if (!ok || !d) return;
          if (d.gdprApplies === false) return decide('none');
          api.applies = !!d.gdprApplies;
          if (d.eventStatus === 'tcloaded' || d.eventStatus === 'useractioncomplete') decide('gdpr');
          else if (d.eventStatus === 'cmpuishown') api.shown = true;   // visitor is looking at the message: keep waiting, no timeout
        });
      } });
      fc.callbackQueue.push({ CONSENT_DATA_READY: function () { decide(api.applies === false ? 'none' : 'gdpr'); } });
    }
    api.ready = function (timeoutMs) {
      if (!active) return Promise.reject({ code: 'off', message: 'consent: inactive' });
      if (decided) return Promise.resolve(decided);
      return new Promise(function (res, rej) {
        var t = setTimeout(function check() {
          if (decided) return;
          if (api.shown) { t = setTimeout(check, 1000); return; }   // message on screen: wait for the choice
          rej({ code: 'outage', message: 'consent: CMP did not load' });
        }, timeoutMs || ((cfg.consentTimeoutSec || 10) * 1000));
        waiters.push(function (v) { clearTimeout(t); res(v); });
      });
    };
    api.canRevoke = function () { return cmp && api.apiReady && api.applies === true; };
    api.revoke = function () {
      if (!cmp) return false;
      (w.googlefc.callbackQueue = w.googlefc.callbackQueue || []).push({ CONSENT_API_READY: function () { try { w.googlefc.showRevocationMessage(); } catch (e) {} } });
      return true;
    };
    api.row = function () {
      return api.canRevoke() ? '<div class="row" style="margin-top:8px"><span>Ads</span><button class="b g" id="dkConsentSet" onclick="DKConsent.revoke()" aria-label="Privacy choices for ads">Privacy choices ›</button></div>' : '';
    };
    return api;
  }
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') return { create: create, REGION: REGION };
  var api = create(root); api.create = create; return api;
});

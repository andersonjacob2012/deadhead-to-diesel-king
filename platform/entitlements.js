/* IAP entitlements via RevenueCat (@revenuecat/purchases-capacitor), ad-unlock-spec §6.
 *
 *   const ent = DKEnt.create({ platform, keys:{ios,android}, state:()=>S.ent, device:()=>id, save, plugin?, track? })
 *   ent.init()        -> Promise<bool>   configure + refresh (inert => false, never rejects)
 *   ent.has(id)       -> bool            'adFree' | 'noForced' | 'lightBar'
 *   ent.refresh()     -> Promise<info>   getCustomerInfo; overwrites the S.ent cache
 *   ent.restore()     -> Promise<info>   "Restore purchases"; overwrites the cache
 *   ent.purchase(pkgId) -> Promise<{status}>  'unavailable' while inert (no storefront UI in this branch)
 *   ent.inert()       -> bool
 *
 * RevenueCat is the source of truth. The S.ent cache only answers for OFFLINE launches on the SAME device that
 * RevenueCat last confirmed (S.ent.dev). A cached true restored onto a fresh install/other device (e.g. from a cloud
 * save) stays OFF until RevenueCat confirms it. Inert (all false, zero SDK calls) without an API key or off-native.
 */
(function (root, f) { var m = f(root); if (typeof module === 'object' && module.exports) module.exports = m; else root.DKEnt = m; })(this, function (root) {
  'use strict';
  var IDS = ['adFree', 'noForced', 'lightBar'];
  function create(o) {
    var key = o.keys && o.keys[o.platform], live = null, P = null, st = o.state, save = o.save || function () {}, track = o.track || function () {};
    var isInert = !key || o.platform === 'web';
    function plugin() {
      if (o.plugin) return o.plugin;
      var C = root && root.Capacitor; if (!C) return null;
      return (C.Plugins && C.Plugins.Purchases) || (C.registerPlugin ? C.registerPlugin('Purchases') : null);
    }
    function apply(info) {
      var act = (info && info.entitlements && info.entitlements.active) || {}, e = st(), r = {};
      for (var i = 0; i < IDS.length; i++) { r[IDS[i]] = !!act[IDS[i]]; e[IDS[i]] = r[IDS[i]]; }
      e.ts = Date.now(); e.dev = o.device ? o.device() : ''; live = r; save();
      return r;
    }
    function has(id) {
      if (isInert) return false;
      if (live) return !!live[id];
      var e = st(); return !!(e && e[id] && e.dev && o.device && e.dev === o.device());
    }
    function refresh() {
      if (isInert || !P) return Promise.resolve(null);
      return P.getCustomerInfo().then(function (r) { return apply(r && (r.customerInfo || r)); }, function () { return null; });
    }
    function init() {
      if (isInert) return Promise.resolve(false);
      P = plugin(); if (!P) { isInert = true; return Promise.resolve(false); }
      return Promise.resolve().then(function () { return P.configure({ apiKey: key }); })
        .then(function () { try { P.addCustomerInfoUpdateListener(function (ci) { apply(ci); }); } catch (e) {} return refresh(); })
        .then(function () { return true; }, function () { return false; });
    }
    function restore() {
      if (isInert || !P) return Promise.resolve(null);
      return P.restorePurchases().then(function (r) { var x = apply(r && (r.customerInfo || r)); track('iap_restore', {}); return x; }, function () { return null; });
    }
    function purchase(pkgId) {
      if (isInert || !P) return Promise.resolve({ status: 'unavailable' });
      return P.getOfferings().then(function (of) {
        var cur = of && of.current, pk = cur && (cur.availablePackages || []).filter(function (x) { return x.identifier === pkgId || (x.product && x.product.identifier === pkgId); })[0];
        if (!pk) return { status: 'unavailable' };
        return P.purchasePackage({ aPackage: pk }).then(function (r) {
          apply(r && r.customerInfo);
          track('iap_purchase', { product: pk.product && pk.product.identifier, price: pk.product && pk.product.price, currency: pk.product && pk.product.currencyCode });
          return { status: 'ok' };
        });
      }).catch(function (e) { return { status: e && e.userCancelled ? 'cancelled' : 'error' }; });
    }
    return { init: init, has: has, refresh: refresh, restore: restore, purchase: purchase, inert: function () { return isInert; }, IDS: IDS };
  }
  return { create: create, IDS: IDS };
});

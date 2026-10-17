/* Deadhead to Diesel King: chicken-light showroom picker.
 * Plain script, defines window.DKShowroom. Needs ../map-rigs/chicken.js (window.DK_CHICKEN) loaded first.
 *
 *   const sr = DKShowroom.mount(document.getElementById('showroom'), {
 *     rigsBase: 'assets/ui/map-rigs/',                // where tractor-*.svg, trailer-53.svg and the light layers live
 *     trucksBase: 'assets/ui/trucks/',               // make thumbnails for the make switcher (optional)
 *     palettes: rigsJson.chicken.palettes,           // [{id,class,color,unlock,cost?}]
 *     costs: DK_CFG.ckCost,                          // fallback ad cost per id when a palette has no `cost`
 *     current: S.chicken || 'amber',                 // equipped palette
 *     unlocked: ['amber', ...S.ckOwn],               // owned palettes (amber/default always owned)
 *     progress: S.ckProg,                            // {chase:1} ads already watched toward each locked color
 *     gated: GATED(),                                // false -> every color is free (fail-open / web), no ad UI
 *     make: 'ironcrest', makes: ['ironcrest','bannerline','highvale'], makeNames: MAKEN,
 *     onApply: id => setChicken(id),                 // equip an owned color
 *     onUnlock: (id, info) => Ads.showRewarded('chicken_unlock', {id}),   // must resolve to {status:'rewarded'|...}
 *     onBuyAll: () => buyLightBar(),                 // optional: shows the "Get all colors" button
 *     onClose: () => closeSheet(),                   // optional: shows a back button
 *   });
 */
(function (root) {
  'use strict';
  const ICON = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    ad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="13" rx="2.5"/><path d="M10 8.8v5.4l4.6-2.7z" fill="currentColor"/><path d="M8 21h8" stroke-linecap="round"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  };
  const NAMES = { amber: ['Amber', 'Classic road-train amber'], red: ['Red', 'Brake-light red'], blue: ['Blue', 'Cobalt night blue'], green: ['Green', 'Go-light green'],
    purple: ['Purple', 'Midnight purple'], white: ['White', 'Arctic white'], chase: ['Chase', 'Animated rainbow chase'] };
  const CHASE_CSS = '.ck{color:hsl(calc(var(--i)*37) 100% 62%)}';
  const CHASE_ANIM = '.ck{animation:c 1.4s linear infinite;animation-delay:calc(var(--i)*-.07s)}@keyframes c{0%,100%{opacity:1}50%{opacity:.25}}';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function mount(el, o) {
    o = Object.assign({ rigsBase: '../map-rigs/', trucksBase: '../trucks/', palettes: [], costs: {}, current: 'amber', unlocked: [], progress: {}, gated: true,
      make: 'ironcrest', makes: ['ironcrest', 'bannerline', 'highvale'], makeNames: { ironcrest: 'Ironcrest', bannerline: 'Bannerline', highvale: 'Highvale' } }, o || {});
    const st = { cur: o.current, view: o.current, make: o.make, own: new Set(o.unlocked), prog: Object.assign({}, o.progress), busy: false };
    const pal = id => o.palettes.find(p => p.id === id) || o.palettes[0];
    const cost = id => { const p = pal(id); return p.cost != null ? p.cost : (o.costs[id] != null ? o.costs[id] : 2); };
    const owned = id => !o.gated || pal(id).unlock === 'default' || st.own.has(id);
    const still = () => document.body.classList.contains('lowfx') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const colorOf = id => (/^#/.test(pal(id).color) ? pal(id).color : '#b46bff');

    // chicken lights = blob-URL <img> from chicken.js (same path the game uses; inline SVG is too slow on the map)
    const CK = {};
    function ckURL(part, id) {
      const s = still(), k = [part, id, s ? 1 : 0].join();
      if (CK[k]) return CK[k];
      let v = root.DK_CHICKEN[part];
      if (id === 'chase') v = v.replace(/(<svg[^>]*>)/, `$1<style>${CHASE_CSS}${s ? '' : CHASE_ANIM}</style>`);
      else v = v.replace(/color="[^"]*"/, `color="${colorOf(id)}"`);
      return (CK[k] = URL.createObjectURL(new Blob([v], { type: 'image/svg+xml' })));
    }

    const R = o.rigsBase;
    el.classList.add('dk-sr');
    el.innerHTML = `
<header class="dk-sr__head">
  ${o.onClose ? `<button class="dk-sr__back" type="button" aria-label="Back">${ICON.back}</button>` : ''}
  <div class="dk-sr__titles"><h1 class="dk-sr__title">Chicken Lights</h1><span class="dk-sub">Showroom · lights on</span></div>
</header>
<div class="dk-sr__stage" role="img" aria-label="Your rig parked in the showroom with its lights on">
  <div class="dk-sr__stall"></div>
  <div class="dk-sr__wall"><div class="dk-sr__sign">DIESEL KING<small>CUSTOM LIGHT SHOP</small></div></div>
    <div class="dk-rig dk-rig--night">
      <div class="dk-sr__pool"></div>
      <div class="dk-sr__headpool"></div>
      <div class="dk-sr__shadow"></div>
      <img class="dk-rig__trailer" src="${R}trailer-53.svg" alt="">
      <img class="dk-rig__lchick" alt="">
      <img class="dk-rig__llights" src="${R}trailer-lights.svg" alt="">
      <img class="dk-rig__beams" src="${R}tractor-beams.svg" alt="">
      <img class="dk-rig__tractor" alt="">
      <img class="dk-rig__tchick" alt="">
      <img class="dk-rig__tlights" src="${R}tractor-lights.svg" alt="">
    </div>
  <div class="dk-sr__vignette"></div>
  <div class="dk-sr__badge"><i></i><span></span></div>
  <div class="dk-sr__toast" role="status" aria-live="polite"></div>
</div>
<section class="dk-sr__panel dk-panel">
  ${o.makes.length > 1 ? `<div class="dk-sr__makes" role="group" aria-label="Truck">${o.makes.map(m => `<button class="dk-sr__make" type="button" data-make="${m}" aria-pressed="false">${o.trucksBase ? `<img src="${o.trucksBase}truck-${m}-thumb-sm.webp" alt="">` : ''}<span>${esc(o.makeNames[m] || m)}</span></button>`).join('')}</div>` : ''}
  <div class="dk-sr__info"><div class="dk-sr__name"></div><span class="dk-sr__state"></span></div>
  <ul class="dk-sr__swatches" role="radiogroup" aria-label="Chicken light color">
    ${o.palettes.map(p => `<li><button class="dk-sr__sw${p.id === 'chase' ? ' dk-sr__sw--chase' : ''}" type="button" role="radio" data-id="${p.id}" style="--c:${/^#/.test(p.color) ? p.color : '#b46bff'}" aria-label="${esc((NAMES[p.id] || [p.id])[0])}"><span class="dk-sr__dot"></span><span class="dk-sr__lbl"></span></button></li>`).join('')}
  </ul>
  <div class="dk-sr__actions">
    <div class="dk-sr__progress" hidden><b></b></div>
    <button class="dk-btn dk-btn--primary dk-sr__apply" type="button"></button>
    ${o.onBuyAll ? `<button class="dk-btn dk-btn--secondary dk-sr__buyall" type="button">Get all colors · ${esc(o.buyAllPrice || '$2.99')}</button>` : ''}
    <p class="dk-sr__note"></p>
  </div>
</section>`;

    const $ = s => el.querySelector(s), $$ = s => Array.from(el.querySelectorAll(s));
    const rig = $('.dk-rig'), stage = $('.dk-sr__stage');

    function size() { // px per SVG unit. Top-down, nose up: bumper at -79u, trailer tail at +178u from the tractor kingpin
      const w = stage.clientWidth, h = stage.clientHeight, wall = $('.dk-sr__wall').offsetHeight;
      const GAP = 14, TAIL = 6, LEN = 257;                         // pavement ahead of the bumper (beams + wheel stop), and behind the tail
      const u = Math.max(0.9, Math.min(2.6, (h - wall) / (GAP + LEN + TAIL), w / 64));
      const extra = Math.max(0, h - wall - (GAP + LEN + TAIL) * u);
      el.style.setProperty('--u', u.toFixed(3) + 'px'); rig.style.setProperty('--u', u.toFixed(3) + 'px');   // rigs.css sets its own --u on .dk-rig
      rig.style.top = Math.round(wall + extra * 0.4 + (GAP + 79) * u) + 'px';
    }

    function render() {
      const id = st.view, p = pal(id), own = owned(id), eq = id === st.cur, n = NAMES[id] || [id, ''];
      // stage
      o.palettes.forEach(q => rig.classList.remove(q.class)); rig.classList.add(p.class);
      el.style.setProperty('--dk-chicken', colorOf(id)); rig.style.setProperty('--dk-chicken', colorOf(id));
      el.classList.toggle('dk-sr--chase', id === 'chase'); el.classList.toggle('dk-sr--still', still());
      $$('.dk-rig__tchick').forEach(i => (i.src = ckURL('tractor', id)));
      $$('.dk-rig__lchick').forEach(i => (i.src = ckURL('trailer', id)));
      $('.dk-rig__tractor').src = `${R}tractor-${st.make}.svg`;
      const b = $('.dk-sr__badge'); b.classList.toggle('is-locked', !own);
      b.querySelector('span').innerHTML = own ? (eq ? 'Equipped' : 'Preview') : `${ICON.lock} Preview`;
      // makes
      $$('.dk-sr__make').forEach(m => m.setAttribute('aria-pressed', String(m.dataset.make === st.make)));
      // swatches
      $$('.dk-sr__sw').forEach(s => {
        const sid = s.dataset.id, so = owned(sid), c = cost(sid), pr = st.prog[sid] || 0;
        s.setAttribute('aria-checked', String(sid === id)); s.classList.toggle('is-locked', !so);
        s.querySelector('.dk-sr__lbl').innerHTML = so ? esc((NAMES[sid] || [sid])[0]) : `<span class="dk-sr__cost">${ICON.ad}${pr ? pr + '/' : ''}${c}</span>`;
        s.querySelectorAll('.dk-sr__lock,.dk-sr__eq').forEach(x => x.remove());
        if (!so) s.insertAdjacentHTML('beforeend', `<span class="dk-sr__lock">${ICON.lock}</span>`);
        else if (sid === st.cur) s.insertAdjacentHTML('beforeend', `<span class="dk-sr__eq">${ICON.check}</span>`);
        s.setAttribute('aria-label', `${(NAMES[sid] || [sid])[0]}${so ? (sid === st.cur ? ', equipped' : '') : `, locked, ${c} ad${c > 1 ? 's' : ''}`}`);
      });
      // info
      $('.dk-sr__name').innerHTML = `${esc(n[0])}<small>${esc(n[1])}</small>`;
      const sEl = $('.dk-sr__state'); sEl.className = 'dk-sr__state' + (own ? (eq ? '' : ' is-owned') : ' is-locked');
      sEl.innerHTML = own ? (eq ? `${ICON.check}Equipped` : 'Owned') : `${ICON.lock}Locked`;
      // action
      const btn = $('.dk-sr__apply'), c = cost(id), pr = st.prog[id] || 0, left = c - pr, pg = $('.dk-sr__progress');
      btn.classList.toggle('is-busy', st.busy);
      if (own) {
        btn.disabled = eq; btn.innerHTML = eq ? `${ICON.check}Equipped` : 'Apply';
        pg.hidden = true;
        $('.dk-sr__note').textContent = eq ? 'Tap any color to preview it on your rig.' : `Apply ${n[0].toLowerCase()} to every rig in your fleet.`;
      } else {
        btn.disabled = false;
        btn.innerHTML = `${ICON.ad}Unlock · Watch ${pr ? `${left} more ad${left > 1 ? 's' : ''}` : `${c} ad${c > 1 ? 's' : ''}`}${c > 1 ? ` <span class="dk-sr__prog">(${pr}/${c})</span>` : ''}`;
        pg.hidden = c < 2; pg.querySelector('b').style.setProperty('--p', (pr / c * 100) + '%');
        $('.dk-sr__note').textContent = 'Preview only · unlocks are permanent, ad progress is saved.';
      }
      const ba = $('.dk-sr__buyall'); if (ba) ba.hidden = own || !o.gated;
    }

    function toast(t) { const e = $('.dk-sr__toast'); e.textContent = t; e.classList.add('is-on'); clearTimeout(st.tt); st.tt = setTimeout(() => e.classList.remove('is-on'), 1800); }

    function apply(id) { st.cur = id; render(); o.onApply && o.onApply(id); }

    async function unlock(id) {
      if (st.busy || !o.onUnlock) return;
      st.busy = true; render();
      let r;
      try { r = await o.onUnlock(id, { cost: cost(id), progress: st.prog[id] || 0 }); } catch (e) { r = { status: 'error' }; }
      st.busy = false;
      if (r && r.status === 'rewarded') {
        st.prog[id] = (st.prog[id] || 0) + 1;
        if (r.unlocked || st.prog[id] >= cost(id)) { delete st.prog[id]; st.own.add(id); apply(id); toast(`${(NAMES[id] || [id])[0]} unlocked and equipped!`); return; }
        toast(`Ad ${st.prog[id]} of ${cost(id)} done`);
      } else if (r && r.status !== 'dismissed') toast(r.message || 'No ad available right now. Try again soon.');
      render();
    }

    // events
    el.addEventListener('click', e => {
      const sw = e.target.closest('.dk-sr__sw'); if (sw) { st.view = sw.dataset.id; render(); return; }
      const mk = e.target.closest('.dk-sr__make'); if (mk) { st.make = mk.dataset.make; render(); o.onMake && o.onMake(st.make); return; }
      if (e.target.closest('.dk-sr__apply')) { const id = st.view; owned(id) ? (id !== st.cur && apply(id)) : unlock(id); return; }
      if (e.target.closest('.dk-sr__buyall')) { o.onBuyAll && o.onBuyAll(); return; }
      if (e.target.closest('.dk-sr__back')) { o.onClose && o.onClose(); }
    });
    el.addEventListener('keydown', e => { // arrow keys move through the swatch radiogroup
      if (!e.target.closest('.dk-sr__sw') || !/Arrow(Left|Right)/.test(e.key)) return;
      const ids = o.palettes.map(p => p.id), i = (ids.indexOf(st.view) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
      st.view = ids[i]; render(); el.querySelector(`.dk-sr__sw[data-id="${ids[i]}"]`).focus(); e.preventDefault();
    });
    const ro = root.ResizeObserver ? new ResizeObserver(size) : null; ro ? ro.observe(stage) : root.addEventListener('resize', size);
    const mq = matchMedia('(prefers-reduced-motion: reduce)'); const onMq = () => render(); mq.addEventListener && mq.addEventListener('change', onMq);
    size(); render();

    return {
      get current() { return st.cur; }, get previewing() { return st.view; }, get unlocked() { return Array.from(st.own); }, get progress() { return Object.assign({}, st.prog); },
      preview(id) { st.view = id; render(); },
      setCurrent(id) { st.cur = id; render(); },
      setUnlocked(ids) { st.own = new Set(ids); render(); },
      setProgress(p) { st.prog = Object.assign({}, p); render(); },
      setGated(g) { o.gated = !!g; render(); },
      setMake(m) { st.make = m; render(); },
      refresh: render, // e.g. after toggling body.lowfx
      destroy() { ro && ro.disconnect(); mq.removeEventListener && mq.removeEventListener('change', onMq); Object.values(CK).forEach(URL.revokeObjectURL); el.innerHTML = ''; el.classList.remove('dk-sr'); },
    };
  }

  root.DKShowroom = { mount, version: 1 };
})(window);

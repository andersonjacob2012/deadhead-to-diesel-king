/* Deadhead to Diesel King: custom basemap loader for Leaflet 1.9 (no dependencies besides Leaflet).
 * Plain script: <script src="map/dk-map.js"></script> defines window.DKMap (also CommonJS-exportable).
 * Data: WGS84 lon/lat TopoJSON bands in map/ (see README.md). All URLs are relative to opts.base (default 'map/').
 *
 *   const dk = DKMap.create(map, {base:'map/', lowfx:false, hillshade:'auto', labels:true, cityDots:false});
 *   dk.ready.then(() => dk.setUnlockedLevel(level()));      // regions with index < level are unlocked (game rule)
 *   dk.setRegionUnlocked(2, true);  dk.setStateStyle('TX', {fillColor:'#1a2843'});  dk.setStateStyle('TX', null);
 */
(function (root) {
  'use strict';
  const L = root.L;

  // ---------- TopoJSON -> GeoJSON (quantized, delta-encoded arcs) ----------
  function decodeTopo(topo) {
    const tf = topo.transform, A = topo.arcs.map(arc => {
      if (!tf) return arc;
      let x = 0, y = 0; const [sx, sy] = tf.scale, [tx, ty] = tf.translate;
      return arc.map(p => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; });
    });
    const arc = i => (i < 0 ? A[~i].slice().reverse() : A[i]);
    const line = ids => { const out = []; ids.forEach((i, k) => { const a = arc(i); for (let j = k ? 1 : 0; j < a.length; j++) out.push(a[j]); }); return out; };
    const geom = g => {
      switch (g.type) {
        case 'LineString': return { type: g.type, coordinates: line(g.arcs) };
        case 'MultiLineString': return { type: g.type, coordinates: g.arcs.map(line) };
        case 'Polygon': return { type: g.type, coordinates: g.arcs.map(line) };
        case 'MultiPolygon': return { type: g.type, coordinates: g.arcs.map(p => p.map(line)) };
        default: return null;
      }
    };
    const out = [];
    for (const name in topo.objects) {
      const o = topo.objects[name], gs = o.type === 'GeometryCollection' ? o.geometries : [o];
      for (const g of gs) { const gg = geom(g); if (gg) out.push({ type: 'Feature', properties: g.properties || {}, geometry: gg }); }
    }
    return out;
  }

  // {zoom:value} stop objects -> value at z (linear), plain values pass through
  function at(v, z) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return v;
    const ks = Object.keys(v).map(Number).sort((a, b) => a - b);
    if (z <= ks[0]) return v[ks[0]];
    for (let i = 1; i < ks.length; i++) if (z <= ks[i]) { const a = ks[i - 1], b = ks[i], f = (z - a) / (b - a); return v[a] + (v[b] - v[a]) * f; }
    return v[ks[ks.length - 1]];
  }
  const resolve = (st, z) => { const o = {}; for (const k in st) o[k] = at(st[k], z); return o; };
  const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });

  const CSS = `
.dk-lbl{position:absolute;white-space:nowrap;pointer-events:none;font:700 10px/1 var(--dk-map-font);letter-spacing:.08em;text-transform:uppercase;color:#9fb0c9;text-shadow:0 1px 2px #000,0 0 3px #0b1220;transform:translate(-50%,5px)}
.dk-lbl.t1{font-size:11px;color:#e8eef8;letter-spacing:.1em}.dk-lbl.t2{color:#c7d3e6}.dk-lbl.t4{font-weight:600;font-size:9px;color:#7488a6}
.dk-lbl.dot::before{content:"";position:absolute;left:50%;top:-8px;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:#cfe6ff;box-shadow:0 0 0 1px #0b1220}
.dk-lbl.dot.hub::before{width:7px;height:7px;margin-left:-3.5px;top:-9px;background:#fff3c4;box-shadow:0 0 0 1.5px #ffd84d,0 0 0 2.5px #0b1220}
.dk-lbl.locked{opacity:.55}
.dk-st{position:absolute;white-space:nowrap;pointer-events:none;font:600 10px/1 var(--dk-map-font);letter-spacing:.32em;text-transform:uppercase;color:#586b8e;/* QA: ~3.2:1 on land #121c30 (was #46587a @.75, ~1.85:1) */transform:translate(-50%,-50%)}
.dk-lbl.off,.dk-st.off{display:none}`;

  // ---------- skip redundant redraws ----------
  // Leaflet redraws a canvas renderer on every moveend. The game's follow-cam fires moveend about every 0.5 s, and on a slow
  // phone each frame can pass 0.5 s, so the whole basemap was redrawn (and re-snapshotted) every frame (~4 fps at z12, 4x CPU).
  // A pan inside the padded canvas needs no redraw (the canvas sits in layer space and moves with the map pane), so moveend
  // only redraws when the zoom or size changed or the view came within the same edge margin that onMove() uses.
  function quiet(R, map, frac) {
    const up = R._update; let z = null, sx = 0, sy = 0;
    R._update = function () {
      const m = this._map, b = this._bounds;
      if (m && b && !m._animatingZoom && !this._dkForce) {
        const s = m.getSize();
        if (m.getZoom() === z && s.x === sx && s.y === sy) {
          const a = m.containerPointToLayerPoint([0, 0]), e = m.containerPointToLayerPoint(s), f = typeof frac === 'function' ? frac() : frac, mx = s.x * f, my = s.y * f;
          if (a.x - b.min.x >= mx && a.y - b.min.y >= my && b.max.x - e.x >= mx && b.max.y - e.y >= my) return this;
        }
        z = m.getZoom(); sx = s.x; sy = s.y; R._dkRedraws = (R._dkRedraws || 0) + 1;
      }
      return up.apply(this, arguments);
    };
  }

  // L.Canvas with a configurable pixel ratio (Leaflet 1.9 hard-codes retina ? 2 : 1 in _update); otherwise identical.
  const DKCanvas = root.L && L.Canvas.extend({
    _update: function () {
      if (this._map._animatingZoom && this._bounds) return;
      L.Renderer.prototype._update.call(this);
      const b = this._bounds, c = this._container, s = b.getSize(), full = this.options.dpr || (L.Browser.retina ? 2 : 1);
      const m = this.options.motionDpr && !this._dkForce && performance.now() - (this._dkMoveT || -1e9) < 300 ? Math.min(full, this.options.motionDpr) : full;
      this._dkDpr = m;
      L.DomUtil.setPosition(c, b.min);
      c.width = Math.round(m * s.x); c.height = Math.round(m * s.y); c.style.width = s.x + 'px'; c.style.height = s.y + 'px';
      this._ctx.setTransform(m, 0, 0, m, 0, 0); this._ctx.translate(-b.min.x, -b.min.y);
      this.fire('update');
    }
  });

  function create(map, opts) {
    opts = Object.assign({ base: 'map/', theme: null, lowfx: false, hillshade: 'auto', labels: true, stateLabels: true, cityDots: false, unlockedLevel: null, cityUnlocked: null }, opts || {});
    const base = opts.base ? opts.base.replace(/\/?$/, '/') : '';
    const I = { map, opts, units: {}, active: new Set(), bandId: null, region: [1, 1, 1, 1, 1, 1], stateStyle: {}, destroyed: false };

    // panes: fills/lines canvas < hillshade < (game overlayPane 400: routes) < labels < (markerPane 600: rigs, cops)
    const pane = (n, z) => { const p = map.getPane(n) || map.createPane(n); p.style.zIndex = z; p.style.pointerEvents = 'none'; return p; };
    pane('dkBase', 150); pane('dkShade', 160); pane('dkLabels', 450);
    if (!document.getElementById('dk-map-css')) { const s = document.createElement('style'); s.id = 'dk-map-css'; s.textContent = CSS; document.head.appendChild(s); }

    const themeP = opts.theme && typeof opts.theme === 'object' ? Promise.resolve(opts.theme) : getJSON(opts.theme || base + 'theme.json');

    I.ready = themeP.then(theme => {
      I.theme = theme;
      map.getContainer().style.background = theme.background;
      map.getContainer().style.setProperty('--dk-map-font', theme.labels.font);
      // ONE shared canvas renderer for every basemap layer
      // Canvas pixel ratio: a z10+ follow-cam pans ~1,200 px/s at 1x, so the padded canvas is redrawn several times a second. While
      // the map is moving it is drawn at theme.renderer.motionDpr (1x: a quarter of the pixels of retina 2x), then redrawn sharp
      // once it has been still for ~0.4 s (see settle in snapshot()). Measured at z12, 4x CPU, 600 px/s: 26-32 fps at 2x vs 53-56 at 1x.
      I.renderer = new DKCanvas({ pane: 'dkBase', padding: theme.renderer.padding, dpr: opts.dpr || (L.Browser.retina ? 2 : 1), motionDpr: theme.renderer.motionDpr });
      map.on('move', () => { I.renderer._dkMoveT = performance.now(); });
      if (opts.snapshot !== false) snapshot(I.renderer);
      quiet(I.renderer, map, () => I.theme.renderer.padding * (1 - I.theme.renderer.redrawPanFraction));
      if (opts.unlockedLevel != null) I.region = I.region.map((_, i) => (i < opts.unlockedLevel ? 1 : 0));
      const b0 = theme.bands[0];
      return Promise.all([
        loadUnit(b0.id, base + b0.file),
        opts.labels || opts.stateLabels ? getJSON(base + 'cities.json').then(c => { I.cities = c; }) : null,
        getJSON(base + theme.bands[2].index).then(ix => { I.z10 = ix; I.z10set = new Set(ix.cells.map(c => c.join('_'))); }).catch(() => {}),
      ]);
    }).then(() => {
      if (I.destroyed) return I;
      buildLabels(); setHillshade(); onZoom();
      map.on('zoomend', onZoom); map.on('moveend', onMoveEnd); map.on('move', onMove);
      return I;
    });

    // ---------- static snapshot ----------
    // The basemap canvas only changes on a redraw, but a big 2D canvas still costs the compositor every frame (measured: ~half
    // the map fps at 4x CPU with 25 rigs). After each redraw the canvas is copied into an <img> (async toBlob) that is shown
    // instead; a view update (moveend / follow-cam edge / zoomend) shows the live canvas again until the next copy is ready.
    // Zoom-animation transforms on the canvas are mirrored to the <img> so it zooms exactly like the canvas would.
    function snapshot(R) {
      let img = null, url = null, upd = 0, sn = 0;
      // QA10 memory: only one full-size copy at a time. While the snapshot is shown the canvas backing store is released
      // (width/height 0, CSS size kept); when the live canvas is shown again the snapshot image is dropped. Saves ~21 MB at 2x.
      const live = on => {
        if (!R._container) return; R._container.style.visibility = on ? '' : 'hidden'; if (img) img.style.display = on ? 'none' : '';
        if (on && img && url) { img.removeAttribute('src'); URL.revokeObjectURL(url); url = null; }
      };
      const free = () => { const c = R._container; if (c && c.width) { R._dkFreed = 1; c.width = 0; c.height = 0; } };
      const ensure = () => {
        if (img || !R._container || !R._container.parentNode) return;
        img = document.createElement('img'); img.className = 'dk-snap leaflet-zoom-animated'; img.alt = '';
        img.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;display:none;transform-origin:0 0;max-width:none';
        R._container.parentNode.insertBefore(img, R._container);
        new MutationObserver(() => { if (img.style.display !== 'none') img.style.transform = R._container.style.transform; }).observe(R._container, { attributes: true, attributeFilter: ['style'] });
      };
      const snap = () => {
        const c = R._container; if (!c || !c.width || !c.toBlob || I.destroyed) return; ensure(); if (!img) return;
        const u = upd, s = ++sn;
        c.toBlob(b => {
          if (!b || u !== upd || s !== sn) return;
          const nu = URL.createObjectURL(b);
          img.onload = () => {
            if (u !== upd || s !== sn) { URL.revokeObjectURL(nu); return; }
            if (url) URL.revokeObjectURL(url); url = nu;
            img.style.width = c.style.width; img.style.height = c.style.height; img.style.transform = c.style.transform; live(false); free();
          };
          img.src = nu;
        });
      };
      const up = R._update, rd = R._redraw;
      R._update = function () { if (!(this._map && this._map._animatingZoom && this._bounds)) { upd++; live(true); this._dkFreed = 0; } return up.apply(this, arguments); };
      // copy only once redraws have settled: during a fast follow-cam the canvas redraws often and a toBlob per redraw cost more than it saved
      // and redraw at full pixel ratio first if the last draw was a low-res one made while moving
      let st = 0;
      const settle = () => {
        if (I.destroyed || !R._map) return;
        if (performance.now() - (R._dkMoveT || -1e9) < 400 || R._map._animatingZoom) { st = setTimeout(settle, 250); return; }
        if (R._dkDpr && R._dkDpr < (R.options.dpr || 1)) { R._dkForce = 1; try { R._update(); } finally { R._dkForce = 0; } return; } // its _redraw re-arms settle
        snap();
      };
      R._redraw = function () {
        // a layer add/restyle while the backing store is released: rebuild the canvas (forced past quiet()) instead of drawing into nothing
        if (this._dkFreed && this._map) { this._dkForce = 1; try { this._update(); } finally { this._dkForce = 0; } }
        const r = rd.apply(this, arguments); clearTimeout(st); st = setTimeout(settle, 450); return r; };
    }

    // ---------- units (a band file or a z10 cell) ----------
    function loadUnit(id, url) {
      if (I.units[id]) return I.units[id].p;
      const u = I.units[id] = { id, groups: null, used: 0 };
      u.p = getJSON(url).then(topo => {
        const by = {};
        for (const f of decodeTopo(topo)) (by[f.properties.l] = by[f.properties.l] || []).push(f);
        u.groups = {};
        for (const cls of I.theme.order) if (by[cls]) {
          u.groups[cls] = L.geoJSON({ type: 'FeatureCollection', features: by[cls] }, { renderer: I.renderer, pane: 'dkBase', interactive: false, style: f => styleFor(cls, f.properties) });
        }
        return u;
      }).catch(e => { delete I.units[id]; throw e; });
      return u.p;
    }
    function addUnit(id) {
      const u = I.units[id]; if (!u || !u.groups || I.active.has(id)) return;
      for (const cls of I.theme.order) if (u.groups[cls]) u.groups[cls].addTo(map);
      I.active.add(id); u.used = Date.now(); restack();
    }
    function removeUnit(id) {
      const u = I.units[id]; if (!u || !I.active.has(id)) return;
      for (const cls in u.groups) map.removeLayer(u.groups[cls]);
      I.active.delete(id);
    }
    function restack() { // canvas draw order = add order; keep fills under lines across units
      for (const cls of I.theme.order) for (const id of I.active) { const g = I.units[id].groups[cls]; if (g) g.bringToFront(); }
    }

    // ---------- styling ----------
    function styleFor(cls, p) {
      const z = map.getZoom(), th = I.theme;
      let st = resolve(th.layers[cls], z);
      if (cls === 'land') {
        if (!I.region[p.r]) st = Object.assign(st, th.regions.locked);
        if (I.stateStyle[p.code]) st = Object.assign(st, I.stateStyle[p.code]);
      } else if (cls === 'front') {
        const show = I.region[p.a] !== I.region[p.b];
        st.opacity = show ? st.opacity : 0; st.stroke = show;
      }
      return st;
    }
    function restyle(classes) {
      for (const id of I.active) { const u = I.units[id]; for (const cls of classes) if (u.groups[cls]) u.groups[cls].setStyle(f => styleFor(cls, f.properties)); }
      for (const id in I.units) if (!I.active.has(id) && I.units[id].groups) I.units[id].dirty = true;
    }

    // ---------- zoom bands ----------
    function bandFor(z) { let b = I.theme.bands[0]; for (const x of I.theme.bands) if (z >= x.minZoom) b = x; return b; }
    function onZoom() {
      const z = map.getZoom(), b = bandFor(z);
      if (b.id !== I.bandId) {
        const want = b.id; I.bandId = want;
        if (b.file) loadUnit(b.id, base + b.file).then(() => { if (I.bandId !== want) return; swapTo([b.id]); }).catch(console.warn);
        else updateCells(true);
      }
      restyle(['lake', 'inner', 'front', 'edge', 'hwy', 'land']);
      setHillshade(); updateLabels();
    }
    function swapTo(ids) { // add the new band before removing the old one: no blank frame
      if (!ids.some(id => I.units[id] && I.units[id].groups)) return; // QA10: nothing loaded (offline): keep what is drawn
      ids.forEach(addUnit);
      for (const id of Array.from(I.active)) if (!ids.includes(id)) removeUnit(id);
      for (const id of ids) { const u = I.units[id]; if (u && u.dirty) { u.dirty = false; for (const cls in u.groups) u.groups[cls].setStyle(f => styleFor(cls, f.properties)); } }
    }

    // ---------- z10+ cells ----------
    function cellsFor(pad) {
      const c = I.z10.cell, b = map.getBounds().pad(pad), out = [];
      for (let x = Math.floor(b.getWest() / c) * c; x < b.getEast(); x += c)
        for (let y = Math.floor(b.getSouth() / c) * c; y < b.getNorth(); y += c) { const k = x + '_' + y; if (I.z10set.has(k)) out.push(k); }
      return out;
    }
    function updateCells(swap) {
      // QA10: a non-animated zoom-out fires 'move' before zoomend switches the band; check the live zoom, not only I.bandId,
      // or every z10 cell in the low-zoom view gets fetched and retained
      if (!I.z10 || I.bandId !== 'z10' || bandFor(map.getZoom()).id !== 'z10') { trimCells(); return; }
      const bd = I.theme.bands[2], need = cellsFor(bd.cellPad), want = I.bandId;
      Promise.all(need.map(k => loadUnit('c' + k, base + bd.dir + k + '.json').catch(() => null))).then(() => {
        if (I.bandId !== want || bandFor(map.getZoom()).id !== 'z10') { trimCells(); return; }
        const ids = need.map(k => 'c' + k).filter(id => I.units[id] && I.units[id].groups);
        if (!ids.length) { trimCells(); return; } // QA11 offline: nothing loaded for this view -> keep what is drawn (swapTo has the same guard)
        if (swap) swapTo(ids); else { ids.forEach(addUnit); const keep = new Set(cellsFor(bd.cellPad + 1).map(k => 'c' + k)); for (const id of Array.from(I.active)) if (!keep.has(id)) removeUnit(id); }
        trimCells();
      });
    }
    function trimCells() { // drop parsed cells beyond the cache budget (oldest first)
      if (!I.theme) return; const bd = I.theme.bands[2];
      const cached = Object.keys(I.units).filter(id => id[0] === 'c' && !I.active.has(id) && I.units[id].groups).sort((a, b) => I.units[a].used - I.units[b].used);
      while (cached.length > bd.keepCells) delete I.units[cached.shift()];
    }
    function onMoveEnd() { if (I.bandId === 'z10') updateCells(false); updateLabels(); }
    // follow-cam: the game pans every frame (_rawPanBy + 'move') and only fires moveend every 0.5 s. Redraw the shared canvas
    // as soon as the view gets within (1 - redrawPanFraction) of the canvas padding edge, so no blank strip shows.
    function onMove() {
      const R = I.renderer; if (!R || !R._map || !R._bounds) return;
      const s = map.getSize(), a = map.containerPointToLayerPoint([0, 0]), z = map.containerPointToLayerPoint(s), b = R._bounds;
      const mx = s.x * I.theme.renderer.padding * (1 - I.theme.renderer.redrawPanFraction), my = s.y * I.theme.renderer.padding * (1 - I.theme.renderer.redrawPanFraction);
      if (a.x - b.min.x < mx || a.y - b.min.y < my || b.max.x - z.x < mx || b.max.y - z.y < my) {
        R._update();
        if (I.bandId === 'z10') { const now = Date.now(); if (!I.cellT || now - I.cellT > 250) { I.cellT = now; updateCells(false); } }
      }
    }

    // ---------- hillshade ----------
    function hsWanted() {
      const o = opts.hillshade; if (!o || opts.lowfx || !I.theme.hillshade) return false;
      if (o === 'auto') {
        const n = navigator, mob = Math.min(screen.width, screen.height) < 600;
        if ((n.connection && n.connection.saveData) || (n.deviceMemory && n.deviceMemory <= 2) || mob) return false;
      }
      return map.getZoom() < I.theme.hillshade.maxZoom;
    }
    function setHillshade() {
      if (!I.theme) return;
      const want = hsWanted(), h = I.theme.hillshade;
      if (want && !I.hs) I.hs = L.imageOverlay(base + h.file, h.bounds, { pane: 'dkShade', interactive: false, className: 'dk-hillshade' }).addTo(map);
      if (!want && I.hs) { map.removeLayer(I.hs); I.hs = null; }
      if (I.hs) I.hs.setOpacity(at(h.opacity, map.getZoom()));
    }

    // ---------- labels (DOM, Inter) ----------
    function buildLabels() {
      I.lbl = []; I.stl = [];
      if (!I.cities) return;
      const mk = (lat, lon, cls, text) => { const m = L.marker([lat, lon], { pane: 'dkLabels', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="${cls}">${text}</div>` }) }).addTo(map); return m; };
      if (opts.labels) for (const c of I.cities.cities.slice().sort((a, b) => a.t - b.t)) {
        const m = mk(c.lat, c.lon, `dk-lbl t${c.t}${opts.cityDots ? ' dot' : ''}${c.hub ? ' hub' : ''}`, c.n);
        I.lbl.push({ c, m });
      }
      if (opts.stateLabels) { const small = new Set(I.theme.labels.state.smallUsesCode); for (const s of I.cities.states) I.stl.push({ s, m: mk(s.lat, s.lon, 'dk-st', small.has(s.code) ? s.code : s.n) }); }
    }
    function updateLabels() {
      if (!I.lbl) return;
      const z = map.getZoom(), lt = I.theme.labels, sz = map.getSize(), phone = sz.x < 600 ? lt.phoneZoomOffset : 0, boxes = [];
      // offscreen labels are switched off too (each visible label is its own composited marker layer); re-run on moveend
      const mx = sz.x * .35, my = sz.y * .35, inView = p => p.x > -mx && p.x < sz.x + mx && p.y > -my && p.y < sz.y + my;
      const hit = b => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      for (const { c, m } of I.lbl) {
        const el = m.getElement() && m.getElement().firstChild; if (!el) continue;
        let on = z >= lt.cityTierMinZoom[c.t] + (c.t > 1 ? phone : 0);
        const p = on && map.latLngToContainerPoint([c.lat, c.lon]);
        if (on && !inView(p)) on = false;
        if (on && lt.collide) {
          const w = c.n.length * (c.t === 1 ? 8.2 : 7) + 6, b = [p.x - w / 2, p.y - 2, p.x + w / 2, p.y + 18];
          if (hit(b)) on = false; else boxes.push(b);
        }
        el.classList.toggle('off', !on); el.classList.toggle('locked', opts.cityUnlocked ? !opts.cityUnlocked(c.k) : !I.region[c.r]);
      }
      const shown = new Set(); for (const { m } of I.lbl) { const e = m.getElement() && m.getElement().firstChild; if (e && !e.classList.contains('off')) shown.add(e.textContent.trim().toLowerCase()); }
      for (const { s, m } of I.stl) {
        const el = m.getElement() && m.getElement().firstChild; if (!el) continue;
        let on = z >= lt.state.minZoom + phone && z < lt.state.maxZoom;
        const p = on && map.latLngToContainerPoint([s.lat, s.lon]);
        if (on && !inView(p)) on = false;
        if (on && shown.has(el.textContent.trim().toLowerCase())) on = false; // QA: no 2nd "New York" while the city label shows
        if (on && lt.collide) { const w = el.textContent.length * 9, b = [p.x - w / 2, p.y - 6, p.x + w / 2, p.y + 6]; if (hit(b)) on = false; }
        el.classList.toggle('off', !on);
      }
    }

    // ---------- public API ----------
    I.setRegionUnlocked = (id, on) => { I.region[id] = on ? 1 : 0; if (I.theme) { restyle(['land', 'front']); updateLabels(); } return I; };
    I.setUnlockedLevel = lv => { I.region = I.region.map((_, i) => (i < lv ? 1 : 0)); if (I.theme) { restyle(['land', 'front']); updateLabels(); } return I; };
    I.setStateStyle = (code, st) => { if (st) I.stateStyle[code] = st; else delete I.stateStyle[code]; if (I.theme) restyle(['land']); return I; };
    I.refreshLabels = () => { if (I.theme) updateLabels(); return I; }; // e.g. after the game unlocks single cities (opts.cityUnlocked(k))
    I.setLowFx = on => { opts.lowfx = !!on; setHillshade(); return I; };
    I.setLabels = on => { (I.lbl || []).concat(I.stl || []).forEach(x => x.m.getElement() && (x.m.getElement().style.display = on ? '' : 'none')); return I; };
    I.regionOf = (lat, lon) => (lat < 37.2 && lon > -106.8 && lon < -89.5 ? 0 : lat >= 36.5 && lon > -104.5 && lon < -80.5 ? 1 : lat < 36.5 && lon >= -89.5 ? 2 : lon < -104.5 && lon >= -117.3 ? 3 : lon >= -80.5 ? 4 : 5);
    I.stats = () => { let n = 0, v = 0; for (const id of I.active) for (const cls in I.units[id].groups) I.units[id].groups[cls].eachLayer(l => { n++; const cnt = a => Array.isArray(a) ? a.reduce((s, x) => s + cnt(x), 0) : 1; v += cnt(l.getLatLngs()); }); return { band: I.bandId, units: Array.from(I.active), layers: n, vertices: v }; };
    I.destroy = () => {
      I.destroyed = true; map.off('zoomend', onZoom); map.off('moveend', onMoveEnd); map.off('move', onMove);
      for (const id of Array.from(I.active)) removeUnit(id);
      (I.lbl || []).concat(I.stl || []).forEach(x => map.removeLayer(x.m)); if (I.hs) map.removeLayer(I.hs);
      if (I.renderer && I.renderer._map) map.removeLayer(I.renderer);
    };
    return I;
  }

  const DKMap = { create, decodeTopo, quiet, version: 1 };
  root.DKMap = DKMap;
  if (typeof module === 'object' && module.exports) module.exports = DKMap;
})(typeof window !== 'undefined' ? window : globalThis);

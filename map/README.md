# map/: Deadhead to Diesel King basemap (replaces the Esri tiles)

An original dark navy and gold vector basemap of the lower 48 for Leaflet 1.9. It uses only public-domain geography and is drawn on one shared canvas. All data is plain **WGS84 lon/lat** TopoJSON, so it lines up with `routes.js` under Leaflet's default Web Mercator. Every URL is relative (`map/...`), with no CDN or absolute paths.

**Status: approved by Jacob and live in the game (`index.html` loads `map/dk-map.js`).**

## Files
| File | What | Raw | Gzip |
|---|---|---|---|
| `theme.json` | colors, weights, bands, label tiers, region styles | 3.1 KB | 1.2 KB |
| `base-z3.json` | band z3 (z3–6.99), preloaded | 171.8 KB | 55.7 KB |
| `cities.json` | 158 cities + tiers + regions, 49 state label anchors | 16.2 KB | 4.2 KB |
| `base-z7.json` | band z7 (z7–9.99), lazy | 650.6 KB | 206.1 KB |
| `z10/index.json` | list of z10 cells | 0.8 KB | 0.2 KB |
| `z10/<lon>_<lat>.json` ×79 | band z10 (≥ z10) 4° cells, lazy | 3455 KB total (mean 44, max 208) | 1262 KB total (mean 16.0, max 73.9) |
| `hillshade.webp` | optional Web-Mercator hillshade, 1400×791, desktop only | 298.9 KB | 298.5 KB |
| `dk-map.js` | loader (window.DKMap) | 15.8 KB | 5.7 KB |
| `demo.html` | standalone demo with rigs | 10.0 KB | 4.6 KB |
| `build/build.py` | reproducible build | 20.3 KB | 7.8 KB |
| `build/fetch_sources.sh` | source downloader | 1.2 KB | 0.5 KB |

**Load budget:**
- Up front: `theme.json`, `base-z3.json` and `cities.json` ≈ **67 KB gz**.
- Lazy:
  - `base-z7.json` the first time you zoom to 7 or closer.
  - z10 cells (a 4°×4° grid, only those in view plus a margin) at 10 or closer.
  - `hillshade.webp` on desktop only.
- Typical session (national → regional → follow a truck through a few cells) ≈ **~340 KB gz** without the hillshade. Hillshade adds ~300 KB on desktop.

## Zoom bands
| Band | Zooms | Source scale | Simplified to | Contents |
|---|---|---|---|---|
| z3 | 3 – 6.99 | Census 1:20M, NE 1:50M | 1.5 km | land/states, neighbors, big lakes, state lines, coast/border, interstates, region frontiers |
| z7 | 7 – 9.99 | Census 1:5M, NE 1:10M | 350 m | as above + urban areas |
| z10 | ≥ 10 (tuned for 13) | Census 1:500k, NE 1:10M | 20 m coast, 6 m interstates | as above, chunked into 4° cells |

**Recommendation: cap `maxZoom` at 13**, not 17. The game currently uses `minZoom:3, maxZoom:17`. Above 13 there is nothing more to show, and the route geometry (see Interstates) is the limit.

## Layers (feature property `l`) and draw order
`nbr` (Canada, Mexico, Alaska, Cuba and the Bahamas as muted silhouettes) → `land` (states, split by game region) → `urban` (z7+) → `lake` → `inner` (state lines) → `front` (region frontier) → `edge` (US coast and international border, thin gold-lo) → `hwy` (interstates).

- `land` features carry `code` (postal code: `TX`), `name`, and `r` (game region index 0–5).
- `front` features carry `a` and `b`, the region indices on each side.

Panes:
- `dkBase` (z 150): the single canvas.
- `dkShade` (z 160): the hillshade `<img>`.
- `dkLabels` (z 450): DOM labels.

All three sit under Leaflet's `overlayPane` (400, the game's route canvas), except the labels, which sit just above it, and under `markerPane` (600: rigs, cop cars, chicken lights). Rig lights and beams are composited `<img>`s, so they draw over the basemap with no blending.

## Integration (for Dev Lead, after approval)
```html
<script src="map/dk-map.js"></script>
```
```js
// 1) delete the Esri L.tileLayer(...) line (and the .navy filter class); keep #map{background:#0b1220}
const map = L.map('map', {zoomControl:false, zoomSnap:.2, preferCanvas:true, minZoom:3, maxZoom:13, /* was 17 */});
// 2) basemap
const DK = DKMap.create(map, {
  base: 'map/',
  lowfx: document.body.classList.contains('lowfx'),
  hillshade: 'auto',          // auto = desktop only; off on phones, Save-Data, deviceMemory<=2 or lowfx
  labels: true,               // tiered city labels (Inter). Set false to keep the game's own permanent tooltips
  stateLabels: true,
  cityDots: false,            // the game already draws CM[k] circleMarkers
  unlockedLevel: level(),
});
// 3) region unlock hook: call on load and on every level-up
DK.ready.then(() => DK.setUnlockedLevel(level()));
// low-FX toggle
DK.setLowFx(true|false);
// 4) attribution (replaces the Esri line)
map.attributionControl.addAttribution('Map: US Census Bureau, Natural Earth · Routes: OSRM / © OpenStreetMap contributors');
```

### Region unlock / state style API
| Call | Effect |
|---|---|
| `DK.setUnlockedLevel(lv)` | regions with index `< lv` are unlocked, the same as the game's `region(c) < level()` |
| `DK.setRegionUnlocked(id, bool)` | one region (0 South Central, 1 Midwest, 2 Southeast, 3 Mountain West, 4 Northeast, 5 West Coast, matching `REGN`/`RGB`) |
| `DK.setStateStyle('TX', {fillColor:'#1a2843', color:'#1a2843'})` / `DK.setStateStyle('TX', null)` | override any Leaflet path style on one state (all its pieces); applied after the region style |
| `DK.regionOf(lat, lon)` | the game's region rule (copied from `region()` in index.html) |

**How regions map to geometry.** The game's regions are latitude/longitude boxes on cities, not states. For example, the 37.2°N line puts the southern edge of Kansas and Missouri in South Central. Each state polygon is therefore cut along those exact lines, and every piece carries `r`. Shading then matches the city unlock rule exactly, while every piece also keeps its state `code`.
- Locked regions get a darker land fill (`theme.regions.locked`).
- A thin dashed gold frontier (`front`) is drawn only where a locked region meets an unlocked one.
- City labels in locked regions are dimmed.

Cities that are individually unlocked inside a locked region (lanes, trucks) stay game-side.

If you'd rather unlock by whole states, `DK.setStateStyle` lets the game shade any set of states. Changing the rule itself is a gameplay decision (open question below).

### Cities
- `cities.json` holds all 158 cities from `routes.js CITY_LL` at the game's own coordinates, so they stay locked to the route ends. Each entry has `k`, `n`, `lat`, `lon`, `t`, `hub`, `st` (state), and `r` (region).
- Label tiers come straight from index.html:
  - `t1` = `TOP` (13 cities), shown at z ≥ 3
  - `t2` = `BIG` (19), shown at z ≥ 5
  - `t3` = `HUBS` (34), shown at z ≥ 6
  - `t4` = everything, shown at z ≥ 7.4
- On phones narrower than 600px every tier except t1 waits +0.4 zoom.
- Labels are hidden greedily on overlap, in tier order, at each zoomend.
- `states` holds label anchors (pole of inaccessibility) for faint letter-spaced state names at z 5–8.6. Small Northeast states use the postal code.
- Fonts: Inter only. Rye looked too loud at label size on a minimal map.

### Interstates
- Built from **the game's own `routes.js` polylines** (the exact points `route()` drives trucks along).
- Each band dedupes shared corridors, keeping the longer route's line wherever another route runs within 4 km (z3), 1.5 km (z7) or 300 m (z10). Junction gaps are stitched.
- Against the current `routes.js`, the drawn z10 network is within 207 m (median) / 290 m (95th pct) / 505 m (max) of the path any truck drives. At z13, 100 m ≈ 6.5 px.
- If index.html ever smooths routes (a `smoothPts(r.pts)` WIP was in the working tree during this build), `build.py` detects it and applies the same smoothing.
- **Re-run `build.py` whenever `routes.js` changes** (for example after `tools/densify_routes.py`). It takes about 4 minutes.

### Performance notes
- **One shared `L.canvas` renderer** (`DK.renderer`, padding 0.5) draws every basemap feature. Band layers are swapped on `zoomend`: the new band is added before the old one is removed, so there is no blank frame.
- Only one band is ever on the map:
  - z3: ~16k vertices
  - z7: ~67k vertices
  - z10: 2.8k median (max 19k) vertices per cell, and only 1–4 cells are on screen
- z10 cells load for the view plus 35% and unload beyond one extra cell. Up to 16 parsed cells are cached.
- **Follow-cam:**
  - The game pans with `_rawPanBy` + `move` every frame and fires `moveend` only every 0.5 s.
  - The loader watches `move` and redraws the canvas early, when the view gets within 40% of the padding edge (`theme.renderer.redrawPanFraction`).
  - This uses Leaflet's internal `renderer._update()`, and is tested in demo.html `&follow`.
  - The game's own overlay canvas has the same blank-edge issue if routes are long.
- **Redundant redraws are skipped** (`DKMap.quiet`). Leaflet redraws a canvas on every `moveend`; a pan that stays inside the padded canvas now keeps the existing drawing, so only a zoom/size change or reaching the `onMove` edge margin redraws.
- **Motion pixel ratio.** While the map is moving the canvas is drawn at `theme.renderer.motionDpr` (1x), then redrawn at full ratio once it has been still for ~0.4 s, and only then snapshotted (the toBlob copy is debounced). At z12, 4x CPU, panning 600 px/s with 25 rigs: 26-32 fps at 2x vs 53-56 fps with this (Esri tiles: 57).
- Labels are 158 + 49 tiny DOM markers. Their visibility is recomputed only on `zoomend`.
- The canvas uses at most 2× DPR (a Leaflet default), which keeps memory sane on 3× phones.

### Switching to vector tiles later
- The layer/property scheme (`l`, `code`, `r`, `a`/`b`) and `theme.json` map 1:1 onto a vector-tile style.
- `build.py` already produces clipped per-band GeoJSON, so tippecanoe/PMTiles output is a one-step addition.
- In `dk-map.js`, only `loadUnit`/`updateCells` would change; the styling and region API stay the same.

## Theme
`theme.json` holds every color, weight and opacity. Values written as `{zoom: value}` interpolate linearly by zoom. The palette is from `assets/ui/ui-kit.css`:
- ocean `#0b1220` (`--dk-navy`), neighbors `#101a2b`, land `#121c30`, locked `#0c1322`
- state lines `#2a3b5e` (`--dk-line`), coast `#b8942a` (`--dk-gold-lo`), interstates `#9fb0c9` (`--dk-chrome`) at low alpha
- frontier `#ffd84d` (`--dk-gold`)

Gold is kept for the coast, frontiers and the game's own routes and hubs.

## Demo and previews
- `demo.html`: serve the repo root (`python3 -m http.server`) and open `/map/demo.html`. It runs the real rigs (map-rigs v2 sprites, blob-URL chicken lights, path-following with the fixed `pointAtDistanceBehind`), a cop car beside the selected rig, region level picker, Night, Low FX, Hillshade, Labels, and a state-style test.
- URL params: `view=national|texas|close|z13`, `level=0..6`, `night`, `lowfx`, `hs=1|0`, `follow`, `t=0..1` (freeze rig position), `z`, `lat`/`lon`, `noui`.
- `preview/`:
  - `national-1440x900.png` (level 3)
  - `texas-1440x900.png` (level 1)
  - `regional-z8.2-dfw-1440x900.png` (z7 band, Low FX, level 1)
  - `close-dallas-z11.6-1440x900.png`
  - `followcam-z13-1440x900.png` (night)
  - `phone-national-390x844.png` (@3x, level 2)
  - `phone-followcam-z11-390x844.png`

## Data sources and licenses
| Data | Source | License |
|---|---|---|
| States, coastline, Great Lakes shoreline (1:500k, 1:5M, 1:20M) | US Census Bureau, 2023 Cartographic Boundary Files `cb_2023_us_state_*` | US federal government work: public domain (17 U.S.C. §105). Credit "US Census Bureau" requested as a courtesy |
| Urban areas | US Census Bureau, 2020 Cartographic Boundary `cb_2020_us_ua20_500k` | public domain |
| Canada, Mexico, Alaska, Caribbean silhouettes | Natural Earth `ne_10m/ne_50m_admin_0_countries` | public domain (naturalearthdata.com terms of use) |
| Lakes (Great Lakes on the Canadian side, Great Salt Lake, Okeechobee, etc.) | Natural Earth `ne_10m/ne_50m_lakes` | public domain |
| Hillshade | Natural Earth `SR_50M` shaded relief, reprojected to Web Mercator and masked to US land | public domain |
| Interstates | the game's `routes.js` (tools/build_routes.py: OSRM over **OpenStreetMap**) | **ODbL: keep "© OpenStreetMap contributors"** (the game already shows "Routes: OSRM / © OSM") |
| City coordinates and tiers | the game's `routes.js` / `index.html` | ours |
| Labels font | Inter (assets/ui/fonts, SIL OFL) | OFL |

No Esri, Stadia, Protomaps or OSM-tile data is used. OSM enters only through our existing `routes.js`.

## Rebuild
```bash
map/build/fetch_sources.sh                    # downloads to $DK_MAP_SRC (default /workspace/mapwork/src)
pip install shapely numpy pillow; npm i -g mapshaper
python3 map/build/build.py                    # ~4 min; rewrites base-*.json, z10/, cities.json, hillshade.webp
```

## Open questions
1. **Interstate vs. truck alignment at z11–13.**
   - The drawn interstates are deduped from `routes.js`, which Dev Lead's `densify_routes.py` simplifies at 0.008° (~0.9 km).
   - Two routes on the same interstate can therefore wander a few hundred metres apart. A truck can sit up to ~0.5 km (≈30 px at z13) beside the drawn line. The median is ~200 m, about 13 px.
   - Options:
     - (a) accept it (the game's own active-route glow line sits exactly under the truck anyway);
     - (b) densify `routes.js` further (e.g. eps 0.002), then re-run `build.py`;
     - (c) have the game drive trucks along the map's deduped network.
   - Short stitch "jogs" where corridors merge are a side effect of the dedupe.
2. **`routes.js` and `index.html` are changing under me.** Both have uncommitted Dev Lead edits: `routes.js` was densified at 05:48, and a `smoothPts` route-smoothing variant appeared and then disappeared from `index.html`. The map data was built from the 05:48 `routes.js`. Re-run `build.py` once those are committed.
3. **Region shading follows the game's lat/lon boxes, not state lines.** For example, the strip of Kansas and Missouri south of 37.2°N is South Central. That's accurate to gameplay but cuts across states. Should regions become whole states? That's a gameplay rule change.
4. **City labels.** Use the map's tiered Inter labels (`labels:true`) and drop the game's permanent tooltips, or keep the game's tooltips (`labels:false`)? Running both duplicates them.
5. **Hillshade.** It's subtle relief on desktop only (299 KB). Keep it, or drop it for an even cleaner map? It's skipped on phones and in Low FX either way.
6. **Leaflet itself** still loads from unpkg in `index.html` (and in this demo, to match). For the phone app's local server, Platform Engineer will want to vendor it.
7. **Sacramento (SAC)** sits about 30 km south of downtown in the game data (38.30,−121.40), and **ORL** is a combined "Orlando/Tampa" point. Both are placed exactly as the game has them so routes still meet. Should SAC move? Moving it would mean regenerating its routes.
